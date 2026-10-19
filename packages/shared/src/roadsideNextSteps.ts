import type { CalendarDay } from "./calendarDay.js";
import { ATTRIBUTION_BASIS_TEXT, ATTRIBUTION_OUTCOME_TEXT, type RoadsideAttributionDto } from "./roadsideAttributionContract.js";
import {
  REPAIR_OUTCOME_TEXT,
  repairClock,
  repairSettled,
  repairUnitName,
  type RoadsideRepairCertificationDto,
  type RoadsideRepairDto,
} from "./roadsideRepairContract.js";

/**
 * What is left to do on one roadside inspection (INSPECTION-CHALLENGE-PLAN Q-IC17, IC15; owner 2026-10-19).
 *
 * The Inspection page used to stack seven equal sections and say nowhere what was still open, so a safety
 * manager read all of them to learn whether anything needed them — and production showed the result: on
 * 2026-10-19, 0 reports uploaded, 1 driver confirmed, 0 of 127 inspections' repairs certified. Every step
 * worked; nothing led anyone to it.
 *
 * ── ONE DEFINITION, READ BY EVERY SURFACE ──────────────────────────────────────────────────────
 * The page's "Next steps" strip reads this, and so will the inbox's "Needs action" tab, the Shop home's
 * "Roadside repairs due" section and the bell (plan §8 IC15). A second copy of "is the repair settled?" in
 * any of them would be a list that disagrees with the page a click away.
 *
 * ── WHAT IS NOT A STEP YET ─────────────────────────────────────────────────────────────────────
 * A ticket with no court result (R-ADJ1) joins with IC4, which brings the acts that close it ("requested
 * from the court", "not contested"). Until then it would be a step nobody could close — a paid ticket would
 * stay open for ever, and a list that is always open stops being read.
 */

/** Who acts on a step: the section whose manage level the API checks for it (Q-IC13). */
export type RoadsideStepOwner = "safety" | "maintenance";

/**
 * `open`    — a person acts now.
 * `waiting` — nothing to do here yet: the engine has not read it, or another step must close first.
 * `done`    — settled; the title says how, so the strip still reads as the inspection's story.
 */
export type RoadsideStepState = "open" | "waiting" | "done";

/** The section of the page a step's action lives in — the strip scrolls there. */
export type RoadsideStepSection = "driver" | "documents" | "repair";

export interface RoadsideStep {
  /** Stable within an inspection: `driver`, `report`, `repair:<unitId>`, `certify`. */
  key: string;
  section: RoadsideStepSection;
  owner: RoadsideStepOwner;
  state: RoadsideStepState;
  title: string;
  detail: string | null;
  /** 396.9(d)'s day, on the repair steps; the caller formats it (dates are MM/DD/YYYY from one definition). */
  dueOn: CalendarDay | null;
  /** Days left or overdue against `dueOn` on the carrier's calendar; null when settled or undated. */
  clock: { overdue: boolean; days: number } | null;
}

/**
 * Why the driver card asks a person (IC13, Q-IC15 (b)). The card asks ONLY for these; a strong reading of
 * a roster driver with nothing against it is shown as the answer, labelled as Samsara's. A person still
 * confirms before any DataQs filing (18 USC 1001, D-IC7) — that is the filing step's, not this card's.
 */
export const ATTRIBUTION_ASK_REASONS = [
  "not_read",
  "report_disagrees",
  "other_state",
  "outcome",
  "weak",
  "not_on_roster",
] as const;
export type AttributionAskReason = (typeof ATTRIBUTION_ASK_REASONS)[number];

/**
 * The driver's question for one inspection: `null` when nothing needs a person (a person decided, or the
 * reading is strong, of a roster driver, and nothing contradicts it), else the reason and its sentence.
 * `not_read` is the one reason with nothing to answer yet — the step is `waiting`, not `open`.
 */
export function attributionQuestion(a: RoadsideAttributionDto): { reason: AttributionAskReason; text: string } | null {
  if (a.decision) return null;
  const r = a.reading;
  if (!r) return { reason: "not_read", text: "Samsara has not been read for this inspection yet. The newest inspections are read first, 25 an hour." };
  // A report that disagrees outranks Samsara however strong it reads: that is the disagreement Q-IC15 names.
  if (a.reports.some((p) => p.state === "checked" && p.outcome === "needs_review")) {
    return { reason: "report_disagrees", text: "The officer's report does not agree with Samsara. The driver card lists where." };
  }
  if (r.locationCheck === "other_state") {
    return { reason: "other_state", text: "The truck's GPS puts it in a different state from the report's." };
  }
  if (r.outcome !== "one_driver") return { reason: "outcome", text: ATTRIBUTION_OUTCOME_TEXT[r.outcome] };
  if (r.confidence !== "high") {
    return {
      reason: "weak",
      text: r.basis ? `Samsara's reading is weak: the driver was ${ATTRIBUTION_BASIS_TEXT[r.basis]}.` : "Samsara's reading is weak.",
    };
  }
  if (!r.driver) {
    return { reason: "not_on_roster", text: `Samsara names ${r.samsaraDriver?.name ?? "a driver"}, who is not on our roster.` };
  }
  return null;
}

/** The driver as the record now stands: the person's or the report's choice, else Samsara's reading. */
function driverName(a: RoadsideAttributionDto): string | null {
  return a.decision?.driver?.name ?? a.reading?.driver?.name ?? a.reading?.samsaraDriver?.name ?? null;
}

function driverStep(a: RoadsideAttributionDto): RoadsideStep {
  const base = { key: "driver", section: "driver", owner: "safety", dueOn: null, clock: null } as const;
  const ask = attributionQuestion(a);
  if (ask?.reason === "not_read") return { ...base, state: "waiting", title: "Who was driving", detail: ask.text };
  if (ask) {
    return {
      ...base,
      state: "open",
      title: "Say who was driving",
      detail: a.reports.length ? ask.text : `${ask.text} Uploading the officer's report can settle it: its licence number is checked against our roster and Samsara.`,
    };
  }
  const name = driverName(a) ?? "A driver";
  const how = !a.decision
    ? "from Samsara"
    : a.decision.kind === "confirmed_by_report"
      ? "confirmed by the officer's report"
      : a.decision.kind === "corrected"
        ? `corrected by ${a.decision.decidedBy ?? "a former user"}`
        : `confirmed by ${a.decision.decidedBy ?? "a former user"}`;
  return { ...base, state: "done", title: `Driver: ${name}`, detail: how };
}

function repairStep(r: RoadsideRepairDto, today: CalendarDay): RoadsideStep {
  const unit = repairUnitName(r);
  const base = { key: `repair:${r.unitId}`, section: "repair", owner: "maintenance", dueOn: r.dueOn } as const;
  if (repairSettled(r)) {
    const how = !r.decision
      ? "repaired at the scene"
      : r.decision.workOrder
        ? `repaired under FleetPal work order ${r.decision.workOrder.reference ?? r.decision.workOrder.workOrderId}`
        : "repaired outside FleetPal";
    return { ...base, state: "done", title: `${unit}: ${how}`, detail: null, clock: null };
  }
  return { ...base, state: "open", title: `${unit}: name the repair`, detail: REPAIR_OUTCOME_TEXT[r.proposal.outcome], clock: repairClock(r.dueOn, today) };
}

/** The certification is due with the repairs — one inspection, one 15-day clock — so the earliest unit's day. */
function certifyStep(repairs: readonly RoadsideRepairDto[], certification: RoadsideRepairCertificationDto | null, today: CalendarDay): RoadsideStep {
  const dueOn = repairs.map((r) => r.dueOn).sort()[0]!;
  const base = { key: "certify", section: "repair", owner: "safety", dueOn } as const;
  if (certification?.current) {
    return { ...base, state: "done", title: `Repairs certified by ${certification.signerName}`, detail: certification.signerTitle, clock: null };
  }
  if (!repairs.every(repairSettled)) {
    return { ...base, state: "waiting", title: "Certify the repairs", detail: "Waits for maintenance to name every unit's repair.", clock: repairClock(dueOn, today) };
  }
  return {
    ...base,
    state: "open",
    title: certification ? "Certify the repairs again" : "Certify the repairs",
    detail: certification ? `A repair changed after ${certification.signerName} certified.` : "Every repair is recorded. A safety manager certifies the report (49 CFR 396.9(d)).",
    clock: repairClock(dueOn, today),
  };
}

/**
 * The officer's report, asked for only where it carries weight: the 396.9(d) certification is made on it
 * (Q-IC13 renders the certification beside its image). An inspection with no vehicle repair does not ask —
 * the driver step says, when it is open, that the report can settle the driver too.
 */
function reportStep(a: RoadsideAttributionDto): RoadsideStep {
  const base = { key: "report", section: "documents", owner: "safety", dueOn: null, clock: null } as const;
  if (a.reports.length) return { ...base, state: "done", title: "Officer's report on file", detail: null };
  return {
    ...base,
    state: "open",
    title: "Upload the officer's report",
    detail: "The repair certification is made on it, and reading it can confirm the driver.",
  };
}

const STATE_ORDER: Record<RoadsideStepState, number> = { open: 0, waiting: 1, done: 2 };

/**
 * Every step of one inspection: open first (overdue, then soonest due, then undated), then waiting, then
 * done. `repairs` is the repair record (empty when the inspection has no Part 393/396 violation, or is
 * older than a year); `today` is the carrier's calendar day.
 */
export function roadsideNextSteps(input: {
  attribution: RoadsideAttributionDto;
  repairs: readonly RoadsideRepairDto[];
  certification: RoadsideRepairCertificationDto | null;
  today: CalendarDay;
}): RoadsideStep[] {
  const { attribution, repairs, certification, today } = input;
  const steps: RoadsideStep[] = [driverStep(attribution)];
  if (repairs.length) {
    steps.push(reportStep(attribution), ...repairs.map((r) => repairStep(r, today)), certifyStep(repairs, certification, today));
  }
  const urgency = (s: RoadsideStep) => (!s.clock ? Number.MAX_SAFE_INTEGER : s.clock.overdue ? -s.clock.days : s.clock.days);
  // Stable sort: within a state and an urgency the steps keep the page's own order (driver, report, units, certify).
  return steps
    .map((s, i) => ({ s, i }))
    .sort((x, y) => STATE_ORDER[x.s.state] - STATE_ORDER[y.s.state] || (x.s.state === "open" ? urgency(x.s) - urgency(y.s) : 0) || x.i - y.i)
    .map(({ s }) => s);
}

/** The open steps by owner — the page header's "2 open · 1 for maintenance", and the inbox's count. */
export function roadsideOpenSteps(steps: readonly RoadsideStep[]): { total: number; byOwner: Record<RoadsideStepOwner, number> } {
  const byOwner: Record<RoadsideStepOwner, number> = { safety: 0, maintenance: 0 };
  for (const s of steps) if (s.state === "open") byOwner[s.owner] += 1;
  return { total: byOwner.safety + byOwner.maintenance, byOwner };
}
