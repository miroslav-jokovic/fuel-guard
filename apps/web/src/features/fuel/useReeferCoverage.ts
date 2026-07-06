import { useQuery } from "@tanstack/vue-query";
import { computeReeferCoverage, type ReeferCoverageInput, type ReeferCoverageSummary } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 90;

/**
 * Reefer-coverage analytic over the last WINDOW_DAYS. Pages the fuel rows (PostgREST caps a single
 * response at 1000) and runs the pure aggregator. Read-only — never writes or raises anything.
 */
export function useReeferCoverage() {
  return useQuery({
    queryKey: ["reefer_coverage"],
    queryFn: async (): Promise<ReeferCoverageSummary> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const rows: ReeferCoverageInput[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select("vehicle_id, tank_type, gallons, fueled_at")
          .gte("fueled_at", from)
          .order("fueled_at", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as ReeferCoverageInput[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      return computeReeferCoverage(rows);
    },
    refetchInterval: 120_000,
  });
}
