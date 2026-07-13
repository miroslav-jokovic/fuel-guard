import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import {
  aggregateDashboard,
  type DashboardSummary,
  type FuelTransaction,
  type Anomaly,
} from "@fuelguard/shared";
import { supabase, DEV_BYPASS } from "@/lib/supabase";

// TEMP-PREVIEW: deterministic mock summary for VITE_DEV_BYPASS visual verification. REMOVE.
function mockSummary(days: number): DashboardSummary {
  const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
    return d.toISOString().slice(0, 10);
  });
  const spendTrend = dates.map((date, i) => ({
    date,
    value: rnd(i) < 0.08 ? 0 : Math.round(900 + rnd(i + 1) * 1800 + Math.sin(i / 4) * 350),
  }));
  const mpgTrend = dates.map((date, i) => ({
    date,
    value: rnd(i + 7) < 0.1 ? null : Math.round((6.1 + Math.sin(i / 5) * 0.5 + rnd(i + 3) * 0.6) * 100) / 100,
  }));
  const totalSpend = spendTrend.reduce((s, p) => s + (p.value ?? 0), 0);
  return {
    totalSpend,
    totalGallons: Math.round(totalSpend / 3.72),
    fleetMpg: 6.42,
    openAnomalies: 30,
    mpgTrend,
    spendTrend,
    anomaliesBySeverity: { critical: 2, high: 5, medium: 9, low: 14 },
    topVehiclesByRisk: [
      { id: "v1", label: "Unit 118", anomalyCount: 6, criticalCount: 2 },
      { id: "v2", label: "Unit 204", anomalyCount: 5, criticalCount: 0 },
      { id: "v3", label: "Unit 133", anomalyCount: 3, criticalCount: 0 },
      { id: "v4", label: "Unit 342", anomalyCount: 2, criticalCount: 0 },
      { id: "v5", label: "Unit 077", anomalyCount: 1, criticalCount: 0 },
    ],
    topDriversByRisk: [
      { id: "d1", label: "M. Alvarez", anomalyCount: 5, criticalCount: 1 },
      { id: "d2", label: "J. Kowalski", anomalyCount: 4, criticalCount: 1 },
      { id: "d3", label: "T. Nguyen", anomalyCount: 3, criticalCount: 0 },
      { id: "d4", label: "S. Petrov", anomalyCount: 2, criticalCount: 0 },
    ],
  };
}

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
      // TEMP-PREVIEW: REMOVE.
      if (DEV_BYPASS) {
        await new Promise((r) => setTimeout(r, 600));
        return mockSummary(toValue(days));
      }
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
