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
