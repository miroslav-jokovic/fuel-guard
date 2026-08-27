import { computed, type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  computeIdleBreakdown,
  idleRangeDays,
  type IdleCapability,
  type FleetIdleVerdict,
  type TruckIdleVerdict,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import type { IdleCostBasis } from "@/composables/useIdleCostBasis";

/**
 * An inclusive date window. Declared here rather than imported from `features/fleet/useIdleScores`:
 * this composable moved OUT of that feature so the fuel-spend surface could read the same verdict, and
 * a composable reaching back into a feature is the same boundary violation pointing the other way.
 */
export interface IdleDateFilter {
  from?: string; // ISO (inclusive)
  to?: string; // ISO (inclusive — pass an end-of-day time for a timestamp column)
}

const DEFAULT_COST_BASIS: IdleCostBasis = {
  idleGalPerHour: 0.8,
  fuelPricePerGal: 4.0,
  priceSource: "default",
};

const PAGE = 1000;
const WINDOW_DAYS = 30;

/**
 * ── WHY THIS IS A COMPOSABLE AND NOT A FEATURE INTERNAL ─────────────────────────────────────────
 * It was `features/fleet/useIdleBreakdown`, read only by the Idling page. The fuel-spend surface then
 * costed idle by multiplying `vehicle_engine_days.idle_sec` by a burn rate and printing the total in
 * red — the "everything is avoidable" over-count `IDLE-AVOIDABLE-HOS.md` was written to kill,
 * reintroduced on a second page because the verdict lived somewhere it could not be imported from.
 *
 * The verdict has since moved further still, into `@silvicom/shared`, so the REPORT can reach it
 * server-side too. What is left here is the I/O: read the rollup rows, read the equipment, hand both
 * to one pure function. The shapes below are that function's, aliased so callers keep their imports.
 */
export type TruckBreakdown = TruckIdleVerdict;

export type IdleFleet = FleetIdleVerdict;

export interface IdleBreakdown {
  trucks: TruckBreakdown[];
  fleet: IdleFleet;
}

function rangeBounds(f: IdleDateFilter) {
  // `idle_rollup_days.day` is a calendar date and the picker gives calendar dates, so we compare on the
  // picked YYYY-MM-DD DIRECTLY (round-tripping through Date shifted the end date for browsers west of UTC).
  const toDate = f.to ? f.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromDate = f.from
    ? f.from.slice(0, 10)
    : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(`${toDate}T23:59:59.999Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
        86_400_000,
    ),
  );
  return { fromDate, toDate, days };
}


/** One rollup row as read from idle_rollup_days. */
export interface RollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec: number;
  optimized_envelope_outside_sec: number;
  optimized_envelope_unknown_sec: number;
  optimized_envelope_ambiguous_sec: number;
  optimized_envelope_status:
    "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";
  optimized_envelope_source: "documented_default" | "learned_behavioral" | "none";
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_grace_sec: number;
  hos_evidence_status:
    "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";
  attributed_driver_id: string | null;
}

/** Page the range's rollup rows (~trucks×days — tiny next to the raw event tables it replaced). */
export async function fetchRollupRows(fromDate: string, toDate: string): Promise<RollupRow[]> {
  const out: RollupRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("idle_rollup_days")
      .select(
        "vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, optimized_envelope_inside_sec, optimized_envelope_outside_sec, optimized_envelope_unknown_sec, optimized_envelope_ambiguous_sec, optimized_envelope_status, optimized_envelope_source, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec, hos_grace_sec, hos_evidence_status, attributed_driver_id",
      )
      .gte("day", fromDate)
      .lte("day", toDate)
      // (day, vehicle_id) is unique per org → a stable total order the (org_id, day, vehicle_id) index
      // serves directly (no dropped/duplicated pages, no sort).
      .order("day", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as RollupRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * The diesel price for each day of the range, from `fuel_price_days` (maintained by the rollup sync).
 * Empty map → every day falls back to the flat basis, which the cost result reports as unpriced days.
 */
export async function fetchDayPrices(fromDate: string, toDate: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("fuel_price_days")
    .select("day, effective_price_per_gal")
    .gte("day", fromDate)
    .lte("day", toDate);
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { day: string; effective_price_per_gal: number | string }[]) {
    const price = Number(r.effective_price_per_gal);
    if (Number.isFinite(price) && price > 0) out.set(r.day, price);
  }
  return out;
}



/**
 * The per-truck idle breakdown (engine-on = drive + idle) + fleet totals, read from the pre-aggregated
 * idle_rollup_days (maintained server-side by the idle/HOS syncs) — NOT from the raw event tables. The
 * mode sums reconstruct `computeAvoidable` exactly (it only ever sums sessions by mode), so the verdict
 * math is unchanged from the raw-table version. Fleet avoidable totals count CONFIDENT trucks only.
 */
export function useIdleBreakdown(filters: Ref<IdleDateFilter>, costBasis?: Ref<IdleCostBasis>) {
  return useQuery({
    queryKey: ["idle_breakdown", filters, computed(() => toValue(costBasis) ?? DEFAULT_COST_BASIS)],
    refetchInterval: 120_000,
    queryFn: async (): Promise<IdleBreakdown> => {
      const { fromDate, toDate } = rangeBounds(toValue(filters));
      const cb = toValue(costBasis) ?? DEFAULT_COST_BASIS;

      const [rows, dayPrices] = await Promise.all([
        fetchRollupRows(fromDate, toDate),
        fetchDayPrices(fromDate, toDate),
      ]);
      const { data: vdata, error: verr } = await supabase
        .from("vehicles")
        .select("id, unit_number, has_apu, has_optimized_idle, idle_capability")
        .neq("status", "retired");
      if (verr) throw new Error(verr.message);

      // The verdict itself is PURE and lives in @silvicom/shared, so the fuel-spend report can reach
      // the same answer server-side. It used to be inline here, which is why that report had to invent
      // its own — and invented the every-truck-is-avoidable over-count while doing it.
      const { trucks, fleet } = computeIdleBreakdown(
        rows,
        (vdata ?? []).map((v) => ({
          id: v.id as string,
          unitNumber: v.unit_number as string,
          hasApu: (v.has_apu as boolean | null) ?? null,
          hasOptimizedIdle: (v.has_optimized_idle as boolean | null) ?? null,
          learnedCapability: ((v.idle_capability as string | null) ?? "unknown") as IdleCapability,
        })),
        dayPrices,
        { rangeDays: idleRangeDays(rows, fromDate, toDate), costBasis: cb },
      );

      return { trucks, fleet };
    },
  });
}
