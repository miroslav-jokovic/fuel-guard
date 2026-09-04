import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { LedgerMonthState } from "./useIncomeStatement";

/**
 * The trend behind the overview (G9) — the last twelve whole months of earned, spent and kept per
 * mile, so the period on screen can be read as a point on a line rather than as a verdict.
 *
 * Its own query rather than a field on the fleet report, because the two cover different windows:
 * the report reads the period the reader picked, the trend reads a fixed span of whole months
 * ending at it. Every figure arrives computed; this file adds no arithmetic.
 *
 * A `null` rate is a month whose mileage coverage was short of its fleet, never a zero. `reason`
 * says which trucks were missing, and the chart leaves a GAP — a line drawn through a month whose
 * denominator was eleven per cent short is a shape the reader would otherwise believe.
 */

export interface FleetTrendPoint {
  /** `YYYY-MM`. */
  month: string;
  revenue: number;
  expenses: number;
  net: number;
  miles: number | null;
  trucks: number | null;
  revenuePerMile: number | null;
  costPerMile: number | null;
  netPerMile: number | null;
  reason: string | null;
  /**
   * The month's empty share (G9), null whenever the rates are. Optional on the wire for the
   * deploy window: the API that returns it and the page that reads it ship in one merge, and for
   * the minutes the old API serves the new page this field is simply absent — read as null.
   */
  emptyPct?: number | null;
}

export interface FleetTrendResponse {
  points: FleetTrendPoint[];
  /** Months the McLeod sweep has not reached. Named on the page, never drawn at zero. */
  missing: string[];
  rated: number;
  monthsRequested: string[];
  /**
   * Months a sweep reached mid-month. They are in `missing` too — the chart cannot plot them — but
   * they need their own sentence, because "the sweep has not reached August" is not what happened
   * to a month the sweep reached on the 28th (G11).
   */
  monthsPartial: LedgerMonthState[];
}

export function useFleetTrendQuery(to: Ref<string>, months: Ref<number>) {
  const key = computed(() => ["accounting", "fleet-trend", to.value, months.value] as const);
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<FleetTrendResponse> => {
      const q = new URLSearchParams({ to: to.value, months: String(months.value) });
      const r = await apiFetch<FleetTrendResponse>(`/api/accounting/fleet-trend?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the trend");
      return r.data;
    },
  });
}
