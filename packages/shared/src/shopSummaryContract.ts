import { z } from "zod";
import { daysInRange, todayInZone, type CalendarDay } from "./calendarDay.js";
import type { InspectionExpiryState } from "./annualInspectionContract.js";

/**
 * `GET /api/maintenance/shop-summary` — what is broken or waiting on the shop, as four figures
 * (FLEET-MANAGER-HOME-PLAN.md step FM3, card 5).
 *
 * ── COUNTS, NOT LISTS, AND NO MONEY ─────────────────────────────────────────────────────────────
 * The Operations tab carries no currency figure by construction (D-FM6), so nothing here is a cost:
 * repair spend stays on the shop home, behind its own surface. Each figure is a whole-org count read
 * by the rule that owns it — the work-order status FleetPal sends, the defect's own `is_resolved`,
 * and `isLowStock` through `listLowStock` — never a page of rows added up by the client.
 *
 * `oldestOpenWorkOrderAt` is null exactly when there is no open work order: an age needs a row.
 * It is the INSTANT FleetPal recorded the order (`vendor_created_at`), not a day, because the day it
 * falls on is the carrier's calendar's question and the card already holds the org zone
 * (`todayInZone`); a day cut here would be cut in the server's zone, which is UTC on Railway.
 */
export const shopSummarySchema = z.object({
  openWorkOrders: z.number().int().min(0),
  oldestOpenWorkOrderAt: z.iso.datetime({ offset: true }).nullable(),
  unresolvedDefects: z.number().int().min(0),
  /**
   * Stock LINES at or below their reorder point — a (part, location) pair, so one part short on two
   * shelves is two. That is the row the Parts page's "At reorder point" view lists, and the figure is
   * that list's own total.
   */
  lowStockLines: z.number().int().min(0),
  /** Trucks and trailers whose annual in FleetPal and in our record disagree — the length of `/annual-disagreements`. */
  annualDisagreements: z.number().int().min(0),
});
export type ShopSummary = z.infer<typeof shopSummarySchema>;

/**
 * The rows behind two of those figures (Q-FM6 (a), ruled 2026-10-13): `GET /api/maintenance/work-orders`
 * and `GET /api/maintenance/defects`, each the list its count opens. Read-only — FleetPal is where
 * the repair is worked (D-INV10), so neither row carries a verb.
 *
 * `unitNumber` is FleetPal's own fleet number for the unit (`fleetpal_units.number`), not a join to our
 * roster: the mapping is one-to-many and can be unmatched, and a row must not vanish because nobody has
 * linked its truck yet. Null when the vendor sent no unit or the unit is not staged.
 *
 * Both lists arrive WHOLE, oldest first. They are bounded by what is outstanding, not by history.
 */
export interface ShopWorkOrderDto {
  id: string;
  referenceNumber: string | null;
  unitNumber: string | null;
  description: string | null;
  priority: string | null;
  /** When FleetPal recorded the order — the instant the card's "oldest" figure is. */
  openedAt: string | null;
}

export interface ShopDefectDto {
  id: string;
  unitNumber: string | null;
  name: string | null;
  description: string | null;
  driverComment: string | null;
  detectedAt: string | null;
}

/**
 * The carrier's calendar day an instant fell on, and how many whole days ago that was: 0 for today.
 * One definition for the card's "oldest, N days" and the list's "Open for" column, so the top row of
 * the page and the figure on the card read the same.
 */
export const shopDayOf = (at: string, zone: string): CalendarDay => todayInZone(new Date(at), zone);
export const daysSince = (at: string, today: CalendarDay, zone: string): number =>
  daysInRange(shopDayOf(at, zone), today) - 1;

/**
 * One unit whose annual inspection date FleetPal and our record disagree on (`annualDisagreement`,
 * DISPATCH-BOARD-V2-PLAN Q-DBV2) — the rows behind the Shop card's "Annual dates to check". `unitNumber`
 * is OUR roster's, because the record being checked is ours; the FleetPal date is that unit's.
 */
export interface AnnualDisagreementDto {
  subjectType: "tractor" | "trailer";
  unitId: string;
  unitNumber: string;
  ourExpiresOn: string | null;
  fleetpalDueOn: string;
  ours: InspectionExpiryState;
  fleetpal: InspectionExpiryState;
  gapDays: number | null;
}

/**
 * `GET /api/maintenance/annual-due` — trucks and trailers whose annual inspection, as OUR record
 * holds it, is due within `INSPECTION_EXPIRY_WARNING_DAYS` or already overdue (the Shop worklist's
 * fourth group, MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.2, owner Q-MX5 (a) 2026-10-27).
 *
 * Only `expiring` and `expired` rows: a unit with NO recorded inspection is "unknown", not due, and a
 * list that carried every unrecorded truck would be the roster, not the shop's work. `daysRemaining`
 * is negative once overdue; `expiresOn` is a calendar day. Read by the same `listAnnualInspectionExpiries`
 * the FleetPal disagreement check reads, so the two lists cannot disagree about a unit's date.
 */
export interface AnnualDueDto {
  subjectType: "tractor" | "trailer";
  unitId: string;
  unitNumber: string;
  expiresOn: string;
  daysRemaining: number;
}
