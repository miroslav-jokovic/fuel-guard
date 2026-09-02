import type { StatsFeedPage } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import { listAllPages } from "./samsaraPaging.js";
import { MAX_STATS_PAGES, STATS_HISTORY_MAX_RPS } from "./samsaraStats.js";

export { makeSamsaraFetcher, type SamsaraFetcher } from "./samsaraStats.js";
export {
  makeSamsaraDriverEfficiencyFetcher,
  makeSamsaraHosFetcher,
  makeSamsaraSafetyScoreFetcher,
  type SamsaraDriverEfficiencyFetcher,
  type SamsaraSafetyScoreFetcher,
} from "./samsaraDriverPerformance.js";

/** Lists every POWERED vehicle (trucks only — trailers are separate /assets) for the org. */
export type SamsaraVehicleLister = () => Promise<unknown[]>;

/** Fetch all pages of `GET /fleet/vehicles` — the merged `data` array of raw vehicle objects. */
export function makeSamsaraVehicleLister(env: Env, token: string): SamsaraVehicleLister {
  return () => listAllPages(env, token, "/fleet/vehicles");
}

/** Fetches the latest odometer stat for every vehicle (obd preferred, gps fallback). */
export type SamsaraOdometerFetcher = () => Promise<{ data?: unknown[] }>;

/** Current GPS snapshot for one vehicle (types=gps). Returns null if no fix is available. */
export async function fetchVehicleCurrentGps(
  env: Env,
  token: string,
  vehicleId: string,
): Promise<{ lat: number; lng: number; time: string | null } | null> {
  const data = await listAllPages(env, token, "/fleet/vehicles/stats", {
    types: "gps",
    vehicleIds: vehicleId,
  });
  const v = (
    data as Array<{
      id?: string | number;
      gps?: { latitude?: number; longitude?: number; time?: string };
    }>
  ).find((x) => String(x.id) === String(vehicleId));
  const g = v?.gps;
  if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude))
    return { lat: g.latitude!, lng: g.longitude!, time: g.time ?? null };
  return null;
}

export function makeSamsaraOdometerFetcher(env: Env, token: string): SamsaraOdometerFetcher {
  return async () => {
    // One call for odometer + current fuel level.
    const data = await listAllPages(env, token, "/fleet/vehicles/stats", {
      types: "obdOdometerMeters,gpsOdometerMeters,fuelPercents",
    });
    return { data };
  };
}

/**
 * ONE page of the vehicle-stats DELTA FEED, resumed from a caller-supplied cursor (SAM-S2, D-SAM4).
 *
 * Deliberately not `listAllPages`: that helper walks `pagination.endCursor` in a LOCAL variable and
 * returns the merged rows, which is intra-request paging and is exactly the thing the plan identifies
 * as why nothing in this product has ever resumed anything (§0.2). Here the cursor belongs to the
 * caller — it is persisted in `samsara_feed_cursors` between runs — so the fetcher hands back one page
 * plus its cursor and lets the caller decide when to advance it.
 *
 * ⚠ The caller must NOT loop on `pagination.hasNextPage`. Measured on the live feed 2026-09-01 it is
 * `true` on every page, forever; `feedPageHasData` is the termination test. See `statsFeed.ts`.
 */
export type SamsaraStatsFeedFetcher = (after?: string) => Promise<StatsFeedPage>;

export function makeSamsaraStatsFeedFetcher(env: Env, token: string): SamsaraStatsFeedFetcher {
  return async (after?: string) => {
    const url = new URL("/fleet/vehicles/stats/feed", env.SAMSARA_API_URL);
    url.searchParams.set("types", "obdOdometerMeters,gpsOdometerMeters,fuelPercents");
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    return (await res.json()) as StatsFeedPage;
  };
}

/** Lists every trailer (unpowered asset) in the org. */
export type SamsaraTrailerLister = () => Promise<unknown[]>;

/** Fetch all pages of `GET /fleet/trailers` — the merged `data` array of raw trailer objects. */
export function makeSamsaraTrailerLister(env: Env, token: string): SamsaraTrailerLister {
  return () => listAllPages(env, token, "/fleet/trailers");
}

/** Fetches current trailer↔tractor assignments. Uses the LEGACY v1 endpoint (`/v1/fleet/trailers/
 *  assignments`) — the v2 API has no trailer-assignments route, which is why pairing never synced. */
export type SamsaraTrailerAssignmentFetcher = () => Promise<{
  trailers?: unknown[];
  data?: unknown[];
}>;

export function makeSamsaraTrailerAssignmentFetcher(
  env: Env,
  token: string,
): SamsaraTrailerAssignmentFetcher {
  return async () => {
    const url = new URL("/v1/fleet/trailers/assignments", env.SAMSARA_API_URL);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    return (await res.json()) as { trailers?: unknown[]; data?: unknown[] };
  };
}

/** GPS history (types=gps only) for a set of assets over a window, paginated + merged by asset id. Used for
 *  reefer↔tractor co-location pairing. `path` is the stats/history endpoint (vehicles or trailers). */
type AssetGpsRaw = { id?: string | number; gps?: unknown[] };
async function fetchAssetGpsHistory(
  env: Env,
  token: string,
  path: string,
  idParam: string,
  ids: string[],
  startIso: string,
  endIso: string,
): Promise<{ data: AssetGpsRaw[] }> {
  const merged = new Map<string, AssetGpsRaw>();
  let after: string | undefined;
  let pages = 0;
  do {
    const url = new URL(path, env.SAMSARA_API_URL);
    url.searchParams.set(idParam, ids.join(","));
    url.searchParams.set("types", "gps");
    url.searchParams.set("startTime", startIso);
    url.searchParams.set("endTime", endIso);
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url, {
      priority: "backfill",
      maxRps: STATS_HISTORY_MAX_RPS,
    });
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    const page = (await res.json()) as {
      data?: AssetGpsRaw[];
      pagination?: { hasNextPage?: boolean; endCursor?: string };
    };
    for (const a of page.data ?? []) {
      const key = String(a.id ?? "");
      const cur = merged.get(key);
      if (!cur) merged.set(key, { ...a, gps: [...(a.gps ?? [])] });
      else if (a.gps?.length) cur.gps = [...(cur.gps ?? []), ...a.gps];
    }
    after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    pages += 1;
  } while (after && pages < MAX_STATS_PAGES);
  return { data: [...merged.values()] };
}

export type AssetGpsFetcher = (
  ids: string[],
  startIso: string,
  endIso: string,
) => Promise<{ data: AssetGpsRaw[] }>;

/** Trailer GPS history (Asset-Gateway location) — the reefer's own position over time. */
export function makeSamsaraTrailerGpsFetcher(env: Env, token: string): AssetGpsFetcher {
  return (ids, s, e) =>
    fetchAssetGpsHistory(env, token, "/fleet/trailers/stats/history", "trailerIds", ids, s, e);
}

/** Vehicle GPS history (types=gps only) — lighter than makeSamsaraFetcher; for bulk co-location matching. */
export function makeSamsaraVehiclesGpsFetcher(env: Env, token: string): AssetGpsFetcher {
  return (ids, s, e) =>
    fetchAssetGpsHistory(env, token, "/fleet/vehicles/stats/history", "vehicleIds", ids, s, e);
}

/** Vehicle engineStates history decorated with gps (speed), for idle park-session / mode analysis. */
export interface SamsaraEngineStateRecord {
  time?: string;
  value?: string;
  decorations?: {
    gps?: {
      speedMilesPerHour?: number;
    };
  };
}

export interface SamsaraEngineVehicleRecord {
  id?: string | number;
  engineStates?: SamsaraEngineStateRecord[];
}

export interface SamsaraNumericStatEvent {
  time?: string;
  value?: number;
}

export interface SamsaraVehicleTelemetryRecord {
  id?: string | number;
  batteryMilliVolts?: SamsaraNumericStatEvent[];
  engineRpm?: SamsaraNumericStatEvent[];
  engineLoadPercent?: SamsaraNumericStatEvent[];
  ecuSpeedMph?: SamsaraNumericStatEvent[];
}

export interface EngineStatesFetchResult {
  data: SamsaraEngineVehicleRecord[];
  /** False means Samsara indicated another page but the configured page cap was reached. */
  complete: boolean;
  pages: number;
}

export interface VehicleTelemetryFetchResult {
  data: SamsaraVehicleTelemetryRecord[];
  complete: boolean;
  pages: number;
}

export type VehicleTelemetryFetcher = (
  ids: string[],
  startIso: string,
  endIso: string,
) => Promise<VehicleTelemetryFetchResult>;

export type EngineStatesFetcher = (
  ids: string[],
  startIso: string,
  endIso: string,
) => Promise<EngineStatesFetchResult>;
export function makeSamsaraEngineStatesFetcher(env: Env, token: string): EngineStatesFetcher {
  return async (ids, startIso, endIso) => {
    const merged = new Map<string, SamsaraEngineVehicleRecord>();
    let after: string | undefined;
    let pages = 0;
    do {
      const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
      url.searchParams.set("vehicleIds", ids.join(","));
      url.searchParams.set("types", "engineStates");
      url.searchParams.set("decorations", "gps");
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, {
        priority: "backfill",
        maxRps: STATS_HISTORY_MAX_RPS,
      });
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as {
        data?: SamsaraEngineVehicleRecord[];
        pagination?: { hasNextPage?: boolean; endCursor?: string };
      };
      for (const v of page.data ?? []) {
        const key = String(v.id ?? "");
        const cur = merged.get(key);
        if (!cur) merged.set(key, { ...v, engineStates: [...(v.engineStates ?? [])] });
        else if (v.engineStates?.length)
          cur.engineStates = [...(cur.engineStates ?? []), ...v.engineStates];
      }
      const hasNextPage = page.pagination?.hasNextPage === true;
      const nextCursor = page.pagination?.endCursor;
      if (hasNextPage && !nextCursor) {
        throw new Error("Samsara engine-states pagination reported a next page without a cursor");
      }
      after = hasNextPage ? nextCursor : undefined;
      pages += 1;
    } while (after && pages < MAX_STATS_PAGES);
    return { data: [...merged.values()], complete: after == null, pages };
  };
}

/** Historical numeric telemetry used for idle evidence. The two requests respect Samsara's three-type limit. */
export function makeSamsaraVehicleTelemetryFetcher(
  env: Env,
  token: string,
): VehicleTelemetryFetcher {
  return async (ids, startIso, endIso) => {
    const first = await fetchVehicleTelemetryStats(
      env,
      token,
      ids,
      startIso,
      endIso,
      "batteryMilliVolts,engineRpm,engineLoadPercent",
    );
    const second = await fetchVehicleTelemetryStats(
      env,
      token,
      ids,
      startIso,
      endIso,
      "ecuSpeedMph",
    );
    const merged = new Map<string, SamsaraVehicleTelemetryRecord>();
    for (const record of [...first.data, ...second.data]) {
      const key = String(record.id ?? "");
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          id: record.id,
          batteryMilliVolts: [...(record.batteryMilliVolts ?? [])],
          engineRpm: [...(record.engineRpm ?? [])],
          engineLoadPercent: [...(record.engineLoadPercent ?? [])],
          ecuSpeedMph: [...(record.ecuSpeedMph ?? [])],
        });
      } else {
        existing.batteryMilliVolts = [
          ...(existing.batteryMilliVolts ?? []),
          ...(record.batteryMilliVolts ?? []),
        ];
        existing.engineRpm = [...(existing.engineRpm ?? []), ...(record.engineRpm ?? [])];
        existing.engineLoadPercent = [
          ...(existing.engineLoadPercent ?? []),
          ...(record.engineLoadPercent ?? []),
        ];
        existing.ecuSpeedMph = [...(existing.ecuSpeedMph ?? []), ...(record.ecuSpeedMph ?? [])];
      }
    }
    return {
      data: [...merged.values()],
      complete: first.complete && second.complete,
      pages: first.pages + second.pages,
    };
  };
}

async function fetchVehicleTelemetryStats(
  env: Env,
  token: string,
  ids: string[],
  startIso: string,
  endIso: string,
  types: string,
): Promise<VehicleTelemetryFetchResult> {
  const merged = new Map<string, SamsaraVehicleTelemetryRecord>();
  let after: string | undefined;
  let pages = 0;
  do {
    const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
    url.searchParams.set("vehicleIds", ids.join(","));
    url.searchParams.set("types", types);
    url.searchParams.set("startTime", startIso);
    url.searchParams.set("endTime", endIso);
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url, {
      priority: "backfill",
      maxRps: STATS_HISTORY_MAX_RPS,
    });
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    const page = (await res.json()) as {
      data?: SamsaraVehicleTelemetryRecord[];
      pagination?: { hasNextPage?: boolean; endCursor?: string };
    };
    for (const record of page.data ?? []) {
      const key = String(record.id ?? "");
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...record });
      } else {
        existing.batteryMilliVolts = [
          ...(existing.batteryMilliVolts ?? []),
          ...(record.batteryMilliVolts ?? []),
        ];
        existing.engineRpm = [...(existing.engineRpm ?? []), ...(record.engineRpm ?? [])];
        existing.engineLoadPercent = [
          ...(existing.engineLoadPercent ?? []),
          ...(record.engineLoadPercent ?? []),
        ];
        existing.ecuSpeedMph = [...(existing.ecuSpeedMph ?? []), ...(record.ecuSpeedMph ?? [])];
      }
    }
    const hasNextPage = page.pagination?.hasNextPage === true;
    const nextCursor = page.pagination?.endCursor;
    if (hasNextPage && !nextCursor)
      throw new Error("Samsara telemetry pagination reported a next page without a cursor");
    after = hasNextPage ? nextCursor : undefined;
    pages += 1;
  } while (after && pages < MAX_STATS_PAGES);
  return { data: [...merged.values()], complete: after == null, pages };
}

/** Idling events over a window (GET /idling/events) — paginated + merged. Scope: Read Idling. */
export type SamsaraIdlingFetcher = (
  startIso: string,
  endIso: string,
) => Promise<{ data: unknown[] }>;
export function makeSamsaraIdlingEventFetcher(env: Env, token: string): SamsaraIdlingFetcher {
  return async (startIso, endIso) => {
    const out: unknown[] = [];
    let after: string | undefined;
    do {
      const url = new URL("/idling/events", env.SAMSARA_API_URL);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      url.searchParams.set("limit", "200");
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url);
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as {
        data?: unknown[];
        pagination?: { hasNextPage?: boolean; endCursor?: string };
      };
      if (Array.isArray(page.data)) out.push(...page.data);
      after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    } while (after);
    return { data: out };
  };
}

/** HOS duty-status logs over a window (GET /fleet/hos/logs) — paginated + merged. Scope: Read ELD Compliance
 *  Settings (US). Rate limit 5 req/s. Returns the raw per-driver `data[]` for parseHosLogs to normalize. */
export type SamsaraHosLogsFetcher = (
  startIso: string,
  endIso: string,
) => Promise<{ data: unknown[] }>;
export function makeSamsaraHosLogsFetcher(env: Env, token: string): SamsaraHosLogsFetcher {
  return async (startIso, endIso) => {
    const out: unknown[] = [];
    let after: string | undefined;
    do {
      const url = new URL("/fleet/hos/logs", env.SAMSARA_API_URL);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, { maxRps: 5 });
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as {
        data?: unknown[];
        pagination?: { hasNextPage?: boolean; endCursor?: string };
      };
      if (Array.isArray(page.data)) out.push(...page.data);
      after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    } while (after);
    return { data: out };
  };
}

/** HOS clocks (GET /fleet/hos/clocks) — the live "current duty status for all drivers" snapshot. Returns the
 *  raw per-driver `data[]` for parseHosClocks. Same ELD scope as the logs feed. */
export type SamsaraHosClocksFetcher = () => Promise<{ data: unknown[] }>;
export function makeSamsaraHosClocksFetcher(env: Env, token: string): SamsaraHosClocksFetcher {
  return async () => ({ data: await listAllPages(env, token, "/fleet/hos/clocks") });
}

/** Current GPS snapshot for EVERY vehicle (GET /fleet/vehicles/stats?types=gps) — one paginated call for
 *  the whole fleet. Each entry carries lat/lng + Samsara's own `reverseGeo.formattedLocation`, so driver
 *  location display needs no external geocoder. Raw `data[]` for parseVehicleGpsSnapshots. */
export type SamsaraGpsSnapshotFetcher = () => Promise<{ data?: unknown[] }>;
export function makeSamsaraGpsSnapshotFetcher(env: Env, token: string): SamsaraGpsSnapshotFetcher {
  return async () => ({
    data: await listAllPages(env, token, "/fleet/vehicles/stats", { types: "gps" }),
  });
}

/** Lists every driver in the org. */
export type SamsaraDriverLister = () => Promise<unknown[]>;

/** Fetch all pages of `GET /fleet/drivers` — the merged `data` array of raw driver objects. */
export function makeSamsaraDriverLister(env: Env, token: string): SamsaraDriverLister {
  return () => listAllPages(env, token, "/fleet/drivers");
}

/** Fetches current driver↔vehicle assignments (grouped by vehicle). */
export type SamsaraAssignmentFetcher = () => Promise<{ data?: unknown[] }>;

export function makeSamsaraAssignmentFetcher(env: Env, token: string): SamsaraAssignmentFetcher {
  return async () => {
    // A window ending now (not a zero-width now→now, which can return nothing). Any assignment active
    // now overlaps this window; the shared parser keeps only those still active at "now".
    // Look back 30 days (matches the idle window) so idle events can be attributed to the driver assigned at
    // that time, and a truck idle for days still resolves to its last driver.
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 3_600_000);
    const data = await listAllPages(env, token, "/fleet/driver-vehicle-assignments", {
      filterBy: "vehicles",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    return { data };
  };
}
