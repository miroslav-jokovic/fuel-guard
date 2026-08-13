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
 * grouped backfill (up to ~96h); real GPS volume is HOS-bounded so this is only a runaway guard. */
export const MAX_STATS_PAGES = 120;

/** Samsara caps /fleet/vehicles/stats/history (and the trailer variant) at 10 req/s per token
 * (endpoint "Level Three" — developers.samsara.com/docs/rate-limits). The lane pacing alone can
 * exceed that (live lane = SAMSARA_MAX_RPS x SAMSARA_LIVE_RPS_FRACTION, 12 req/s at defaults), so
 * every stats-history call also carries this endpoint cap; samsaraFetch applies whichever is lower.
 * Kept a hair under the published limit so pacing jitter cannot brush the ceiling. */
export const STATS_HISTORY_MAX_RPS = 9;

/**
 * Real Samsara stats-history fetcher (docs/10). Requests GPS with the OBD odometer decorated onto
 * each point, so every sample carries time + lat/lng + speed + reverse-geocoded address + odometer.
 *
 * CRITICAL: stats-history is PAGINATED. A 36–60h window at telematics ping rates exceeds one page,
 * and a truncated day previously caused false "truck was never there" location mismatches and wrong
 * odometer anchors. We follow `pagination.endCursor` and merge every page's sample arrays before
 * returning, so callers always see the complete window.
 */
export function makeSamsaraFetcher(
  env: Env,
  token: string,
  priority: "live" | "backfill" = "live",
): SamsaraFetcher {
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
      const res = await samsaraFetch(env, token, url, { priority, maxRps: STATS_HISTORY_MAX_RPS });
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
          if (v.fuelPercents?.length)
            cur.fuelPercents = [...(cur.fuelPercents ?? []), ...v.fuelPercents];
          if (v.gpsOdometerMeters?.length)
            cur.gpsOdometerMeters = [...(cur.gpsOdometerMeters ?? []), ...v.gpsOdometerMeters];
        }
      }

      after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
      pages += 1;
    } while (after && pages < MAX_STATS_PAGES);

    return { data: [...merged.values()] };
  };
}
