import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * Mileage coverage (G4 + G10) — the truck count behind a period, and whether its miles are all of
 * them.
 *
 * A page reads `miles`/`trucks` when they are numbers and prints `reason` when they are null. There
 * is deliberately no fallback: a per-mile figure over a denominator that is missing trucks is the
 * plausible-wrong number this whole section exists to refuse, so the absence has to be louder than
 * a rough answer would be.
 */

export interface MonthMileage {
  month: string;
  measuredTrucks: number;
  measuredMiles: number;
  deliveringTrucks: number;
  billedMiles: number;
  complete: boolean;
  unmeasuredTrucks: number;
  emptyMiles: number | null;
  emptyPct: number | null;
}

export interface MileageCoverageResponse {
  months: MonthMileage[];
  miles: number | null;
  trucks: number | null;
  reason: string | null;
  billedMiles: number;
  loads: number;
  billedRevenue: number;
}

export function useMileageCoverageQuery(filter: Ref<{ from: string; to: string }>) {
  const key = computed(() => ["accounting", "mileage-coverage", filter.value.from, filter.value.to] as const);
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<MileageCoverageResponse> => {
      const q = new URLSearchParams({ from: filter.value.from, to: filter.value.to });
      const r = await apiFetch<MileageCoverageResponse>(`/api/accounting/mileage-coverage?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not read mileage coverage");
      return r.data;
    },
  });
}
