/**
 * The spend series, summed where the rows are.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────────────────────────
 * `useSpendDaysQuery` pages every truck-day in the window into the browser and folds them here.
 * Measured on production 2026-08-26, the default 90-day window is **13,095 rows fetched as fourteen
 * sequential PostgREST pages, to display thirteen weekly figures** — and not one truck-day appears
 * anywhere on the surface.
 *
 * ── WHAT DID NOT MOVE, AND WHY ───────────────────────────────────────────────────────────────────
 * Only the summation. `fuel_spend_by_period` (0252) returns exactly `SpendDaySums`, and
 * `periodTotalsFromSums` — unchanged — still does every derivation: the MPG plausibility band, the
 * implied-miles identity, the idle coverage gate, valuing an idle hour at what the period actually
 * paid. Those are judgements that have each been got wrong once and fixed, and a second copy in SQL
 * would sit where no unit test could reach it.
 *
 * `apps/api/src/services/fuelSpendByPeriodParity.test.ts` runs both implementations over the same
 * rows and compares them field for field, so the two cannot drift.
 *
 * The daily rows are still available through `useSpendDaysQuery` for anything that genuinely needs a
 * truck-day. This tab never did.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import {
  periodTotalsFromSums,
  type SpendDaySums,
  type SpendGrain,
  type SpendPeriod,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

function toSums(r: Record<string, unknown>): SpendDaySums {
  return {
    activeTrucks: num(r.active_trucks),
    days: num(r.days),
    fills: num(r.fills),
    gallonsTractor: num(r.gallons_tractor),
    spendTractor: num(r.spend_tractor),
    gallonsReefer: num(r.gallons_reefer),
    spendReefer: num(r.spend_reefer),
    gallonsDef: num(r.gallons_def),
    spendDef: num(r.spend_def),
    miles: num(r.miles),
    mpgGallons: num(r.mpg_gallons),
    milesRejected: num(r.miles_rejected),
    driveSec: num(r.drive_sec),
    idleSec: num(r.idle_sec),
    coverageSec: num(r.coverage_sec),
    truckDays: num(r.truck_days),
  };
}

export interface SpendSeries {
  /** One period per bucket, oldest first — the same shape `spendSeries` produced. */
  periods: SpendPeriod[];
  /** The whole window as one period, for the totals the tiles fall back to. */
  overall: SpendPeriod | null;
  /** Odometer intervals refused as implausible across the window. */
  rejected: number;
  /** Truck-days the figures were summed from, for the "N truck-days" line. */
  truckDays: number;
}

export function useSpendPeriodsQuery(
  filters: Ref<SpendQueryFilters>,
  grain: Ref<SpendGrain>,
  opts: Ref<{ idleGalPerHour?: number }>,
) {
  return useQuery({
    queryKey: ["fuel_spend_by_period", filters, grain, opts],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpendSeries> => {
      const f = filters.value;
      const vehicles = f.vehicleIds.length ? f.vehicleIds : null;
      const call = (g: string) =>
        supabase.rpc("fuel_spend_by_period", { p_from: f.from, p_to: f.to, p_grain: g, p_vehicles: vehicles });

      // Two calls rather than one: `activeTrucks` over a window is not the sum of its weeks', because
      // a truck working every week would be counted once per week.
      const [series, window] = await Promise.all([call(grain.value), call("window")]);
      if (series.error) throw new Error(series.error.message);
      if (window.error) throw new Error(window.error.message);

      const derive = (r: Record<string, unknown>, partial: boolean): SpendPeriod =>
        periodTotalsFromSums(toSums(r), String(r.period_from), String(r.period_to), {
          partial,
          idleGalPerHour: opts.value.idleGalPerHour,
        });

      const rows = (series.data ?? []) as Record<string, unknown>[];
      const winRows = (window.data ?? []) as Record<string, unknown>[];
      return {
        periods: rows.map((r) => derive(r, r.partial === true)),
        // The window total is never "in progress" — it is whatever the reader asked for.
        overall: winRows[0] ? derive(winRows[0], false) : null,
        rejected: rows.reduce((a, r) => a + num(r.miles_rejected), 0),
        truckDays: rows.reduce((a, r) => a + num(r.truck_days), 0),
      };
    },
  });
}
