/**
 * The repair record of a roadside inspection's vehicle violations (INSPECTION-CHALLENGE-PLAN IC11, D-IC14;
 * Q-IC12 (a), Q-IC13, Q-IC14 — owner and measurement, 2026-10-15/16).
 *
 * 49 CFR 396.9(d): every violation on the report is corrected, the repair is in the unit's maintenance
 * record, and a carrier official certifies the report within 15 days of the inspection. The maintenance
 * record is FleetPal's, so for each inspected unit with a Part 393/396 violation the engine proposes the
 * FleetPal work orders opened on that unit from the inspection date to the due date. It never accepts one:
 * measured 2026-10-16 over the last year's 148 violated units, 56 had exactly one work order in the window,
 * 28 several, 49 none and 15 were repaired at the scene — one-in-the-window is not a rule (Q-IC14).
 * Maintenance accepts, safety certifies (Q-IC13); those are person rows, written by the next merge.
 */

/** The proposal's rule version (D-IC5): a change is a new version, and every open unit is proposed again. */
export const REPAIR_ENGINE_VERSION = "ic11.1";

/** Parts and Accessories (393) and Inspection, Repair and Maintenance (396): the violations a repair closes. */
export const REPAIR_VIOLATION_PARTS = ["393", "396"] as const;

/** 396.9(d)(3): certified "within 15 days following the date of the inspection". */
export const REPAIR_DUE_DAYS = 15;

/**
 * How long after the due date the engine keeps re-reading a unit nobody has decided. FleetPal syncs hourly
 * and a work order's status moves after it opens; past this a late proposal helps nobody, and the unit's
 * last reading stands until a person decides.
 */
export const REPAIR_FOLLOW_DAYS = 30;

/**
 * 396.9(d)(3)(ii): the report is kept 12 months from the inspection. Older inspections are not proposed:
 * the record they would close has left the period anyone may ask for it.
 */
export const REPAIR_LOOKBACK_DAYS = 365;

/**
 * Engine outcomes:
 * `repaired_at_scene`  — every violation on the unit was repaired at the scene (FMCSA defect verification
 *                        1, Q-IC5); no work order is needed and the record says why.
 * `one_candidate` / `several_candidates` / `no_candidate` — FleetPal work orders on the unit in the window.
 * `no_fleetpal_unit`   — the unit is ours but FleetPal has no unit matched to it.
 * `unit_not_ours`      — FMCSA's unit matched none of our vehicles or trailers (sold, interchange, typo).
 * Person outcomes (the next merge):
 * `accepted`           — maintenance named THE work order.
 * `repaired_outside_fleetpal` — repaired without a FleetPal work order; the note says where.
 */
export const REPAIR_ENGINE_OUTCOMES = [
  "repaired_at_scene",
  "one_candidate",
  "several_candidates",
  "no_candidate",
  "no_fleetpal_unit",
  "unit_not_ours",
] as const;
export const REPAIR_PERSON_OUTCOMES = ["accepted", "repaired_outside_fleetpal"] as const;
export const REPAIR_OUTCOMES = [...REPAIR_ENGINE_OUTCOMES, ...REPAIR_PERSON_OUTCOMES] as const;
export type RepairEngineOutcome = (typeof REPAIR_ENGINE_OUTCOMES)[number];
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

/** FleetPal's cancelled work order (`fleetpal_work_orders.status`, measured 2026-10-16: CLOSED, OPEN, CANCELED, COMPLETED). */
export const FLEETPAL_CANCELED_STATUS = "CANCELED";

/** One proposed FleetPal work order, as frozen on the engine row. */
export interface RepairCandidate {
  /** FleetPal's work-order id. */
  workOrderId: string;
  /** As people see it in FleetPal, shop prefix included. */
  reference: string | null;
  /** Opened, as a calendar day in the org's zone (YYYY-MM-DD). */
  openedOn: string;
  status: string | null;
  completedAt: string | null;
  description: string | null;
  /** The work order's job names, as the shop wrote them — what a person reads to decide. */
  jobs: string[];
}

/** The day the certification is due: the inspection's calendar day plus 15 (both YYYY-MM-DD). */
export function repairDueOn(inspectionDate: string): string {
  const d = new Date(`${inspectionDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + REPAIR_DUE_DAYS);
  return d.toISOString().slice(0, 10);
}
