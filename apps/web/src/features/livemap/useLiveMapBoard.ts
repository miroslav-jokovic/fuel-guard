/**
 * The dispatcher's board, polled (LIVE-MAP-PLAN.md LM8, D-LM8).
 *
 * ── FIVE SECONDS, AND WHY THAT IS THE RIGHT NUMBER RATHER THAN THE FASTEST ONE ───────────────────
 * D-LM9b stacks three intervals: the vendor's GPS ping (≤5 s while moving, ~5 min when parked), the
 * collector tier (5 s) and this poll (5 s) — about 15 seconds worst case for a moving truck. Polling
 * faster than the collector writes would ask the API the same question twice for one answer; polling
 * slower would make the browser the binding constraint on freshness, which is what the 20 s original
 * would have done and is why D-LM8 was amended on 2026-09-15.
 *
 * ── THE PAUSE ON A HIDDEN TAB IS TANSTACK'S, NOT A HAND-ROLLED LISTENER ──────────────────────────
 * `refetchIntervalInBackground` defaults to false, and in query-core 5.101 "focused" is defined as
 * `document.visibilityState !== "hidden"` — visibility, not window focus. That distinction is the
 * reason this is left to the library rather than written here: a dispatcher runs this board on a
 * second monitor beside their TMS, so a poll that stopped on BLUR would stop exactly when the page
 * is being used as intended. Hidden stops it; unfocused does not.
 *
 * ── ONE REQUEST IN FLIGHT AT A TIME ──────────────────────────────────────────────────────────────
 * The board's assembly time has not yet been measured inside Railway (§3 of
 * `docs/HANDOFF-2026-09-15-LIVEMAP.md`); ~1.0 s from a laptop is three sequential round trips over
 * the public internet and the API sits beside the database. If it ever did exceed the interval,
 * vue-query dedupes by query key rather than stacking requests, so the poll degrades to "as fast as
 * the server answers" instead of building a queue — but that is a floor, not a reason to skip the
 * measurement.
 */
import { useQuery } from "@tanstack/vue-query";
import { keepPreviousData } from "@tanstack/vue-query";
import type { LiveMapBoard } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export const LIVE_MAP_POLL_MS = 5_000;

export const LIVE_MAP_QUERY_KEY = ["livemap", "positions"] as const;

interface Envelope {
  ok: boolean;
  data?: LiveMapBoard;
  error?: { message?: string };
}

export function useLiveMapBoard() {
  return useQuery({
    queryKey: LIVE_MAP_QUERY_KEY,
    refetchInterval: LIVE_MAP_POLL_MS,
    // A poll that blanked the map every five seconds would be unusable; the previous board stays on
    // screen while the next one is in flight, and `isFetching` is what tells the user it is working.
    placeholderData: keepPreviousData,
    // The board is a measurement of NOW. There is no such thing as a cached one worth reusing, and a
    // stale-time above zero would have the first paint after a navigation show a board from before
    // the user left the page.
    staleTime: 0,
    queryFn: async (): Promise<LiveMapBoard> => {
      const res = await apiFetch<Envelope>("/api/livemap/positions");
      const body = res.data;
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error?.message ?? res.error?.message ?? "Could not read the live map");
      }
      return body.data;
    },
  });
}
