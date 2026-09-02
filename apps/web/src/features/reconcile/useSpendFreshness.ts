/**
 * When the spend figures in the current window were last derived (FUEL-T5, A6, D-FUI18).
 *
 * ── WHY THIS IS ITS OWN QUERY AND NOT A COLUMN ON `useSpendDaysQuery` ──────────────────────────
 * That composable already pages every truck-day in the window into the browser, and the oldest build
 * stamp is one row's worth of information. Adding `updated_at` to its select would put it on ~165 rows
 * a day and change the shared `SpendDay` type — a type six pure functions consume — to carry a field
 * none of them use. One ordered row is cheaper and keeps the fold that renders the trend unchanged.
 *
 * ── AND WHY IT ASKS FOR THE OLDEST, NOT THE NEWEST ─────────────────────────────────────────────
 * See `describeRollupFreshness`: a window that straddles the 14-day rebuild boundary holds rows built
 * last night AND rows built in August, and only the oldest is a promise about all of them.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { describeRollupFreshness, type RollupFreshness } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";

export function useSpendFreshnessQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_spend_days_freshness", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RollupFreshness> => {
      const f = filters.value;
      let q = supabase
        .from("fuel_spend_days")
        .select("updated_at")
        .gte("day", f.from)
        .lte("day", f.to);
      // Narrowed to specific trucks, this must narrow with them: the reader is being told how current
      // the figures ON SCREEN are, and a build stamp from a truck they filtered out is not that.
      if (f.vehicleIds.length) q = q.in("vehicle_id", f.vehicleIds);
      const { data, error } = await q.order("updated_at", { ascending: true }).limit(1);
      if (error) throw new Error(error.message);
      const oldest = (data ?? [])[0] as { updated_at?: string } | undefined;
      return describeRollupFreshness(oldest?.updated_at ?? null, new Date());
    },
  });
}
