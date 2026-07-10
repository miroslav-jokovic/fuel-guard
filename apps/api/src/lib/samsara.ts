import type { Env } from "../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/** Fetches one vehicle's GPS+odometer history for a time range. Injectable for tests. */
export type SamsaraFetcher = (
  vehicleId: string,
  startIso: string,
  endIso: string,
) => Promise<unknown>;

/** Shape of one stats-history page: per-vehicle arrays of gps / fuelPercents / gpsOdometerMeters samples. */
interface StatsHistoryVehicle {
  id?: string;
  gps?: unknown[];
  fuelPercents?: unknown[];
  gpsOdometerMeters?: unknown[];
  [k: string]: unknown;
}
interface StatsHistoryPage {
  data?: StatsHistoryVehicle[];
  pagination?: { endCursor?: string; hasNextPage?: boolean };
}

/** Safety cap on stats-history pages per fetch. Raised to cover the wider per-vehicle windows used by the
 *  grouped backfill (up to ~96h); real GPS volume is HOS-bounded so this is only a runaway guard. */
const MAX_STATS_PAGES = 120;

/**
 * Real Samsara stats-history fetcher (docs/10). Requests GPS with the OBD odometer decorated onto
 * each point, so every sample carries time + lat/lng + speed + reverse-geocoded address + odometer.
 *
 * CRITICAL: stats-history is PAGINATED. A 36–60h window at telematics ping rates exceeds one page,
 * and a truncated day previously caused false "truck was never there" location mismatches and wrong
 * odometer anchors. We follow `pagination.endCursor` and merge every page's sample arrays before
 * returning, so callers always see the complete window.
 */
export function makeSamsaraFetcher(env: Env, token: string, priority: "live" | "backfill" = "live"): SamsaraFetcher {
  return async (vehicleId, startIso, endIso) => {
    const merged = new Map<string, StatsHistoryVehicle>();
    let after: string | undefined;
    let pages = 0;

    do {
      const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
      url.searchParams.set("vehicleIds", vehicleId);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      // Three stat TYPES (Samsara allows ≤3): gps (location + OBD-odo decoration), fuelPercents (tank
      // level), and gpsOdometerMeters (GPS-derived odometer for trucks WITHOUT ECU/OBD coverage).
      url.searchParams.set("types", "gps,fuelPercents,gpsOdometerMeters");
      // OBD odometer decorated onto each GPS point. IMPORTANT: only `obdOdometerMeters` is a valid
      // `decorations` value. `gpsOdometerMeters` is a stat *type* (requested above), NOT a decoration —
      // passing it in `decorations` makes Samsara reject the ENTIRE request with HTTP 400 (the bug that
      // produced 0% telematics coverage). parseSamsaraSamples merges the type series in by nearest time.
      url.searchParams.set("decorations", "obdOdometerMeters");
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, { priority });
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as StatsHistoryPage;

      for (const v of page.data ?? []) {
        const key = String(v.id ?? vehicleId);
        const cur = merged.get(key);
        if (!cur) {
          merged.set(key, {
            ...v,
            gps: [...(v.gps ?? [])],
            fuelPercents: [...(v.fuelPercents ?? [])],
            gpsOdometerMeters: [...(v.gpsOdometerMeters ?? [])],
          });
        } else {
          if (v.gps?.length) cur.gps = [...(cur.gps ?? []), ...v.gps];
          if (v.fuelPercents?.length) cur.fuelPercents = [...(cur.fuelPercents ?? []), ...v.fuelPercents];
          if (v.gpsOdometerMeters?.length) cur.gpsOdometerMeters = [...(cur.gpsOdometerMeters ?? []), ...v.gpsOdometerMeters];
        }
      }

      after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
      pages += 1;
    } while (after && pages < MAX_STATS_PAGES);

    return { data: [...merged.values()] };
  };
}

/** Follows the `after` cursor through every page of a Samsara list endpoint, merging `data`. */
async function listAllPages(
  env: Env,
  token: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<unknown[]> {
  const out: unknown[] = [];
  let after: string | undefined;
  do {
    const url = new URL(path, env.SAMSARA_API_URL);
    url.searchParams.set("limit", "512");
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    const json = (await res.json()) as {
      data?: unknown[];
      pagination?: { endCursor?: string; hasNextPage?: boolean };
    };
    if (Array.isArray(json.data)) out.push(...json.data);
    after = json.pagination?.hasNextPage ? json.pagination.endCursor : undefined;
  } while (after);
  return out;
}

/** Lists every POWERED vehicle (trucks only — trailers are separate /assets) for the org. */
export type SamsaraVehicleLister = () => Promise<unknown[]>;

/** Fetch all pages of `GET /fleet/vehicles` — the merged `data` array of raw vehicle objects. */
export function makeSamsaraVehicleLister(env: Env, token: string): SamsaraVehicleLister {
  return () => listAllPages(env, token, "/fleet/vehicles");
}

/** Fetches the latest odometer stat for every vehicle (obd preferred, gps fallback). */
export type SamsaraOdometerFetcher = () => Promise<{ data?: unknown[] }>;

export function makeSamsaraOdometerFetcher(env: Env, token: string): SamsaraOdometerFetcher {
  return async () => {
    // One call for odometer + current fuel level.
    const data = await listAllPages(env, token, "/fleet/vehicles/stats", {
      types: "obdOdometerMeters,gpsOdometerMeters,fuelPercents",
    });
    return { data };
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
export type SamsaraTrailerAssignmentFetcher = () => Promise<{ trailers?: unknown[]; data?: unknown[] }>;

export function makeSamsaraTrailerAssignmentFetcher(env: Env, token: string): SamsaraTrailerAssignmentFetcher {
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
    const res = await samsaraFetch(env, token, url, { priority: "backfill" });
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    const page = (await res.json()) as { data?: AssetGpsRaw[]; pagination?: { hasNextPage?: boolean; endCursor?: string } };
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

export type AssetGpsFetcher = (ids: string[], startIso: string, endIso: string) => Promise<{ data: AssetGpsRaw[] }>;

/** Trailer GPS history (Asset-Gateway location) — the reefer's own position over time. */
export function makeSamsaraTrailerGpsFetcher(env: Env, token: string): AssetGpsFetcher {
  return (ids, s, e) => fetchAssetGpsHistory(env, token, "/fleet/trailers/stats/history", "trailerIds", ids, s, e);
}

/** Vehicle GPS history (types=gps only) — lighter than makeSamsaraFetcher; for bulk co-location matching. */
export function makeSamsaraVehiclesGpsFetcher(env: Env, token: string): AssetGpsFetcher {
  return (ids, s, e) => fetchAssetGpsHistory(env, token, "/fleet/vehicles/stats/history", "vehicleIds", ids, s, e);
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
    // Look back a week so a truck idle for a few days still resolves to its last driver.
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 3_600_000);
    const data = await listAllPages(env, token, "/fleet/driver-vehicle-assignments", {
      filterBy: "vehicles",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    return { data };
  };
}
