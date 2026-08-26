/**
 * Samsara's IFTA vehicle report, parsed and NOT converted (S1, D-IF1).
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 * No metres become miles here, no litres become gallons, no jurisdiction is priced and no MPG is
 * derived. Every one of those carries a policy — which miles are taxable, what the fleet's MPG was,
 * which quarter's rate applies — and each has been wrong somewhere in this codebase already. Stored
 * data outlives the rule that produced it, so this parser's whole job is to turn a JSON body into rows
 * that say exactly what Samsara said. `packages/shared/src/ifta/` does the arithmetic, over the rows.
 *
 * ── THE PERIOD IS MONTHLY, AND THAT IS MEASURED RATHER THAN ASSUMED ──────────────────────────────
 * The endpoint takes a year plus either a month or a quarter. Fetching 2026 April, May and June and
 * summing them gives **4,611,351 taxable miles**, and fetching 2026 Q2 gives **4,611,351** — a
 * difference of 0.0 miles (measured 2026-08-26). So monthly is strictly better: it reconstructs the
 * quarter exactly and additionally gives F10 a month-level burn apportionment. The quarter is derived
 * and never stored (D-IF10).
 *
 * ── THE TROUBLESHOOTING BLOCK IS DATA, NOT A LOG LINE ────────────────────────────────────────────
 * It is how Samsara says why its own numbers are incomplete. Measured on this carrier:
 * `unassignedFuelTypeVehicles: 187`, which is why `taxPaidLiters` totals 668 gallons a quarter against
 * the 439,153 we hold — Samsara sees almost none of this fleet's fuel. A surface that shows a Samsara
 * fuel figure without that count beside it is showing a number it cannot explain.
 */
import { normalizeStateCode } from "./location.js";

/** One (vehicle, jurisdiction) pair, in Samsara's own units. */
export interface IftaJurisdictionRow {
  samsaraVehicleId: string;
  vehicleName: string | null;
  /**
   * Two-letter code, uppercased. `normalizeStateCode` is NOT used: it returns null for anything
   * outside the US/CA sets it knows, and a jurisdiction we cannot name is still a jurisdiction whose
   * miles were driven. Dropping it would silently shrink the denominator of every share on the
   * surface — so an unrecognised code is stored as Samsara sent it and flagged by `recognised`.
   */
  jurisdiction: string;
  /** True when the code is one this product already knows how to price. */
  recognised: boolean;
  taxableMeters: number;
  totalMeters: number;
  taxPaidLiters: number;
}

export interface IftaTroubleshooting {
  noPurchasesFound: boolean;
  unassignedFuelTypePurchases: number;
  unassignedFuelTypeVehicles: number;
  unassignedVehiclePurchases: number;
}

export interface IftaVehicleReport {
  year: number | null;
  /** Samsara's own month name ("April") or quarter ("Q2"), echoed from the response. */
  month: string | null;
  quarter: string | null;
  rows: IftaJurisdictionRow[];
  /** Vehicles the response carried, including any whose jurisdiction list was empty. */
  vehicles: number;
  troubleshooting: IftaTroubleshooting;
}

interface RawJurisdiction {
  jurisdiction?: unknown;
  taxableMeters?: unknown;
  totalMeters?: unknown;
  taxPaidLiters?: unknown;
}
interface RawVehicleReport {
  vehicle?: { id?: unknown; name?: unknown };
  jurisdictions?: RawJurisdiction[];
}
export interface RawIftaResponse {
  data?: {
    year?: unknown;
    month?: unknown;
    quarter?: unknown;
    vehicleReports?: RawVehicleReport[];
    troubleshooting?: Record<string, unknown>;
  };
}

/** A finite number, or 0. A missing distance is not a negative one and must not poison a sum. */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const int = (v: unknown): number => Math.trunc(num(v));

/**
 * Parse one page of `GET /fleet/reports/ifta/vehicle`.
 *
 * A vehicle with no `id` is dropped — there is nothing to attribute its miles to — and counted
 * nowhere, because a row that cannot be joined is not a row. A vehicle with an EMPTY jurisdiction list
 * is kept in `vehicles` and contributes no rows: "this truck reported nothing" and "this truck was not
 * in the response" are different facts and the caller needs both.
 */
export function parseIftaVehicleReport(response: RawIftaResponse): IftaVehicleReport {
  const d = response.data ?? {};
  const reports = Array.isArray(d.vehicleReports) ? d.vehicleReports : [];
  const rows: IftaJurisdictionRow[] = [];
  let vehicles = 0;

  for (const r of reports) {
    const samsaraVehicleId = str(r.vehicle?.id);
    if (!samsaraVehicleId) continue;
    vehicles += 1;
    const vehicleName = str(r.vehicle?.name);
    for (const j of Array.isArray(r.jurisdictions) ? r.jurisdictions : []) {
      const code = str(j.jurisdiction)?.toUpperCase();
      if (!code) continue;
      rows.push({
        samsaraVehicleId,
        vehicleName,
        jurisdiction: code,
        recognised: normalizeStateCode(code) === code,
        taxableMeters: num(j.taxableMeters),
        totalMeters: num(j.totalMeters),
        taxPaidLiters: num(j.taxPaidLiters),
      });
    }
  }

  const t = d.troubleshooting ?? {};
  return {
    year: d.year == null ? null : int(d.year),
    month: str(d.month),
    quarter: str(d.quarter),
    rows,
    vehicles,
    troubleshooting: {
      noPurchasesFound: t.noPurchasesFound === true,
      unassignedFuelTypePurchases: int(t.unassignedFuelTypePurchases),
      unassignedFuelTypeVehicles: int(t.unassignedFuelTypeVehicles),
      unassignedVehiclePurchases: int(t.unassignedVehiclePurchases),
    },
  };
}

/** Merge the pages of one period into a single report. The troubleshooting block is per RESPONSE and
 *  identical across pages, so the last one wins; the rows and the vehicle count accumulate. */
export function mergeIftaPages(pages: readonly IftaVehicleReport[]): IftaVehicleReport {
  if (pages.length === 0) {
    return {
      year: null, month: null, quarter: null, rows: [], vehicles: 0,
      troubleshooting: {
        noPurchasesFound: false, unassignedFuelTypePurchases: 0,
        unassignedFuelTypeVehicles: 0, unassignedVehiclePurchases: 0,
      },
    };
  }
  const last = pages[pages.length - 1]!;
  return {
    year: last.year,
    month: last.month,
    quarter: last.quarter,
    rows: pages.flatMap((p) => p.rows),
    vehicles: pages.reduce((s, p) => s + p.vehicles, 0),
    troubleshooting: last.troubleshooting,
  };
}

/** The twelve month names the endpoint accepts, in order. `new Date()` is not used — this module is pure. */
export const IFTA_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export type IftaMonth = (typeof IFTA_MONTHS)[number];

/** `"April"` → 4. Null for anything that is not one of the twelve. */
export function iftaMonthNumber(month: string | null | undefined): number | null {
  if (!month) return null;
  const i = IFTA_MONTHS.indexOf(month.trim() as IftaMonth);
  return i < 0 ? null : i + 1;
}
