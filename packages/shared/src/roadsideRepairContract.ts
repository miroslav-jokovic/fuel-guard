import { z } from "zod";
import { recordId } from "./recordId.js";
import { daysInRange, type CalendarDay } from "./calendarDay.js";
import type { RoadsideInspectionUnitDto } from "./roadsideInspectionsContract.js";

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

/** What each outcome says on the Repair card; keyed, so a new outcome without words fails the typecheck. */
export const REPAIR_OUTCOME_TEXT: Record<RepairOutcome, string> = {
  repaired_at_scene: "Repaired at the scene — the officer recorded it, so no work order is needed.",
  one_candidate: "One FleetPal work order was opened on this unit before the due date.",
  several_candidates: "Several FleetPal work orders were opened on this unit before the due date. Choose the one that repaired the violations.",
  no_candidate: "No FleetPal work order has been opened on this unit since the inspection.",
  no_fleetpal_unit: "FleetPal has no unit matched to this truck or trailer, so its work orders cannot be found.",
  unit_not_ours: "FMCSA's record does not tie this unit to one of our trucks or trailers.",
  accepted: "The repair is this FleetPal work order.",
  repaired_outside_fleetpal: "Repaired outside FleetPal.",
};

/**
 * `GET /api/roadside-inspections/:id/repairs` — one entry per inspected unit with a Part 393/396
 * violation the engine has read (IC11). Empty for an inspection with none, or older than a year.
 */
export interface RoadsideRepairDto {
  unitId: string;
  unit: Pick<RoadsideInspectionUnitDto, "seq" | "kind" | "companyNumber">;
  /** The 393/396 violations on the unit, as FMCSA wrote them. */
  violations: { code: string | null; description: string | null }[];
  dueOn: string;
  /** The engine's latest reading of the unit. */
  proposal: { outcome: RepairEngineOutcome; candidates: RepairCandidate[]; readAt: string };
  /** A person's latest decision, when there is one; it closes the unit to the engine. */
  decision: {
    outcome: (typeof REPAIR_PERSON_OUTCOMES)[number];
    /** The accepted work order as the proposal showed it; null for "outside FleetPal". */
    workOrder: RepairCandidate | null;
    note: string | null;
    decidedBy: string | null;
    decidedAt: string;
  } | null;
  /** The row a decision is made over — the newest — sent back as the decision's `basedOn`. */
  basedOn: string;
}

/**
 * `POST /api/roadside-inspections/:id/repairs` — maintenance names THE repair (Q-IC13). `accept` takes a
 * work order the proposal listed; `outside` says where it was repaired instead. `basedOn` is the row the
 * page showed: a decision over a row that is no longer the unit's latest is refused (409 `changed`).
 */
export const roadsideRepairDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), unitId: recordId(), basedOn: recordId(), workOrderId: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal("outside"), unitId: recordId(), basedOn: recordId(), note: z.string().trim().min(1).max(1000) }),
]);
export type RoadsideRepairDecision = z.infer<typeof roadsideRepairDecisionSchema>;

/** How a violated unit is named — on the Repair card, the rendered record and the "repair due" alert alike. */
export function repairUnitName(r: Pick<RoadsideRepairDto, "unit">): string {
  const kind = r.unit.kind === "tractor" ? "Truck" : r.unit.kind === "trailer" ? "Trailer" : "Unit";
  return r.unit.companyNumber ? `${kind} ${r.unit.companyNumber}` : `${kind} ${r.unit.seq ?? ""}`.trim();
}

/**
 * A unit whose repair is settled for the certification (IC11 B2): a person named its repair (a FleetPal work
 * order, or outside FleetPal and where), or the officer recorded it repaired at the scene. Anything else —
 * candidates nobody chose, none, a unit FleetPal or FMCSA cannot tie to us — still needs a person, because
 * 396.9(d)(3)(i) certifies that EVERY violation was corrected. One definition: the card's button and the
 * API's refusal agree.
 */
export function repairSettled(r: Pick<RoadsideRepairDto, "decision" | "proposal">): boolean {
  return r.decision !== null || r.proposal.outcome === "repaired_at_scene";
}

/**
 * The inspection's certification by safety (396.9(d)(3)(i), Q-IC13), as `GET /:id/repairs/certification`
 * returns it: the newest certifying act, and whether it still stands over the units' newest rows.
 */
export interface RoadsideRepairCertificationDto {
  id: string;
  signerName: string;
  signerTitle: string;
  /** The carrier's calendar day the server recorded — never one the page sent. */
  signedOn: string;
  certifiedAt: string;
  /** The rendered repair record (`roadside_repair_record`), on the inspection's Documents card. */
  documentId: string;
  /** False once any unit has a newer repair row than the one certified: certify again. */
  current: boolean;
}

/**
 * `POST /api/roadside-inspections/:id/repairs/certify` — safety certifies (Q-IC13). `basedOn` is every unit's
 * `basedOn` as the page showed them: a certification over a record that has since moved is refused (409).
 */
export const roadsideRepairCertifySchema = z.object({
  signerTitle: z.string().trim().min(1, "Give your title — the regulation asks for it.").max(120),
  basedOn: z.array(recordId()).min(1).max(20),
});
export type RoadsideRepairCertifyRequest = z.infer<typeof roadsideRepairCertifySchema>;

/**
 * Where a unit stands against its 396.9(d) due day, on the carrier's calendar: days left (0 = due today) or
 * days overdue. One definition, so the Repair card and the "repair due" alert (IC11 B2) never disagree.
 */
export function repairClock(dueOn: CalendarDay, today: CalendarDay): { overdue: boolean; days: number } {
  return today <= dueOn ? { overdue: false, days: daysInRange(today, dueOn) - 1 } : { overdue: true, days: daysInRange(dueOn, today) - 1 };
}
