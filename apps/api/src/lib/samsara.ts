import type { Env } from "../env.js";

/** Fetches one vehicle's GPS+odometer history for a time range. Injectable for tests. */
export type SamsaraFetcher = (
  vehicleId: string,
  startIso: string,
  endIso: string,
) => Promise<unknown>;

/**
 * Real Samsara stats-history fetcher (docs/10). Requests GPS with the OBD odometer decorated onto
 * each point, so every sample carries time + lat/lng + speed + reverse-geocoded address + odometer.
 */
export function makeSamsaraFetcher(env: Env, token: string): SamsaraFetcher {
  return async (vehicleId, startIso, endIso) => {
    const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
    url.searchParams.set("vehicleIds", vehicleId);
    url.searchParams.set("startTime", startIso);
    url.searchParams.set("endTime", endIso);
    // gps (location + odometer) + fuelPercents (coarse tank level, for the advisory tank-fill check).
    url.searchParams.set("types", "gps,fuelPercents");
    url.searchParams.set("decorations", "obdOdometerMeters");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    return res.json();
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
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
    const data = await listAllPages(env, token, "/fleet/vehicles/stats", {
      types: "obdOdometerMeters,gpsOdometerMeters",
    });
    return { data };
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
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3_600_000);
    const data = await listAllPages(env, token, "/fleet/driver-vehicle-assignments", {
      filterBy: "vehicles",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    return { data };
  };
}
