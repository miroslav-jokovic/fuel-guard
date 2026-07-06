import type { Env } from "../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/** Fetches one vehicle's GPS+odometer history for a time range. Injectable for tests. */
export type SamsaraFetcher = (
  vehicleId: string,
  startIso: string,
  endIso: string,
) => Promise<unknown>;

/** Shape of one stats-history page: per-vehicle arrays of gps / fuelPercents samples. */
interface StatsHistoryVehicle {
  id?: string;
  gps?: unknown[];
  fuelPercents?: unknown[];
  [k: string]: unknown;
}
interface StatsHistoryPage {
  data?: StatsHistoryVehicle[];
  pagination?: { endCursor?: string; hasNextPage?: boolean };
}

/** Safety cap on stats-history pages per fetch (512 samples/page × 40 ≈ a full day at 5s GPS pings). */
const MAX_STATS_PAGES = 40;

/**
 * Real Samsara stats-history fetcher (docs/10). Requests GPS with the OBD odometer decorated onto
 * each point, so every sample carries time + lat/lng + speed + reverse-geocoded address + odometer.
 *
 * CRITICAL: stats-history is PAGINATED. A 36–60h window at telematics ping rates exceeds one page,
 * and a truncated day previously caused false "truck was never there" location mismatches and wrong
 * odometer anchors. We follow `pagination.endCursor` and merge every page's sample arrays before
 * returning, so callers always see the complete window.
 */
export function makeSamsaraFetcher(env: Env, token: string): SamsaraFetcher {
  return async (vehicleId, startIso, endIso) => {
    const merged = new Map<string, StatsHistoryVehicle>();
    let after: string | undefined;
    let pages = 0;

    do {
      const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
      url.searchParams.set("vehicleIds", vehicleId);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      // gps (location + odometer) + fuelPercents (coarse tank level, for the advisory tank-fill check).
      url.searchParams.set("types", "gps,fuelPercents");
      url.searchParams.set("decorations", "obdOdometerMeters");
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url);
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as StatsHistoryPage;

      for (const v of page.data ?? []) {
        const key = String(v.id ?? vehicleId);
        const cur = merged.get(key);
        if (!cur) {
          merged.set(key, { ...v, gps: [...(v.gps ?? [])], fuelPercents: [...(v.fuelPercents ?? [])] });
        } else {
          if (v.gps?.length) cur.gps = [...(cur.gps ?? []), ...v.gps];
          if (v.fuelPercents?.length) cur.fuelPercents = [...(cur.fuelPercents ?? []), ...v.fuelPercents];
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
