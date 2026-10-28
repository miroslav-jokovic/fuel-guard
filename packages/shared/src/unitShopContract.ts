import type { PmKind, PmStatus } from "./maintenanceDue.js";
import type { ShopDefectDto, ShopWorkOrderDto } from "./shopSummaryContract.js";

/**
 * The truck's page — the shop's hub for one truck or trailer (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §4.3, D-MX3; FLEETPAL-INTEGRATION-PLAN.md F10 + F11). Two reads:
 *
 *   · `GET /api/maintenance/units/attention` — every unit with a row on the Shop worklist and WHY, so
 *     the Trucks & trailers list can open on "needs attention" and the page's first section can say
 *     the same sentence the list did. One derivation, on the server, for both screens.
 *   · `GET /api/maintenance/units/:kind/:id/shop-file` — what the roster and FleetPal hold on one unit:
 *     identity, the meter, open and past work orders, open defects, and every PM schedule judged by
 *     `pmStatus`.
 *
 * The annual is NOT here as a verdict — it is our record's (`dot_annual_inspection_expires_at`,
 * Q-DBV2), carried as the date for `inspectionExpiry` to judge in the browser on the org's day.
 */

export type UnitRosterKind = "tractor" | "trailer";

/** One PM interval's reading, with the interval it came from, for the Due table. */
export interface PmIntervalStatusDto extends PmStatus {
  intervalType: "time" | "odometer";
}

export interface PmScheduleDto {
  fleetpalId: string;
  /** FleetPal's own name — "6-Month Inspection", "PM Reefer" — never a guessed label. */
  name: string | null;
  kind: PmKind;
  lastDone: string | null;
  intervals: PmIntervalStatusDto[];
  /**
   * The worst of its intervals: overdue beats due beats ok. Null when NO interval could be judged
   * (never done; a mileage interval on a unit with no meter) — "unknown" is not "fine".
   */
  verdict: PmStatus["verdict"] | null;
}

export interface UnitWorkOrderHistoryDto {
  id: string;
  referenceNumber: string | null;
  status: string | null;
  description: string | null;
  /** The jobs' names, as FleetPal lists them on the order. */
  jobs: string[];
  openedAt: string | null;
  completedAt: string | null;
  /** Whole days between started and completed, `unitCost.ts`'s rule: same-day is 1; null when either end is missing. */
  downtimeDays: number | null;
}

export interface UnitShopFileDto {
  unit: {
    kind: UnitRosterKind;
    id: string;
    unitNumber: string;
    year: number | null;
    make: string | null;
    model: string | null;
    plate: string | null;
    vin: string | null;
    status: string;
    /** The roster's odometer (Samsara's) for a tractor; null for a trailer or an unread truck. */
    odometerMiles: number | null;
    annualInspectionExpiresOn: string | null;
    registrationExpiresOn: string | null;
  };
  fleetpal: {
    /** Every FleetPal unit this row resolves to — more than one is the duplicate-VIN case (`unitCost.ts`). Empty = unmatched. */
    unitIds: string[];
    number: string | null;
    /** FleetPal's latest odometer reading, for the shop to compare with the roster's. */
    lastMeter: { miles: number; measuredAt: string } | null;
  };
  openWorkOrders: ShopWorkOrderDto[];
  openDefects: ShopDefectDto[];
  /** Past work orders, most recent first, capped — the repair record (D-INV10), not the bill (D-FP4). */
  history: UnitWorkOrderHistoryDto[];
  pm: {
    /** The miles every mileage interval was judged against, and whose reading it was. */
    odometerMiles: number | null;
    odometerSource: "roster" | null;
    schedules: PmScheduleDto[];
  };
}

/** Why a unit is on the worklist (§4.2's groups, in their order of urgency). */
export type UnitAttentionReason =
  | { kind: "defect"; count: number; oldestDetectedAt: string | null }
  | { kind: "work_order"; count: number; oldestOpenedAt: string | null }
  | { kind: "annual"; expiresOn: string; daysRemaining: number }
  | { kind: "pm"; name: string | null; pmKind: PmKind; verdict: "due" | "overdue"; dueOn: string | null; milesLeft: number | null }
  | { kind: "short"; shortBy: number; lastCheckedAt: string | null }
  | { kind: "open_check"; openedAt: string };

export interface UnitAttentionDto {
  kind: UnitRosterKind;
  unitId: string;
  unitNumber: string;
  /** Most urgent first — the first one is "the one sentence that put it on the list" (§4.3). */
  reasons: UnitAttentionReason[];
}

/** The worklist's order (§4.2): hardest deadline first. Roadside repairs are merged by the page (D-IC7). */
export const ATTENTION_ORDER: Record<UnitAttentionReason["kind"], number> = {
  defect: 0, work_order: 1, annual: 2, pm: 3, short: 4, open_check: 5,
};
export function sortAttentionReasons(reasons: readonly UnitAttentionReason[]): UnitAttentionReason[] {
  return [...reasons].sort((a, b) => urgency(a) - urgency(b) || ATTENTION_ORDER[a.kind] - ATTENTION_ORDER[b.kind]);
}
/** Overdue before due: an expired annual outranks a defect found yesterday. */
const urgency = (r: UnitAttentionReason): number =>
  (r.kind === "annual" && r.daysRemaining < 0) || (r.kind === "pm" && r.verdict === "overdue") ? 0 : 1;
