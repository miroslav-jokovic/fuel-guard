import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import { MAX_STATS_PAGES, STATS_HISTORY_MAX_RPS } from "./samsaraStats.js";
import type { SamsaraNumericStatEvent } from "./samsara.js";

/**
 * Cumulative odometer history from `/fleet/vehicles/stats/history` (W3b).
 *
 * The endpoint is the same one the idle and telemetry fetchers already call, batched the same way,
 * with a different `types` list. Three things about it are not obvious and each has cost this repo
 * time, so they are stated here rather than rediscovered:
 *
 *  1. **`gpsOdometerMeters` is a stat TYPE, not a `decorations` value.** Passing it in `decorations`
 *     makes Samsara reject the ENTIRE request with HTTP 400 — the bug that once produced 0%
 *     telematics coverage (see the note in `samsaraStats.ts`). This fetcher passes no decorations at
 *     all: a counter needs a time and a value, nothing else.
 *  2. **At most three stat types per request.** Two are requested here, which leaves headroom rather
 *     than sitting on the limit.
 *  3. **It is PAGINATED**, and a truncated page is worse here than elsewhere: the collector keeps the
 *     LAST reading of each day, so a walk cut short does not thin the data evenly, it removes exactly
 *     the readings that would have been kept. `complete` is returned so the caller can refuse to
 *     write rather than store a quietly earlier odometer.
 *
 * `samsaraFetch` already carries per-token rate limiting (this endpoint's own 10 req/s cap included),
 * 429/5xx retry with jitter and a request deadline, so nothing about that is re-implemented.
 */

/** The two counters this collector requests, in Samsara's own ranking. */
export const ODOMETER_STAT_TYPES = "obdOdometerMeters,gpsDistanceMeters" as const;

/** One vehicle's counter series as Samsara returns them, values in metres. */
export interface SamsaraOdometerVehicleRecord {
  id?: string | number;
  /** The ECU's own odometer — Samsara's "most accurate" source. */
  obdOdometerMeters?: SamsaraNumericStatEvent[];
  /** GPS-derived cumulative distance — the fallback where the ECU exposes no odometer. */
  gpsDistanceMeters?: SamsaraNumericStatEvent[];
}

export interface OdometerHistoryFetchResult {
  data: SamsaraOdometerVehicleRecord[];
  /** False means Samsara indicated another page but the configured page cap was reached. */
  complete: boolean;
  pages: number;
}

export type OdometerHistoryFetcher = (
  ids: string[],
  startIso: string,
  endIso: string,
) => Promise<OdometerHistoryFetchResult>;

export function makeSamsaraOdometerFetcher(env: Env, token: string): OdometerHistoryFetcher {
  return async (ids, startIso, endIso) => {
    const merged = new Map<string, SamsaraOdometerVehicleRecord>();
    let after: string | undefined;
    let pages = 0;
    do {
      const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
      url.searchParams.set("vehicleIds", ids.join(","));
      url.searchParams.set("types", ODOMETER_STAT_TYPES);
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, {
        // A daily collector is never what a user is waiting for; it yields the live lane to the
        // stats feed and the per-fill reconciliation.
        priority: "backfill",
        maxRps: STATS_HISTORY_MAX_RPS,
      });
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as {
        data?: SamsaraOdometerVehicleRecord[];
        pagination?: { hasNextPage?: boolean; endCursor?: string };
      };
      for (const record of page.data ?? []) {
        const key = String(record.id ?? "");
        if (!key) continue;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, {
            id: record.id,
            obdOdometerMeters: [...(record.obdOdometerMeters ?? [])],
            gpsDistanceMeters: [...(record.gpsDistanceMeters ?? [])],
          });
        } else {
          existing.obdOdometerMeters = [
            ...(existing.obdOdometerMeters ?? []),
            ...(record.obdOdometerMeters ?? []),
          ];
          existing.gpsDistanceMeters = [
            ...(existing.gpsDistanceMeters ?? []),
            ...(record.gpsDistanceMeters ?? []),
          ];
        }
      }
      const hasNextPage = page.pagination?.hasNextPage === true;
      const nextCursor = page.pagination?.endCursor;
      // A "next page" with no cursor would loop this walk forever on the same page; the engine-states
      // fetcher learned that first and says so out loud rather than spinning.
      if (hasNextPage && !nextCursor) {
        throw new Error("Samsara odometer pagination reported a next page without a cursor");
      }
      after = hasNextPage ? nextCursor : undefined;
      pages += 1;
    } while (after && pages < MAX_STATS_PAGES);
    return { data: [...merged.values()], complete: after == null, pages };
  };
}
