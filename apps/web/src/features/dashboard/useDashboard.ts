import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import {
  aggregateDashboard,
  type DashboardSummary,
  type FuelTransaction,
  type Anomaly,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

// PostgREST caps a single response at 1000 rows. A month of fleet fills is several thousand, so a plain
// select silently returns only the first 1000 (in an undefined order) — which left the dashboard charts
// showing partial/incorrect data for many dates. Page through in 1000-row windows to fetch the full set.
const PAGE = 1000;

/** Fetch every row of a query by paging with .range() until a short page signals the end. */
async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Executive dashboard summary for the last N days (org-scoped via RLS). */
export function useDashboard(days: Ref<number>) {
  return useQuery({
    queryKey: ["dashboard", days],
    // Reflect background sync + nightly-reconcile results without a manual reload.
    refetchInterval: 120_000,
    // Switching the 7/30/90d range keeps the previous frame (dimmed) instead of a skeleton flash.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DashboardSummary> => {
      const from = new Date(Date.now() - toValue(days) * 86400_000).toISOString();
      const [txns, anoms, vehRes, drvRes, orgRes] = await Promise.all([
        // Ordered + paged so every fill in the window is aggregated (not just an arbitrary first 1000).
        fetchAllPaged<FuelTransaction>((lo, hi) =>
          supabase
            .from("fuel_transactions")
            .select("id, vehicle_id, driver_id, fueled_at, gallons, total_cost, computed_mpg")
            .gte("fueled_at", from)
            .order("fueled_at", { ascending: true })
            .range(lo, hi),
        ),
        fetchAllPaged<Anomaly>((lo, hi) =>
          supabase
            .from("anomalies")
            .select("id, transaction_id, vehicle_id, severity, status")
            .neq("status", "superseded")
            .order("id", { ascending: true })
            .range(lo, hi),
        ),
        supabase.from("vehicles").select("id, unit_number"),
        supabase.from("drivers").select("id, full_name"),
        supabase.from("organizations").select("operating_hours").maybeSingle(),
      ]);
      // Bucket trend days in the ORG's timezone — UTC slicing mis-dated evening fills.
      const tz = (orgRes.data?.operating_hours as { tz?: string } | null)?.tz ?? null;
      return aggregateDashboard(
        txns,
        anoms,
        (vehRes.data ?? []) as { id: string; unit_number: string }[],
        (drvRes.data ?? []) as { id: string; full_name: string }[],
        { tz },
      );
    },
  });
}
