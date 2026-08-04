import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import {
  aggregateDashboard,
  type DashboardSummary,
  type FuelTransaction,
  type Anomaly,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useIdleCostBasis } from "@/composables/useIdleCostBasis";

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
  // The SAME burn-rate + $/gal basis the Idling page uses, so the idle tile matches that page exactly.
  const costBasis = useIdleCostBasis();
  return useQuery({
    queryKey: ["dashboard", range, costBasis],
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
        // Anomalies are RANGE-SCOPED like every other card (by their fill's business time). Unscoped,
        // the alert cards mixed all-time counts with 30-day spend/MPG — the "random numbers that don't
        // match the pages" report — and the driver-risk join (all-time anomalies × in-range fills)
        // silently dropped drivers.
        fetchAllPaged<Anomaly>((lo, hi) =>
          supabase
            .from("anomalies")
            .select("id, transaction_id, vehicle_id, severity, status")
            .neq("status", "superseded")
            .gte("fueled_at", from)
            .lte("fueled_at", to)
            .order("fueled_at", { ascending: true })
            .order("id", { ascending: true })
            .range(lo, hi),
        ),
        supabase.from("vehicles").select("id, unit_number"),
        supabase.from("drivers").select("id, full_name"),
        supabase.from("organizations").select("operating_hours").maybeSingle(),
        // Idle hours over the same window from the PRE-AGGREGATED rollup (~trucks×days rows) — the same
        // source the Idling page reads, so the two screens can no longer disagree.
        fetchAllPaged<{ idle_sec: number | string }>((lo, hi) =>
          supabase
            .from("idle_rollup_days")
            .select("idle_sec")
            .gte("day", toValue(range).from)
            .lte("day", toValue(range).to)
            .order("day", { ascending: true })
            .order("vehicle_id", { ascending: true })
            .range(lo, hi),
        ),
        // Declined-attempt count over the same window (head count -> no rows pulled).
        supabase.from("declined_transactions").select("id", { count: "exact", head: true }).gte("declined_at", from).lte("declined_at", to),
      ]);
      // Bucket trend days in the ORG's timezone — UTC slicing mis-dated evening fills.
      const tz = (orgRes.data?.operating_hours as { tz?: string } | null)?.tz ?? null;
      const idleHours = idleRows.reduce((s, r) => s + Number(r.idle_sec), 0) / 3600;
      const basis = toValue(costBasis);
      return aggregateDashboard(
        txns,
        anoms,
        (vehRes.data ?? []) as { id: string; unit_number: string }[],
        (drvRes.data ?? []) as { id: string; full_name: string }[],
        { tz },
        {
          idleHours,
          idleCostUsd: idleHours * basis.idleGalPerHour * basis.fuelPricePerGal,
          declinedCount: declinedRes.count ?? 0,
        },
      );
    },
  });
}
