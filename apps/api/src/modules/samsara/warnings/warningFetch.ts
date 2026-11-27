/**
 * The warning desk's Samsara reads (WARNING-DESK-PLAN D-WD2). Read-only: every call is a GET with the
 * org's token through `samsaraFetch` (lane rate limit, 429/5xx retry). Each returns raw items; parsing
 * is `warningRows.ts`'s job.
 *
 * Endpoints and their limits as measured on the live account 2026-11-26:
 *   /alerts/configurations                 one page (17 configurations)
 *   /alerts/incidents/stream               `configurationIds` repeated, at most 50 per request; window
 *                                          on updatedAtTime, so a later "resolved" re-delivers the row
 *   /safety-events/stream                  window on updatedAtTime (coaching changes re-deliver)
 *   /defects/stream                        window on updatedAtTime
 *   /fleet/hos/violations                  startTime + endTime
 *   /readings/history?readingId=atisLamp   30 days answers 504; 3-day windows succeed (D-WD5)
 *   /fleet/vehicles/stats?types=faultCodes one page for the fleet
 */
import type { AlertConfigurationSummary } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { samsaraFetch } from "../lib/samsaraHttp.js";

export interface WarningFetchContext {
  env: Env;
  token: string;
  priority: "live" | "backfill";
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/** The longest any one page walk may run — a guard against a cursor that never ends, not a limit we expect to meet. */
const MAX_PAGES = 400;
export const ALERT_CONFIG_IDS_PER_REQUEST = 50;
export const ATIS_WINDOW_MS = 3 * 86_400_000;

type Params = Array<[string, string]>;

async function walk(ctx: WarningFetchContext, path: string, params: Params): Promise<unknown[]> {
  const out: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(path, ctx.env.SAMSARA_API_URL);
    for (const [k, v] of params) url.searchParams.append(k, v);
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(ctx.env, ctx.token, url, { priority: ctx.priority, fetchImpl: ctx.fetchImpl });
    if (!res.ok) throw new Error(`Samsara ${path} answered ${res.status}`);
    const json = (await res.json()) as { data?: unknown[]; pagination?: { endCursor?: string; hasNextPage?: boolean } };
    if (Array.isArray(json.data)) out.push(...json.data);
    if (!json.pagination?.hasNextPage || !json.pagination.endCursor) return out;
    after = json.pagination.endCursor;
  }
  throw new Error(`Samsara ${path}: more than ${MAX_PAGES} pages — refusing a partial read`);
}

export async function fetchAlertConfigurations(ctx: WarningFetchContext): Promise<AlertConfigurationSummary[]> {
  const items = await walk(ctx, "/alerts/configurations", [["status", "all"]]);
  const out: AlertConfigurationSummary[] = [];
  for (const raw of items) {
    const c = raw as { id?: unknown; name?: unknown; isEnabled?: unknown; triggers?: unknown };
    if (typeof c.id !== "string") continue;
    const triggers = Array.isArray(c.triggers) ? c.triggers : [];
    out.push({
      id: c.id,
      name: typeof c.name === "string" ? c.name : "Samsara alert",
      isEnabled: c.isEnabled === true,
      triggerTypeIds: triggers
        .map((t) => (t as { triggerTypeId?: unknown }).triggerTypeId)
        .filter((n): n is number => typeof n === "number"),
    });
  }
  return out;
}

export async function fetchAlertIncidents(ctx: WarningFetchContext, configIds: readonly string[], startIso: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < configIds.length; i += ALERT_CONFIG_IDS_PER_REQUEST) {
    const chunk = configIds.slice(i, i + ALERT_CONFIG_IDS_PER_REQUEST);
    out.push(...(await walk(ctx, "/alerts/incidents/stream", [["startTime", startIso], ...chunk.map((id): [string, string] => ["configurationIds", id])])));
  }
  return out;
}

export function fetchSafetyEvents(ctx: WarningFetchContext, startIso: string): Promise<unknown[]> {
  return walk(ctx, "/safety-events/stream", [
    ["startTime", startIso],
    ["includeAsset", "true"],
    ["includeDriver", "true"],
  ]);
}

export function fetchDefects(ctx: WarningFetchContext, startIso: string): Promise<unknown[]> {
  return walk(ctx, "/defects/stream", [["startTime", startIso]]);
}

/** HOS violations; Samsara groups them per driver-day, so the per-violation items are unwrapped here. */
export async function fetchHosViolations(ctx: WarningFetchContext, startIso: string, endIso: string): Promise<unknown[]> {
  const items = await walk(ctx, "/fleet/hos/violations", [["startTime", startIso], ["endTime", endIso]]);
  const out: unknown[] = [];
  for (const item of items) {
    const nested = (item as { violations?: unknown }).violations;
    if (Array.isArray(nested)) out.push(...nested);
    else out.push(item);
  }
  return out;
}

export interface AtisReading {
  entityId: string;
  at: string;
  on: boolean;
}

/** ATIS lamp readings for every trailer, in 3-day windows (a 30-day window answers 504). */
export async function fetchAtisReadings(ctx: WarningFetchContext, fromMs: number, toMs: number): Promise<AtisReading[]> {
  const out: AtisReading[] = [];
  for (let start = fromMs; start < toMs; start += ATIS_WINDOW_MS) {
    const end = Math.min(start + ATIS_WINDOW_MS, toMs);
    const items = await walk(ctx, "/readings/history", [
      ["readingId", "atisLamp"],
      ["entityType", "asset"],
      ["assetTypes", "trailer"],
      ["startTime", new Date(start).toISOString()],
      ["endTime", new Date(end).toISOString()],
    ]);
    for (const raw of items) {
      const r = raw as { entityId?: unknown; value?: unknown; happenedAtTime?: unknown };
      if (typeof r.entityId !== "string" || typeof r.happenedAtTime !== "string") continue;
      if (r.value !== "on" && r.value !== "off") continue;
      out.push({ entityId: r.entityId, at: new Date(Date.parse(r.happenedAtTime)).toISOString(), on: r.value === "on" });
    }
  }
  return out;
}

export function fetchFaultCodes(ctx: WarningFetchContext): Promise<unknown[]> {
  return walk(ctx, "/fleet/vehicles/stats", [["types", "faultCodes"]]);
}
