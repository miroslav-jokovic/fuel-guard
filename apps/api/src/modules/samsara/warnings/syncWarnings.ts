/**
 * The warning collector (WARNING-DESK-PLAN WD2, D-WD2/D-WD4/D-WD5). Reads the six Samsara sources the
 * desk counts and writes them, in one shape, to `samsara_warnings` (0653). Read-only against Samsara;
 * writes nothing but its own staging table and its own cursors.
 *
 * ── POLLING, NOT WEBHOOKS ────────────────────────────────────────────────────────────────────────
 * 5 of the account's 17 alert configurations have two conditions, and Samsara sends webhooks only for
 * single-condition alerts; a webhook is retried five times and then dropped. A watermark that only
 * moves after its rows are written loses nothing across an outage, and needs no Samsara setting.
 *
 * ── THE WATERMARKS ───────────────────────────────────────────────────────────────────────────────
 * One per source in `samsara_feed_cursors` (feed `warnings:<source>`), holding the ISO time the last
 * SUCCESSFUL read of that source started. The next read starts there less OVERLAP_MS — a re-read
 * refreshes rows in place (unique `(org_id, source, source_key)`), so an overlap can never duplicate.
 * A source that fails keeps its watermark and is re-read next tick; the others still advance. The run
 * then throws, so the job is recorded failed rather than "done" with a hole in it.
 *
 * ── HOW FAR BACK THE FIRST RUN READS ─────────────────────────────────────────────────────────────
 * Seven days — the longest default window, so the Nth-time counts are right on day one (D-WD17).
 * Defects reach back 180 days, because a defect reported months ago and never fixed is exactly what the
 * desk is for, and it is not "updated" again until someone fixes it (44 of 46 open defects were older
 * than three days on 2026-11-26).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertConfigurationSummary, TruckFaultCode, WarningSource } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { readFeedCursor, persistFeedCursorQuietly } from "../lib/feedCursor.js";
import { NoSamsaraTokenError } from "../samsaraVehicleSync.js";
import {
  fetchAlertConfigurations,
  fetchAlertIncidents,
  fetchAtisReadings,
  fetchDefects,
  fetchFaultCodes,
  fetchHosViolations,
  fetchSafetyEvents,
  type WarningFetchContext,
} from "./warningFetch.js";
import { alertIncidentRow, defectRow, hosViolationRow, safetyEventRow, truckLamps, type WarningRow } from "./warningRows.js";
import { foldLampObservations, MERGE_GAP_MS, type Episode, type LampObservation } from "./lampEpisodes.js";

const DAY_MS = 86_400_000;
export const OVERLAP_MS = 15 * 60_000;
export const FIRST_RUN_DAYS = 7;
export const DEFECT_FIRST_RUN_DAYS = 180;
/** HOS logs are certified late: every read re-reads the last two days, at most hourly. */
export const HOS_REREAD_MS = 2 * DAY_MS;
export const HOS_MIN_INTERVAL_MS = 3_600_000;
const WRITE_BATCH = 500;

export interface WarningsSyncOptions {
  now: Date;
  /** The sources the desk's rules have switched on. */
  sources: ReadonlySet<WarningSource>;
  /** Alert configurations whose rule is on — only their incidents are collected (idling is not). */
  alertConfigs: readonly AlertConfigurationSummary[];
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  tokenOverride?: string;
}

export interface SourceResult {
  fetched: number;
  written: number;
  refused: number;
  skipped?: string;
  error?: string;
}

export type WarningsSyncResult = Partial<Record<WarningSource, SourceResult>>;

const feedName = (s: WarningSource) => `warnings:${s}`;

async function writeRows(admin: SupabaseClient, rows: WarningRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const { error } = await admin
      .from("samsara_warnings")
      .upsert(rows.slice(i, i + WRITE_BATCH), { onConflict: "org_id,source,source_key" });
    if (error) throw new Error(`samsara_warnings write: ${error.message}`);
  }
  return rows.length;
}

/** Parse, drop what refused, write. */
async function parseAndWrite(admin: SupabaseClient, items: unknown[], parse: (raw: unknown) => WarningRow | null): Promise<SourceResult> {
  const rows: WarningRow[] = [];
  let refused = 0;
  for (const raw of items) {
    const row = parse(raw);
    if (row) rows.push(row);
    else refused += 1;
  }
  // The same key twice in one batch is refused by Postgres ("cannot affect row a second time").
  const unique = [...new Map(rows.map((r) => [r.source_key, r])).values()];
  return { fetched: items.length, written: await writeRows(admin, unique), refused };
}

/** The latest episode per entity for a lamp source — the state new readings are folded onto. */
async function latestEpisodes(admin: SupabaseClient, orgId: string, source: "atis" | "lamp", sinceIso: string): Promise<Episode[]> {
  const entityCol = source === "atis" ? "trailer_samsara_id" : "vehicle_samsara_id";
  const { data, error } = await admin
    .from("samsara_warnings")
    .select(`source_key, kind, ${entityCol}, happened_at, ended_at, still_active`)
    .eq("org_id", orgId)
    .eq("source", source)
    .or(`still_active.eq.true,ended_at.gte.${sinceIso}`)
    .order("happened_at", { ascending: true });
  if (error) throw new Error(`samsara_warnings episodes: ${error.message}`);
  const latest = new Map<string, Episode>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const entityId = String(r[entityCol] ?? "");
    const lamp = String(r.kind);
    if (!entityId) continue;
    latest.set(`${entityId}\u0000${lamp}`, {
      key: String(r.source_key),
      entityId,
      lamp,
      startedAt: new Date(Date.parse(String(r.happened_at))).toISOString(),
      endedAt: r.ended_at ? new Date(Date.parse(String(r.ended_at))).toISOString() : null,
      active: r.still_active === true,
    });
  }
  return [...latest.values()];
}

const LAMP_LABEL: Record<string, string> = {
  atis: "Trailer tire losing air (ATIS lamp on)",
  lamp_stop: "Red STOP lamp on",
  lamp_amber: "Check-engine lamp on",
};

function episodeRow(orgId: string, source: "atis" | "lamp", e: Episode, seenAt: string, unit: { name: string | null; codes: TruckFaultCode[] } | undefined): WarningRow {
  return {
    org_id: orgId,
    source,
    source_key: e.key,
    kind: e.lamp,
    subject_kind: source === "atis" ? "trailer" : "truck",
    vehicle_samsara_id: source === "lamp" ? e.entityId : null,
    trailer_samsara_id: source === "atis" ? e.entityId : null,
    driver_samsara_id: null,
    unit_name: unit?.name ?? null,
    driver_name: null,
    label: LAMP_LABEL[e.lamp] ?? e.lamp,
    happened_at: e.startedAt,
    ended_at: e.endedAt,
    still_active: e.active,
    samsara_url: null,
    detail: unit?.codes.length ? { codes: unit.codes } : {},
    updated_at: seenAt,
  };
}

async function syncAtis(admin: SupabaseClient, ctx: WarningFetchContext, orgId: string, fromMs: number, nowMs: number, seenAt: string): Promise<SourceResult> {
  const readings = await fetchAtisReadings(ctx, fromMs, nowMs);
  const latest = await latestEpisodes(admin, orgId, "atis", new Date(fromMs - MERGE_GAP_MS).toISOString());
  const changed = foldLampObservations(latest, readings.map((r) => ({ entityId: r.entityId, lamp: "atis", at: r.at, on: r.on })));
  return { fetched: readings.length, written: await writeRows(admin, changed.map((e) => episodeRow(orgId, "atis", e, seenAt, undefined))), refused: 0 };
}

async function syncEngineLamps(admin: SupabaseClient, ctx: WarningFetchContext, orgId: string, nowMs: number, seenAt: string): Promise<SourceResult> {
  const items = await fetchFaultCodes(ctx);
  const at = new Date(nowMs).toISOString();
  const units = new Map<string, { name: string | null; codes: TruckFaultCode[] }>();
  const observations: LampObservation[] = [];
  let refused = 0;
  for (const raw of items) {
    const l = truckLamps(raw);
    if (!l) {
      refused += 1;
      continue;
    }
    units.set(l.vehicleId, { name: l.name, codes: l.codes });
    observations.push({ entityId: l.vehicleId, lamp: "lamp_stop", at, on: l.stop });
    observations.push({ entityId: l.vehicleId, lamp: "lamp_amber", at, on: l.amber });
  }
  const latest = await latestEpisodes(admin, orgId, "lamp", new Date(nowMs - MERGE_GAP_MS).toISOString());
  const changed = foldLampObservations(latest, observations);
  const rows = changed.map((e) => episodeRow(orgId, "lamp", e, seenAt, units.get(e.entityId)));
  return { fetched: items.length, written: await writeRows(admin, rows), refused };
}

/**
 * One collector pass for one org. Each source runs on its own watermark; a failing source is
 * reported and re-read next tick, and the pass throws at the end so the job ledger shows it.
 */
export async function syncSamsaraWarnings(admin: SupabaseClient, env: Env, orgId: string, opts: WarningsSyncOptions): Promise<WarningsSyncResult> {
  const token = opts.tokenOverride ?? (await loadSamsaraToken(admin, env, orgId));
  if (!token) throw new NoSamsaraTokenError();
  const nowMs = opts.now.getTime();
  const seenAt = opts.now.toISOString();
  const result: WarningsSyncResult = {};
  const failures: string[] = [];

  const run = async (source: WarningSource, firstRunDays: number, work: (fromMs: number, ctx: WarningFetchContext) => Promise<SourceResult>, minIntervalMs = 0) => {
    if (!opts.sources.has(source)) return;
    const stored = await readFeedCursor(admin, orgId, feedName(source));
    const storedMs = stored ? Date.parse(stored) : NaN;
    if (Number.isFinite(storedMs) && nowMs - storedMs < minIntervalMs) {
      result[source] = { fetched: 0, written: 0, refused: 0, skipped: "not due" };
      return;
    }
    const first = !Number.isFinite(storedMs);
    const fromMs = first ? nowMs - firstRunDays * DAY_MS : storedMs - OVERLAP_MS;
    const ctx: WarningFetchContext = { env, token, priority: first ? "backfill" : "live", fetchImpl: opts.fetchImpl };
    try {
      result[source] = await work(fromMs, ctx);
      await persistFeedCursorQuietly(admin, orgId, feedName(source), seenAt);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result[source] = { fetched: 0, written: 0, refused: 0, error: message };
      failures.push(`${source}: ${message}`);
    }
  };

  const byId = new Map(opts.alertConfigs.map((c) => [c.id, c]));
  await run("alert", FIRST_RUN_DAYS, async (fromMs, ctx) => {
    if (byId.size === 0) return { fetched: 0, written: 0, refused: 0, skipped: "no alert rule is on" };
    const items = await fetchAlertIncidents(ctx, [...byId.keys()], new Date(fromMs).toISOString());
    return parseAndWrite(admin, items, (raw) => {
      const config = byId.get(String((raw as { configurationId?: unknown }).configurationId));
      return config ? alertIncidentRow(raw, config, { orgId, seenAt }) : null;
    });
  });
  await run("safety", FIRST_RUN_DAYS, async (fromMs, ctx) =>
    parseAndWrite(admin, await fetchSafetyEvents(ctx, new Date(fromMs).toISOString()), (raw) => safetyEventRow(raw, { orgId, seenAt })),
  );
  await run("dvir", DEFECT_FIRST_RUN_DAYS, async (fromMs, ctx) =>
    parseAndWrite(admin, await fetchDefects(ctx, new Date(fromMs).toISOString()), (raw) => defectRow(raw, { orgId, seenAt })),
  );
  await run(
    "hos",
    FIRST_RUN_DAYS,
    async (fromMs, ctx) => {
      const start = Math.min(fromMs, nowMs - HOS_REREAD_MS);
      const items = await fetchHosViolations(ctx, new Date(start).toISOString(), seenAt);
      return parseAndWrite(admin, items, (raw) => hosViolationRow(raw, { orgId, seenAt }));
    },
    HOS_MIN_INTERVAL_MS,
  );
  await run("atis", FIRST_RUN_DAYS, (fromMs, ctx) => syncAtis(admin, ctx, orgId, fromMs, nowMs, seenAt));
  await run("lamp", 0, (_fromMs, ctx) => syncEngineLamps(admin, ctx, orgId, nowMs, seenAt));

  if (failures.length > 0) {
    const err = new Error(`warning sync: ${failures.join("; ")}`) as Error & { result?: WarningsSyncResult };
    err.result = result;
    throw err;
  }
  return result;
}

/**
 * The org's Samsara alert configurations, for the desk's rules (D-WD10). Read live each tick — one
 * request — so a configuration added, renamed or disabled in Samsara shows on the next tick.
 */
export async function readAlertConfigurations(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { fetchImpl?: typeof fetch; tokenOverride?: string } = {},
): Promise<AlertConfigurationSummary[]> {
  const token = opts.tokenOverride ?? (await loadSamsaraToken(admin, env, orgId));
  if (!token) throw new NoSamsaraTokenError();
  return fetchAlertConfigurations({ env, token, priority: "live", fetchImpl: opts.fetchImpl });
}
