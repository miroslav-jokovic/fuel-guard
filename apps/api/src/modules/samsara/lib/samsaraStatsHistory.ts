/**
 * `GET /fleet/vehicles/stats/history` for any set of stat types, paged to the end and merged per
 * vehicle — and `GET /fleet/vehicles/stats` for the latest value of each. Built for the idle engine
 * (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE2), which reads four series the older fetchers each
 * hard-code a different subset of (`engineStates` with a gps decoration, `gps` alone, three
 * telemetry types). A fifth copy of the same paging loop would be the copy; this one takes the
 * types as an argument.
 *
 * Every array on a vehicle record is a sample series and is concatenated across pages, whatever
 * its name, so a new stat type needs no change here. `complete` is false when the page cap stopped
 * the walk — a caller writing a window it did not fully read must know it.
 */
import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";
import { listAllPages } from "./samsaraPaging.js";
import { MAX_STATS_PAGES, STATS_HISTORY_MAX_RPS } from "./samsaraStats.js";

export interface StatsHistoryResult {
  data: Record<string, unknown>[];
  complete: boolean;
  pages: number;
}

export type StatsHistoryFetcher = (
  ids: string[],
  types: string[],
  startIso: string,
  endIso: string,
) => Promise<StatsHistoryResult>;

export function makeSamsaraStatsHistoryFetcher(env: Env, token: string): StatsHistoryFetcher {
  return async (ids, types, startIso, endIso) => {
    // Samsara accepts at most three types per request.
    if (types.length === 0 || types.length > 3) throw new RangeError("stats/history takes 1–3 types");
    const merged = new Map<string, Record<string, unknown>>();
    let after: string | undefined;
    let pages = 0;
    do {
      const url = new URL("/fleet/vehicles/stats/history", env.SAMSARA_API_URL);
      url.searchParams.set("vehicleIds", ids.join(","));
      url.searchParams.set("types", types.join(","));
      url.searchParams.set("startTime", startIso);
      url.searchParams.set("endTime", endIso);
      if (after) url.searchParams.set("after", after);
      const res = await samsaraFetch(env, token, url, { priority: "backfill", maxRps: STATS_HISTORY_MAX_RPS });
      if (!res.ok) throw new Error(`Samsara API ${res.status}`);
      const page = (await res.json()) as {
        data?: Record<string, unknown>[];
        pagination?: { hasNextPage?: boolean; endCursor?: string };
      };
      for (const v of page.data ?? []) {
        const key = String(v.id ?? "");
        if (!key) continue;
        const cur = merged.get(key);
        if (!cur) {
          merged.set(key, { ...v });
          continue;
        }
        for (const [k, val] of Object.entries(v)) {
          if (Array.isArray(val)) cur[k] = [...((Array.isArray(cur[k]) ? cur[k] : []) as unknown[]), ...val];
        }
      }
      const hasNextPage = page.pagination?.hasNextPage === true;
      if (hasNextPage && !page.pagination?.endCursor)
        throw new Error("Samsara stats/history pagination reported a next page without a cursor");
      after = hasNextPage ? page.pagination!.endCursor : undefined;
      pages += 1;
    } while (after && pages < MAX_STATS_PAGES);
    return { data: [...merged.values()], complete: after == null, pages };
  };
}

/** The latest value of each stat type for every vehicle (`/fleet/vehicles/stats`). */
export type StatsSnapshotFetcher = (types: string[]) => Promise<Record<string, unknown>[]>;

export function makeSamsaraStatsSnapshotFetcher(env: Env, token: string): StatsSnapshotFetcher {
  return async (types) =>
    (await listAllPages(env, token, "/fleet/vehicles/stats", { types: types.join(",") })) as Record<string, unknown>[];
}
