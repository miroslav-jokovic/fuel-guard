import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import {
  aggregateDashboard,
  type DashboardSummary,
  type FuelTransaction,
  type Anomaly,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { efsRejectDayWindow } from "@/lib/stationTime";
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
 * YYYY-MM-DD bounds (the page defaults them to the last 30 days), and every window below is now a
 * window of DAYS rather than of instants (FUEL-T1, D-FUI11) — see the note on the fills query.
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
      // The declines window in the station-agnostic zone EFS prints rejects in (see the query below).
      const rejectWindow = efsRejectDayWindow(fromDay, toDay);
      const [txns, anoms, vehRes, drvRes, orgRes, idleRows, declinedRes] = await Promise.all([
        // Ordered + paged so every fill in the window is aggregated (not just an arbitrary first 1000).
        fetchAllPaged<FuelTransaction>((lo, hi) =>
          supabase
            .from("fuel_transactions")
            .select("id, vehicle_id, driver_id, fueled_at, gallons, total_cost, computed_mpg, tank_type, samsara_recon_at")
            .eq("is_canonical", true)
            // FUEL-T1 / D-FUI11. This built its bounds with `new Date(`${fromDay}T00:00:00`)` — the
            // BROWSER's midnight — and compared them to a UTC instant, so the same picked range
            // returned a different set of fills depending on where the viewer was sitting, and a
            // different set again from the Fuel Log beside it. `business_date` (0287) is the station's
            // own day, stored, so this window is now the same window the Fuel Log uses and the same
            // KIND of window `idle_rollup_days` below has always used.
            .gte("business_date", fromDay)
            .lte("business_date", toDay)
            .order("fueled_at", { ascending: true })
            .range(lo, hi),
        ),
        // Alert cards are CURRENT-STATE, not range-scoped: the "Active alerts" tile links to the
        // Alerts page, which shows open cases with NO date filter — so the tile, the severity donut,
        // and the risk lists must count exactly that set or the numbers read as "wrong data" the
        // moment someone clicks through. (Spend/MPG stay range-scoped; the scopes differ on purpose.)
        fetchAllPaged<Anomaly>((lo, hi) =>
          supabase
            .from("anomalies")
            .select("id, transaction_id, vehicle_id, severity, status")
            .in("status", ["open", "investigating"])
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
        // Declined-attempt count over the same window (head count -> no rows pulled). Bounded in
        // CENTRAL, because that is the zone EFS prints reject times in whatever the station's own zone
        // is — the same window the Rejections page uses, so the tile and the page agree.
        supabase
          .from("declined_transactions")
          .select("id", { count: "exact", head: true })
          .gte("declined_at", rejectWindow.gte)
          .lt("declined_at", rejectWindow.lt),
      ]);
      // Driver attribution for the alert set: its fills can be OLDER than the visible range, so the
      // range-scoped `txns` can't resolve them — fetch driver_id for exactly the flagged fills.
      // Chunked .in() (URL-length safety); the open-alert set is small, so this is a handful of calls.
      const anomalyDrivers = new Map<string, string | null>();
      const txnIds = [...new Set(anoms.map((a) => a.transaction_id).filter(Boolean))] as string[];
      for (let i = 0; i < txnIds.length; i += 100) {
        const { data: tRows, error: tErr } = await supabase
          .from("fuel_transactions")
          .select("id, driver_id")
          .in("id", txnIds.slice(i, i + 100));
        if (tErr) throw new Error(tErr.message);
        for (const t of (tRows ?? []) as { id: string; driver_id: string | null }[]) {
          anomalyDrivers.set(t.id, t.driver_id);
        }
      }

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
          anomalyDrivers,
        },
      );
    },
  });
}
