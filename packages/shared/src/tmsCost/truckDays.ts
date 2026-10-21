import { z } from "zod";

/**
 * Truck-days — how many days of a period each truck was the carrier's to pay for, the basis the
 * per-truck P&L spreads lease, insurance and GPS over (TRUCK-DRIVER-PNL-PLAN §3 P2, D-TP3, Q-TP2).
 *
 * A truck bought on the 20th carries eleven days of that month's lease; one sold on the 9th stops on
 * the 9th. So the unit is the DAY a truck was in service, not "a truck" — a month's fleet is not a
 * count of trucks, it is a sum of days.
 *
 * The days come from McLeod's own service dates (`tractor.inservice_date` / `outservice_date`),
 * staged whole every financial sweep (0510). Measured against the trucks that actually worked —
 * every truck named on a live settlement — on lme_analytics 2026-10-21, company TMS:
 *
 *   month     worked   in service by these dates   worked but outside its dates
 *   May 2026     154                        160                              1
 *   Jun 2026     149                        180                              1
 *   Jul 2026     159                        193                              1
 *   Aug 2026     163                        193                              1
 *
 * The one exception each month is a unit with no tractor row at all. The 7–35 trucks in service that
 * did not work are the shop, the winding-down and the newly delivered — which is exactly who still
 * carries a lease.
 *
 * ⚠ `outservice_date` is NOT cleared when a truck comes back (D-FC2: units 552, 555 and 569 ran with
 * one set in September). On these four months that cost nothing — no truck that worked was outside
 * its dates — but it is why a truck working on a day outside its period is reported by the caller
 * (`unitsOutsideCensus`), never silently added or dropped.
 */

/** One McLeod tractor as the financial sweep stages it — McLeod's columns, verbatim (0510). */
export const tractorPeriodSchema = z.object({
  tractor_id: z.string().trim().min(1).max(20),
  company_id: z.string().trim().min(1).max(4),
  /** YYYY-MM-DD. A truck is in service FROM this day. */
  in_service_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** YYYY-MM-DD, exclusive: the first day the truck is no longer the carrier's. */
  out_of_service_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  purchased_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  model_year: z.string().trim().max(8).nullish(),
  service_status: z.string().trim().max(2).nullish(),
  tractor_status: z.string().trim().max(2).nullish(),
  /** The McLeod payee that owns the truck (`tractor.owner`). */
  owner_id: z.string().trim().max(12).nullish(),
  /** McLeod's `tractor.pay_owner` — who the truck's owner is, as a code (`truckOwnership`). */
  pay_owner: z.string().trim().max(2).nullish(),
});
export type TractorPeriod = z.infer<typeof tractorPeriodSchema>;

/** Every tractor the company has, ~700 rows today; the ceiling refuses a runaway payload only. */
export const tmsTractorPeriodsPayloadSchema = z.object({ tractors: z.array(tractorPeriodSchema).max(10000) });
export type TmsTractorPeriodsPayload = z.infer<typeof tmsTractorPeriodsPayloadSchema>;

/**
 * Whether a tractor row is a truck at all — D-FC1's census predicate. A row with neither a purchase
 * date nor a model year is a RESERVED unit number entered ahead of delivery: 42 of them share
 * `inservice_date` 2026-09-04, none has ever been dispatched, and counting them would hand a month's
 * lease to 42 trucks that do not exist yet.
 */
export function isTruck(p: Pick<TractorPeriod, "purchased_on" | "model_year">): boolean {
  return Boolean(p.purchased_on) || Boolean(p.model_year?.trim());
}

export type TruckOwnership = "carrier" | "owner_operator";

/**
 * Whose truck it is, from McLeod's `pay_owner` (Q-TP5: an owner-operator truck carries office
 * overhead per mile, never the carrier's lease or insurance).
 *
 * Measured 2026-10-21 on the 202 in-service trucks: `D` on 186, all owned by Silvicom itself; `O` on
 * 7, each owned by the contractor who drives it; `B` on 9, all owned by Scorpio Logistics Inc. A
 * Scorpio truck is read as an OWNER-OPERATOR truck, on the books' evidence — no AP voucher to Scorpio
 * in 2026, its July fuel went through the owner-operator fuel asset (17000000) and was charged back
 * through DRS, and its pay through the owner-operator payable (20500020, $111,234.86). The carrier
 * pays no lease on it. That reading is Q-TP12 (plan §6): the owner confirms it, or `B` moves here.
 */
const OWNER_OPERATOR_PAY_OWNER = new Set(["O", "B"]);

export function truckOwnership(p: Pick<TractorPeriod, "pay_owner">): TruckOwnership {
  return OWNER_OPERATOR_PAY_OWNER.has(p.pay_owner?.trim().toUpperCase() ?? "") ? "owner_operator" : "carrier";
}

export interface TruckDayRow {
  tractor_id: string;
  company_id: string;
  ownership: TruckOwnership;
  /** Days in [start, end) the truck was in service. Always > 0: a truck with none is not listed. */
  days: number;
}

export interface TruckDays {
  period_start: string;
  period_end: string;
  trucks: TruckDayRow[];
  /** Σ days, and the split the spread needs: lease and insurance go over `carrier` days only. */
  days: number;
  carrierDays: number;
  ownerOperatorDays: number;
  /** Rows left out, and why — printed with the basis, never dropped silently. */
  excluded: { reserved: number; undated: number };
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS;

/**
 * Each truck's days in service within [start, end) — YYYY-MM-DD, end exclusive like every period on
 * this integration. A truck is in service from `in_service_on` until the day before
 * `out_of_service_on`.
 *
 * A tractor with no `in_service_on` cannot be placed in time and is counted in `excluded.undated`
 * (one row, measured 2026-10-21) rather than assumed to have always been in service.
 */
export function truckDays(periods: readonly TractorPeriod[], start: string, end: string): TruckDays {
  const from = dayNumber(start);
  const to = dayNumber(end);
  const trucks: TruckDayRow[] = [];
  let reserved = 0;
  let undated = 0;
  for (const p of periods) {
    if (!isTruck(p)) {
      reserved += 1;
      continue;
    }
    if (!p.in_service_on) {
      undated += 1;
      continue;
    }
    const first = Math.max(from, dayNumber(p.in_service_on));
    const last = Math.min(to, p.out_of_service_on ? dayNumber(p.out_of_service_on) : to);
    if (last <= first) continue;
    trucks.push({ tractor_id: p.tractor_id, company_id: p.company_id, ownership: truckOwnership(p), days: last - first });
  }
  trucks.sort((a, b) => a.tractor_id.localeCompare(b.tractor_id, undefined, { numeric: true }));
  const sum = (rows: TruckDayRow[]) => rows.reduce((n, r) => n + r.days, 0);
  return {
    period_start: start,
    period_end: end,
    trucks,
    days: sum(trucks),
    carrierDays: sum(trucks.filter((t) => t.ownership === "carrier")),
    ownerOperatorDays: sum(trucks.filter((t) => t.ownership === "owner_operator")),
    excluded: { reserved, undated },
  };
}

/**
 * The units that worked in a period but are not in its census — named on a settlement, a fuel line
 * or a bill while McLeod's dates say they were out of service, or with no tractor row at all. The
 * per-truck P&L prints them as its exception list (one unit a month, May–August 2026) instead of
 * spreading onto a truck the census does not have, or dropping a truck that worked.
 */
export function unitsOutsideCensus(census: TruckDays, unitsWorked: Iterable<string>): string[] {
  const inCensus = new Set(census.trucks.map((t) => t.tractor_id));
  const out = new Set<string>();
  for (const u of unitsWorked) {
    const unit = u.trim();
    if (unit && !inCensus.has(unit)) out.add(unit);
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
