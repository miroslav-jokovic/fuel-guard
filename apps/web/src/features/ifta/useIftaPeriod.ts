/**
 * One quarter's IFTA inputs, read through `ifta_period_jurisdictions` and `ifta_period_summary` (0256).
 *
 * ── THE ARITHMETIC IS NOT HERE ───────────────────────────────────────────────────────────────────
 * This fetches and shapes; `computeIftaPosition` and `tieOutMiles` in `@silvicom/shared` do every
 * calculation, which is why the same numbers can be produced server-side for a filing without a second
 * implementation to drift. The SQL only sums (D-FC1's neighbours do the same) and the units stay
 * Samsara's all the way to the shared module, which is the one place they become miles (D-IF1).
 */
import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import {
  computeIftaPosition, tieOutMiles,
  type IftaFuelPurchase, type IftaJurisdictionMiles, type IftaPosition, type MilesTieOut,
} from "@silvicom/shared";
import { milesFromMeters } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export interface IftaQuarter {
  year: number;
  quarter: number;
}

export interface IftaPeriodSummary {
  odometerMiles: number;
  odometerRejected: number;
  purchasedGallons: number;
  vehicles: number;
  monthsFetched: number;
  anyProvisional: boolean;
  maxUnmapped: number;
  lastFetchedAt: string | null;
  /** Samsara's own account of why its figures are incomplete. Rendered in words, never as integers. */
  troubleshooting: Record<string, number | boolean> | null;
}

export interface IftaPeriodData {
  position: IftaPosition;
  tieOut: MilesTieOut;
  summary: IftaPeriodSummary;
  /** Samsara's own tax-paid litres, for the record. Not used in the arithmetic — see `tieOut.ts`. */
  samsaraTaxPaidLiters: number;
  /** True when no miles have been pulled for this quarter at all. Different from "no miles driven". */
  neverFetched: boolean;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Any date inside the quarter. IFTA rates are quarterly, so every day of it shares one rate. */
export function rateDateFor(q: IftaQuarter): string {
  const month = String((q.quarter - 1) * 3 + 2).padStart(2, "0"); // the middle month, comfortably inside
  return `${q.year}-${month}-15`;
}

export function useIftaPeriodQuery(quarter: Ref<IftaQuarter>) {
  return useQuery({
    queryKey: ["ifta_period", quarter],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<IftaPeriodData> => {
      // Served by the ifta API module since P1.10 (2026-08-27) — the browser no longer calls
      // the period RPCs (and so no longer reads the samsara collector's staging) directly.
      const r = await apiFetch<{ jurisdictions: Record<string, unknown>[]; summary: Record<string, unknown> | null }>(
        `/api/ifta/period?year=${quarter.value.year}&quarter=${quarter.value.quarter}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the IFTA period");

      const rows = r.data.jurisdictions;
      const miles: IftaJurisdictionMiles[] = rows.map((r) => ({
        jurisdiction: String(r.jurisdiction),
        taxableMeters: num(r.taxable_meters),
        totalMeters: num(r.total_meters),
        taxPaidLiters: num(r.tax_paid_liters),
      }));
      // The read already aggregates the fuel per jurisdiction, so each row is one "purchase" of that
      // jurisdiction's whole quarter. The rate is selected by the quarter, not by a fill's own day.
      const rateDate = rateDateFor(quarter.value);
      const purchases: IftaFuelPurchase[] = rows
        .filter((r) => num(r.purchased_gallons) > 0)
        .map((r) => ({ jurisdiction: String(r.jurisdiction), gallons: num(r.purchased_gallons), tranDate: rateDate }));

      const s = r.data.summary ?? {};
      const summary: IftaPeriodSummary = {
        odometerMiles: num(s.odometer_miles),
        odometerRejected: num(s.odometer_rejected),
        purchasedGallons: num(s.purchased_gallons),
        vehicles: num(s.vehicles),
        monthsFetched: num(s.months_fetched),
        anyProvisional: s.any_provisional === true,
        maxUnmapped: num(s.max_unmapped),
        lastFetchedAt: s.last_fetched_at == null ? null : String(s.last_fetched_at),
        troubleshooting: (s.troubleshooting as Record<string, number | boolean> | null) ?? null,
      };

      const position = computeIftaPosition(miles, purchases, rateDate);
      const samsaraMiles = miles.reduce((acc, m) => acc + milesFromMeters(m.taxableMeters), 0);
      return {
        position,
        tieOut: tieOutMiles({
          samsaraMiles,
          odometerMiles: summary.odometerMiles,
          // The purchases the position used, so the tie-out and the liability rest on one denominator.
          purchasedGallons: position.mpg.totalGallons,
        }),
        summary,
        samsaraTaxPaidLiters: miles.reduce((acc, m) => acc + m.taxPaidLiters, 0),
        neverFetched: summary.monthsFetched === 0,
      };
    },
  });
}

/**
 * The quarters worth offering, newest first, back through the start of the fuel data.
 *
 * `now` is a parameter because a list of quarters that changes under a test is a test that passes in
 * September and fails in October.
 */
export function selectableQuarters(now: Date, back = 7): IftaQuarter[] {
  const out: IftaQuarter[] = [];
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < back; i += 1) {
    out.push({ year, quarter });
    quarter -= 1;
    if (quarter === 0) { quarter = 4; year -= 1; }
  }
  return out;
}

export const quarterLabel = (q: IftaQuarter): string => `Q${q.quarter} ${q.year}`;

/** `"2026-Q2"` — the URL form, so a quarter can be sent to somebody. */
export const quarterKey = (q: IftaQuarter): string => `${q.year}-Q${q.quarter}`;

export function parseQuarterKey(key: string | null | undefined): IftaQuarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(key ?? "").trim());
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}

export const useIftaQuarterOptions = (now: Ref<Date>) =>
  computed(() => selectableQuarters(now.value).map((q) => ({ value: quarterKey(q), label: quarterLabel(q) })));
