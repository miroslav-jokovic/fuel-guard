import { useQuery } from "@tanstack/vue-query";
import { computeDetectionCoverage, computeCapacityHealth, type CoverageInput, type CoverageSummary, type CapacityHealth, type CapacityVehicleRow } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 90;

/**
 * Detection-coverage analytic over the last WINDOW_DAYS: how much of the fuel data the system could
 * actually corroborate against telematics, and which trucks are blind spots. Pages fuel_transactions
 * (RLS-scoped) and runs the pure aggregator. Read-only — never writes or flags.
 */
export function useDetectionCoverage() {
  return useQuery({
    queryKey: ["detection_coverage"],
    queryFn: async (): Promise<CoverageSummary> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const rows: CoverageInput[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("fuel_transactions")
          .select("vehicle_id, driver_id, fueled_at, tank_type, samsara_recon_at, samsara_odometer, samsara_location_confidence, fueling_time_basis, card_ref, control_id")
          .gte("fueled_at", from)
          .order("fueled_at", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as CoverageInput[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      return computeDetectionCoverage(rows);
    },
    refetchInterval: 120_000,
  });
}

/** WP5 — tank-capacity setup health: fuel vehicles whose capacity is unset/0 have the weight-85
 *  exceeds-capacity + tank-space rules silently dead. Surfaced as its own Coverage tile. */
export function useCapacityHealth() {
  return useQuery({
    queryKey: ["capacity_health"],
    queryFn: async (): Promise<CapacityHealth> => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, unit_number, fuel_type, tank_capacity_gal, status");
      if (error) throw new Error(error.message);
      return computeCapacityHealth((data ?? []) as CapacityVehicleRow[]);
    },
    refetchInterval: 300_000,
  });
}
