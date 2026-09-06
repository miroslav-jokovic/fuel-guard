import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * Revenue and activity by period (W2) — what the fleet hauled and what it was priced at.
 *
 * Every figure arrives computed. A `null` rate means the period's bills carried no distance between
 * them, never that the loads were free, and `loadsWithoutDistance` says how much of the period the
 * rate is speaking for.
 */

export type ActivityGrain = "day" | "week" | "month";

export interface ActivityPeriodRow {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  loads: number;
  revenue: number;
  billedMiles: number;
  revenuePerBilledMile: number | null;
  loadsWithoutDistance: number;
}

export interface BillingActivityResponse {
  periods: ActivityPeriodRow[];
  grain: ActivityGrain;
  window: { from: string; to: string };
  /** Bills the GL has not booked yet — excluded from every figure above, and counted. */
  unpostedBills: number;
}

export function useBillingActivityQuery(
  filter: Ref<{ from: string; to: string }>,
  grain: Ref<ActivityGrain>,
) {
  const key = computed(
    () => ["accounting", "billing-activity", filter.value.from, filter.value.to, grain.value] as const,
  );
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<BillingActivityResponse> => {
      const q = new URLSearchParams({ from: filter.value.from, to: filter.value.to, grain: grain.value });
      const r = await apiFetch<BillingActivityResponse>(`/api/accounting/billing-activity?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load activity");
      return r.data;
    },
  });
}
