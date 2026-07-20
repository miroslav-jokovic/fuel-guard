/** Scoring orchestration: cascade, org backfill, import/vehicle scoring. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { attributeDrivers } from "../driverAttribution.js";
import { learnStationGeocodes } from "../stationGeocodeLearning.js";
import { loadSamsaraToken } from "../../lib/samsaraToken.js";
import { makeSamsaraFetcher } from "../../lib/samsara.js";
import { collectTxnIds, loadThresholds, loadOperatingHours } from "./loaders.js";
import type { BackfillOpts, ScoreOpts } from "./loaders.js";
import { scoreTransaction, learnVehicleValues } from "./scoreTransaction.js";

export async function scoreWithCascade(admin: SupabaseClient, env: Env, orgId: string, txnId: string): Promise<void> {
  await scoreTransaction(admin, env, orgId, txnId);
  const { data: row } = await admin.from("fuel_transactions").select("vehicle_id, fueled_at").eq("id", txnId).single();
  if (!row?.vehicle_id) return;
  const { data: next } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("vehicle_id", row.vehicle_id)
    .gt("fueled_at", row.fueled_at)
    .order("fueled_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }) // stable cascade set at the boundary (audit A2.5; idempotent re-score)
    .limit(5);
  for (const x of ((next ?? []) as { id: string }[])) await scoreTransaction(admin, env, orgId, x.id);
}

/**
 * Backfill / rebuild: score every transaction for an org in (vehicle, fueled_at) order. Pass
 * skipRecon=true for a rebuild of existing data so it reuses stored Samsara values (no live API spam).
 */
/** Optional progress callback for long loops — invoked periodically with (done, total). */
export type ProgressFn = (done: number, total: number) => Promise<void> | void;

/** Minimal per-fill metadata for grouping a live re-sync by vehicle before fetching Samsara (F3). */
interface TxnMeta {
  id: string;
  vehicleId: string | null;
  centerMs: number;
  precise: boolean;
}

/** Collect fill metadata (id + vehicle + time + precision), ordered by vehicle then time so consecutive
 *  same-vehicle fills are adjacent for bucketing. Paged past PostgREST's 1000-row cap (like collectTxnIds). */
async function collectTxnMeta(
  admin: SupabaseClient,
  orgId: string,
  opts: { onlyUnreconciled?: boolean; sinceDays?: number } = {},
): Promise<TxnMeta[]> {
  const PAGE = 1000;
  const out: TxnMeta[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin.from("fuel_transactions").select("id, vehicle_id, fueled_at, fueled_at_precision").eq("org_id", orgId);
    if (opts.onlyUnreconciled) q = q.is("samsara_recon_at", null);
    if (opts.sinceDays != null) q = q.gte("fueled_at", new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString());
    const { data } = await q
      .order("vehicle_id", { ascending: true })
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const rows = (data ?? []) as { id: string; vehicle_id: string | null; fueled_at: string; fueled_at_precision: string | null }[];
    for (const r of rows) out.push({ id: r.id, vehicleId: r.vehicle_id, centerMs: new Date(r.fueled_at).getTime(), precise: r.fueled_at_precision === "instant" });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Map org vehicle_id → samsara_vehicle_id (null when unmapped), so backfill knows which fills can be
 *  reconciled and can fetch each truck's telematics ONCE. Paged for large fleets. */
async function loadVehicleSamsaraMap(admin: SupabaseClient, orgId: string): Promise<Map<string, string | null>> {
  const PAGE = 1000;
  const map = new Map<string, string | null>();
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).range(offset, offset + PAGE - 1);
    const rows = (data ?? []) as { id: string; samsara_vehicle_id: string | null }[];
    for (const v of rows) map.set(v.id, v.samsara_vehicle_id ?? null);
    if (rows.length < PAGE) break;
  }
  return map;
}

const BACKFILL_ABORT_AFTER = 20; // consecutive all-failed reconcile attempts → abort a live re-sync
const BUCKET_MAX_MS = 96 * 3_600_000; // cap one grouped Samsara fetch window so it never over-paginates

export async function backfillOrg(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: BackfillOpts = {},
  onProgress?: ProgressFn,
  shouldCancel?: () => Promise<boolean>,
): Promise<number> {
  const { onlyUnreconciled, sinceDays, ...scoreOpts } = opts;
  // Maximize driver attribution before scoring: auto-create driver records for EFS names that have none and
  // link the previously-unattributed fills. Best-effort + idempotent, so a rebuild also repairs attribution.
  try {
    await attributeDrivers(admin, orgId);
  } catch (e) {
    console.error("[backfill] driver attribution failed:", e instanceof Error ? e.message : e);
  }
  // Upgrade city-level stations to learned 'site' coordinates from our own telematics, so more fills can be
  // location-CONFIRMED on the recon pass below. Best-effort; a re-check applies the new geocodes.
  try {
    await learnStationGeocodes(admin, orgId);
  } catch (e) {
    console.error("[backfill] station geocode learning failed:", e instanceof Error ? e.message : e);
  }
  // F2: load per-org context ONCE, not per fill.
  const ctxBase = { thresholds: await loadThresholds(admin, orgId), operatingHours: await loadOperatingHours(admin, orgId) };

  // Rebuild path (skipRecon): reuse stored Samsara values, no live fetch — simple sequential re-score.
  if (scoreOpts.skipRecon) {
    // Learn each vehicle's gating values (offset / tank reliability / capacity) ONCE up front from the
    // already-stored Samsara data, so every fill is scored against the CONVERGED values in a SINGLE pass —
    // a rebuild no longer has to be run twice for learned changes to take effect (audit R-3).
    const { data: vrows } = await admin.from("vehicles").select("id").eq("org_id", orgId);
    for (const v of (vrows ?? []) as { id: string }[]) {
      await learnVehicleValues(admin, v.id);
    }
    const ids = await collectTxnIds(admin, orgId, { onlyUnreconciled, sinceDays });
    const total = ids.length;
    let done = 0;
    for (const id of ids) {
      await scoreTransaction(admin, env, orgId, id, { ...scoreOpts, ctx: ctxBase, skipLearn: true });
      done++;
      if (done % 50 === 0 || done === total) {
        if (onProgress) await onProgress(done, total);
        if (shouldCancel && (await shouldCancel())) return done; // F6: stop gracefully; processed rows persist
      }
    }
    return total;
  }

  // ── Live recon path (F3 + F4): fetch each truck's telematics ONCE per bounded window and reuse it across
  // that truck's fills; reconcile multiple VEHICLES in parallel (bounded) to overlap fetch latency + DB
  // writes. Fills are ordered by vehicle then time; each worker owns a whole vehicle (sequential within it,
  // since a fill's scoring reads its prior fills), parallel across vehicles. ──
  const token = await loadSamsaraToken(admin, env, orgId);
  const ctx = { ...ctxBase, samsaraToken: token };
  const vehMap = await loadVehicleSamsaraMap(admin, orgId);
  const meta = await collectTxnMeta(admin, orgId, { onlyUnreconciled, sinceDays });
  const total = meta.length;
  const winMsOf = (m: TxnMeta) => (m.precise ? 18 : 30) * 3_600_000;

  // Group fills by vehicle, order preserved.
  const groups: TxnMeta[][] = [];
  {
    const byVehicle = new Map<string, TxnMeta[]>();
    for (const m of meta) {
      const key = m.vehicleId ?? "__none__";
      const g = byVehicle.get(key);
      if (g) g.push(m);
      else byVehicle.set(key, [m]);
    }
    for (const g of byVehicle.values()) groups.push(g);
  }

  let done = 0;
  const reconHealth = { attempts: 0, failures: 0 };
  let aborted: Error | null = null;
  let canceled = false;
  // Lightweight phase timing so we can see WHERE the wall-clock goes (Samsara fetch vs per-fill scoring/DB)
  // without guessing — logged every 200 fills.
  const timing = { fetchMs: 0, fetches: 0, scoreMs: 0 };
  const bump = async () => {
    done += 1;
    if (done % 200 === 0) {
      const avgFetch = timing.fetches ? Math.round(timing.fetchMs / timing.fetches) : 0;
      const avgScore = done ? Math.round(timing.scoreMs / done) : 0;
      console.log(`[backfill] ${done}/${total} — avg fetch ${avgFetch}ms/bucket (${timing.fetches} fetches), avg score ${avgScore}ms/fill`);
    }
    if (onProgress && (done % 50 === 0 || done === total)) await onProgress(done, total);
  };

  const processVehicle = async (fills: TxnMeta[]): Promise<void> => {
    const svid = fills[0]!.vehicleId ? vehMap.get(fills[0]!.vehicleId) ?? null : null;

    // No telematics possible (no token, unmapped truck, or no vehicle) → score deterministically only.
    if (!token || !svid) {
      for (const f of fills) {
        if (aborted || canceled) return;
        await scoreTransaction(admin, env, orgId, f.id, { ...scoreOpts, ctx });
        await bump();
      }
      return;
    }

    let i = 0;
    while (i < fills.length) {
      if (aborted || canceled) return;
      // Bucket consecutive fills whose windows overlap, capped so one fetch stays bounded.
      const bStart = fills[i]!.centerMs - winMsOf(fills[i]!);
      let bEnd = fills[i]!.centerMs + winMsOf(fills[i]!);
      const bucket: TxnMeta[] = [fills[i]!];
      let j = i + 1;
      while (j < fills.length) {
        const s = fills[j]!.centerMs - winMsOf(fills[j]!);
        const e = fills[j]!.centerMs + winMsOf(fills[j]!);
        if (s > bEnd) break; // gap → separate fetch (avoid a huge sparse window)
        if (e - bStart > BUCKET_MAX_MS) break; // exceeds fetch-window cap → close bucket
        bEnd = Math.max(bEnd, e);
        bucket.push(fills[j]!);
        j += 1;
      }

      let raw: unknown = null;
      let failed = false;
      const tFetch = Date.now();
      try {
        raw = await makeSamsaraFetcher(env, token, "backfill")(svid, new Date(bStart).toISOString(), new Date(bEnd).toISOString());
      } catch {
        failed = true;
      }
      timing.fetchMs += Date.now() - tFetch;
      timing.fetches += 1;
      reconHealth.attempts += bucket.length;
      if (failed) reconHealth.failures += bucket.length;

      for (const f of bucket) {
        if (aborted || canceled) return;
        const fillOpts: ScoreOpts = failed
          ? { ...scoreOpts, ctx, reconUnavailable: true }
          : { ...scoreOpts, ctx, prefetchedRaw: raw, geocodeCacheOnly: true };
        const tScore = Date.now();
        await scoreTransaction(admin, env, orgId, f.id, fillOpts);
        timing.scoreMs += Date.now() - tScore;
        await bump();
      }

      // Systemic-outage guard: if the first batch of real fetch attempts ALL failed, signal a loud abort.
      if (reconHealth.attempts >= BACKFILL_ABORT_AFTER && reconHealth.failures === reconHealth.attempts) {
        aborted = new Error(
          `Samsara telematics unavailable: first ${reconHealth.attempts} fetch attempts all failed. ` +
            `Aborting re-sync after ${done}/${total} rows to avoid marking fills blind — check the Samsara token, scopes, and stats request parameters.`,
        );
        return;
      }
      i = j;
    }
  };

  // Bounded worker pool over vehicles; workers poll cancel/abort between vehicles.
  let next = 0;
  const concurrency = Math.min(env.SAMSARA_BACKFILL_CONCURRENCY, Math.max(1, groups.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted || canceled) return;
      if (shouldCancel && (await shouldCancel())) {
        canceled = true; // F6: stop gracefully; processed rows are committed + checkpointed → re-run resumes
        return;
      }
      const k = next++;
      if (k >= groups.length) return;
      await processVehicle(groups[k]!);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (aborted) throw aborted; // F1: surface a systemic outage loudly
  return canceled ? done : total;
}

/** Score only the transactions from one import (post-import) — far cheaper than a full org backfill. */
export async function scoreImport(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  importId: string,
  onProgress?: ProgressFn,
): Promise<number> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("fuel_transactions")
      .select("id")
      .eq("org_id", orgId)
      .eq("import_id", importId)
      .order("vehicle_id", { ascending: true })
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const batch = ((data ?? []) as { id: string }[]).map((x) => x.id);
    ids.push(...batch);
    if (batch.length < PAGE) break;
  }
  const total = ids.length;
  let done = 0;
  for (const id of ids) {
    await scoreTransaction(admin, env, orgId, id);
    done++;
    if (onProgress && (done % 50 === 0 || done === total)) await onProgress(done, total);
  }
  return total;
}

/** Re-score every fill for ONE vehicle in chain order. Used by the post-import cascade (skipRecon). */
export async function scoreVehicle(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  vehicleId: string,
  opts: ScoreOpts = {},
): Promise<number> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("fuel_transactions")
      .select("id")
      .eq("org_id", orgId)
      .eq("vehicle_id", vehicleId)
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const batch = ((data ?? []) as { id: string }[]).map((x) => x.id);
    ids.push(...batch);
    if (batch.length < PAGE) break;
  }
  for (const id of ids) await scoreTransaction(admin, env, orgId, id, opts);
  return ids.length;
}

/** Distinct vehicle ids attributed to an import's fuel rows. */
export async function affectedVehicleIds(admin: SupabaseClient, orgId: string, importId: string): Promise<string[]> {
  const { data } = await admin
    .from("fuel_transactions")
    .select("vehicle_id")
    .eq("org_id", orgId)
    .eq("import_id", importId)
    .not("vehicle_id", "is", null);
  const set = new Set<string>();
  for (const r of (data ?? []) as { vehicle_id: string | null }[]) if (r.vehicle_id) set.add(r.vehicle_id);
  return [...set];
}

/**
 * Score an import, then AUTO-CASCADE: importing history changes MPG baselines and over-fuel windows for
 * the affected vehicles' neighboring fills, so re-score every fill of just those vehicles (skipRecon —
 * the new rows already did a live Samsara recon; neighbors reuse stored values). Scoped to the import's
 * vehicles, never the whole org — this is what removes the manual "go press Rebuild" step.
 */
export async function scoreImportWithCascade(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  importId: string,
  onProgress?: ProgressFn,
): Promise<{ scored: number; cascaded: number; vehicles: number }> {
  const scored = await scoreImport(admin, env, orgId, importId, onProgress);
  const vehicleIds = await affectedVehicleIds(admin, orgId, importId);
  let cascaded = 0;
  for (const vId of vehicleIds) cascaded += await scoreVehicle(admin, env, orgId, vId, { skipRecon: true });
  return { scored, cascaded, vehicles: vehicleIds.length };
}
