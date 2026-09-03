import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { exclusiveEnd } from "@/lib/dateWindow";

/**
 * Earnings per dispatcher — the owner's 2026-08-28 question, "who is booking the money".
 *
 * Counts the same GL-booked revenue every other figure counts (post_key present, post_module
 * 'BILL'), so this table and the cost-per-mile page's revenue agree by construction rather than by
 * coincidence. `unpostedLoads` is the staged-but-unbooked remainder, shown rather than hidden.
 */
export interface DispatcherEarnings {
  dispatcherUserId: string | null;
  dispatcherName: string | null;
  loads: number;
  linehaul: number;
  accessorial: number;
  revenue: number;
  unpostedLoads: number;
  /** McLeod's billed miles over the booked loads — the miles each load was PRICED on (0275). */
  miles: number;
  loadsWithoutMiles: number;
  /** Dollars per billed mile; null when no booked load carried a distance. */
  ratePerMile: number | null;
}

export function useDispatcherEarningsQuery(from: Ref<string>, to: Ref<string>) {
  return useQuery({
    queryKey: ["billing", "dispatchers", from, to] as const,
    enabled: computed(() => !!from.value && !!to.value),
    queryFn: async (): Promise<DispatcherEarnings[]> => {
      const r = await apiFetch<{ dispatchers: DispatcherEarnings[] }>(
        `/api/billing/earnings-by-dispatcher?from=${from.value}&to=${exclusiveEnd(to.value)}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load dispatcher earnings");
      return r.data.dispatchers;
    },
  });
}
