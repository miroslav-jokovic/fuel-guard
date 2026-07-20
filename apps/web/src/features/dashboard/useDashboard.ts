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

/**
 * Executive dashboard summary for an explicit date range (org-scoped via RLS). `range` holds inclusive
 * YYYY-MM-DD bounds (the page defaults them to the last 30 days); the window covers the full local days —
 * start-of-day `from` through end-of-day `to` — so fills anytime on the boundary days are included.
 */
export function useDashboard(range: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["dashboard", range],
    // Reflect background sync + nightly-reconcile results without a manual reload.
    refetchInterval: 120_000,
    // Changing the range keeps the previous frame (dimmed) instead of a skeleton flash.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DashboardSummary> => {
      const { from: fromDay, to: toDay } = toValue(range);
      const from = new Date(`${fromDay}T00:00:00`).toISOString();
      const to = new Date(`${toDay}T23:59:59.999`).toISOString();
      const [txns, anoms, vehRes, drvRes, orgRes, idleRows, declinedRes] = await Promise.all([
        // Ordered + paged so every fill in the window is aggregated (not just an arbitrary first 1000).
        fetchAllPaged<FuelTransaction>((lo, hi) =>
          supabase
            .from("fuel_transactions")
            .select("id, vehicle_id, driver_id, fueled_at, gallons, total_cost, computed_mpg, tank_type, samsara_recon_at")
            .gte("fueled_at", from)
            .lte("fueled_at", to)
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
        // Idle waste over the same window (paged) -> idle $ + hours.
        fetchAllPaged<{ duration_sec: number | string; cost_usd: number | string | null }>((lo, hi) =>
          supabase
            .from("idle_events")
            .select("duration_sec, cost_usd")
            .gte("started_at", from)
            .lte("started_at", to)
            .order("started_at", { ascending: true })
            .range(lo, hi),
        ),
        // Declined-attempt count over the same window (head count -> no rows pulled).
        supabase.from("declined_transactions").select("id", { count: "exact", head: true }).gte("declined_at", from).lte("declined_at", to),
      ]);
      // Bucket trend days in the ORG's timezone — UTC slicing mis-dated evening fills.
      const tz = (orgRes.data?.operating_hours as { tz?: string } | null)?.tz ?? null;
      return aggregateDashboard(
        txns,
        anoms,
        (vehRes.data ?? []) as { id: string; unit_number: string }[],
        (drvRes.data ?? []) as { id: string; full_name: string }[],
        { tz },
        {
          idle: (idleRows ?? []).map((r) => ({
            durationSec: Number(r.duration_sec),
            costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
          })),
          declinedCount: declinedRes.count ?? 0,
        },
      );
    },
  });
}
