import { z } from "zod";

/**
 * What a load pays — the `charges` object the office's load readers add for a caller who holds
 * `dispatch.load_rates` (LOAD-RATES-PLAN D-RATE6, D-RATE7), and that the Loads page, the Dispatch board
 * and a load's page draw (D-RATE8). ONE definition for the api and the web.
 *
 * Its keys are `load_charges`' columns (0639) verbatim, McLeod's figures as McLeod stated them: the order's
 * total, linehaul and other charges (other charges CAN be negative — 10 orders since 2026-01-01, as low
 * as −$1,000 — so nothing here checks a sign), and billed miles only when McLeod billed in miles.
 *
 * Deliberately NOT in `loadsContract.ts`: that file is the driver app's contract, and a driver is never
 * sent a price (D-RATE7: `/api/me/loads` never carries one).
 *
 * Presence is the permission: a reader without the switch gets NO `charges` key at all — withheld by the
 * server, not hidden by the screen. A holder gets `charges: null` on a load McLeod states no price for (an
 * empty movement, a voided one — D-RATE3), so "no price" and "not yours to see" never read alike.
 */
export const loadChargesSchema = z.object({
  /** `orders.total_charge`: what the customer pays for the whole ORDER (D-RATE4: never divided). */
  total_charge: z.number(),
  /** `orders.freight_charge`. */
  linehaul: z.number().nullable(),
  /** `orders.otherchargetotal` — may be negative. */
  other_charges: z.number().nullable(),
  /** `orders.total_charge_c`: 'USD' on every row measured (13,478 / 13,478 loaded orders since 01-01). */
  currency: z.string().nullable(),
  /** `orders.bill_distance`, only when its unit is miles (D-RATE5); null otherwise. */
  billed_miles: z.number().nullable(),
  /** How many loaded, non-void movements carry this order: above 1, the order is split (D-RATE4). */
  order_loaded_movements: z.number().int().nullable(),
});
export type LoadCharges = z.infer<typeof loadChargesSchema>;

/**
 * Rate per mile = the order's total ÷ its billed miles; null when McLeod billed no miles (or zero), which
 * the screens print as "—" (R3). Never against `loads.total_miles` — that is the route, not the bill.
 */
export function loadRatePerMile(c: Pick<LoadCharges, "total_charge" | "billed_miles">): number | null {
  return c.billed_miles != null && c.billed_miles > 0 ? c.total_charge / c.billed_miles : null;
}

/**
 * The note a split order's leg carries (D-RATE4): each loaded leg shows the ORDER's full total, because
 * McLeod states one total per order and never divides it — so the figure must say so. Null for an order
 * carried in one trip, or when the count is unknown.
 */
export function loadChargeSplitNote(c: Pick<LoadCharges, "order_loaded_movements">): string | null {
  const n = c.order_loaded_movements;
  return n != null && n > 1 ? `Order total · split over ${n} trips` : null;
}
