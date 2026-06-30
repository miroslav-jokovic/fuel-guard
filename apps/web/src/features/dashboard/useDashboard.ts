import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  aggregateDashboard,
  type DashboardSummary,
  type FuelTransaction,
  type Anomaly,
} from "@fleetguard/shared";
import { supabase } from "@/lib/supabase";

/** Executive dashboard summary for the last N days (org-scoped via RLS). */
export function useDashboard(days: Ref<number>) {
  return useQuery({
    queryKey: ["dashboard", days],
    queryFn: async (): Promise<DashboardSummary> => {
      const from = new Date(Date.now() - toValue(days) * 86400_000).toISOString();
      const [txnRes, anomRes, vehRes, drvRes] = await Promise.all([
        supabase
          .from("fuel_transactions")
          .select("id, vehicle_id, driver_id, fueled_at, gallons, total_cost, computed_mpg")
          .gte("fueled_at", from),
        supabase.from("anomalies").select("id, transaction_id, vehicle_id, severity, status").neq("status", "superseded"),
        supabase.from("vehicles").select("id, unit_number"),
        supabase.from("drivers").select("id, full_name"),
      ]);
      if (txnRes.error) throw new Error(txnRes.error.message);
      return aggregateDashboard(
        (txnRes.data ?? []) as unknown as FuelTransaction[],
        (anomRes.data ?? []) as unknown as Anomaly[],
        (vehRes.data ?? []) as { id: string; unit_number: string }[],
        (drvRes.data ?? []) as { id: string; full_name: string }[],
      );
    },
  });
}
