/**
 * The IFTA ledger's position, built from `GET /api/ifta/period`'s raw rows (IFTA-PRECISION-PLAN IP9).
 *
 * Moved here from the web hook when the return export needed the same figure server-side: the export
 * checks its truck-by-truck totals against the ledger the office is looking at, and a second copy of
 * this join in the API would be two answers to "what does the page say" that agree only until one of
 * them changes. One function; the page and the export both call it.
 */
import { computeIftaPosition, type IftaFuelPurchase, type IftaJurisdictionMiles, type IftaPosition } from "./position.js";
import type { IftaPeriodReceipts } from "./receipts.js";

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Any date inside the quarter. IFTA rates are quarterly, so every day of it shares one rate. */
export function rateDateFor(q: { year: number; quarter: number }): string {
  const month = String((q.quarter - 1) * 3 + 2).padStart(2, "0"); // the middle month, comfortably inside
  return `${q.year}-${month}-15`;
}

/** `ifta_period_jurisdictions` rows (0256) as the position's miles. Units stay Samsara's (D-IF1). */
export function periodMiles(rows: Record<string, unknown>[]): IftaJurisdictionMiles[] {
  return rows.map((r) => ({
    jurisdiction: String(r.jurisdiction),
    taxableMeters: num(r.taxable_meters),
    totalMeters: num(r.total_meters),
    taxPaidLiters: num(r.tax_paid_liters),
  }));
}

/**
 * The purchases one quarter's position is computed over. The read already aggregates the card fuel per
 * jurisdiction, so each row is one "purchase" of that jurisdiction's whole quarter; the rate is selected
 * by the quarter, not by a fill's own day. Driver-paid receipts are fuel bought too (IP6, IP8): one
 * more purchase per jurisdiction, marked as such so the position carries their share of "gallons
 * bought" as its own figure. They move the fleet MPG with them, which is right — the return divides
 * miles by ALL the fuel, and a truck fuelled only on paper (unit 512) otherwise drives on nothing.
 */
export function periodPurchases(
  rows: Record<string, unknown>[],
  receipts: IftaPeriodReceipts,
  rateDate: string,
): IftaFuelPurchase[] {
  return [
    ...rows
      .filter((r) => num(r.purchased_gallons) > 0)
      .map((r) => ({ jurisdiction: String(r.jurisdiction), gallons: num(r.purchased_gallons), tranDate: rateDate })),
    ...receipts.jurisdictions.map((j) => ({
      jurisdiction: j.jurisdiction, gallons: j.gallons, tranDate: rateDate, source: "mcleod_receipt" as const,
    })),
  ];
}

/** The ledger page's position for one quarter, from the period read's rows and its receipts. */
export function ledgerPosition(
  rows: Record<string, unknown>[],
  receipts: IftaPeriodReceipts,
  q: { year: number; quarter: number },
): { miles: IftaJurisdictionMiles[]; position: IftaPosition } {
  const rateDate = rateDateFor(q);
  const miles = periodMiles(rows);
  return { miles, position: computeIftaPosition(miles, periodPurchases(rows, receipts, rateDate), rateDate) };
}
