/**
 * When a truck or trailer is due for its inspections and service, pure (DISPATCH-BOARD-V2-PLAN D-DBV5).
 *
 * The dispatchers' own board shows "Oil Change Due 1,133 mi" and "6-Month Inspection Overdue" under a
 * unit; those are FleetPal PM schedules, and on 2026-10-15 nothing in this product computed due or
 * overdue from them (`vehicles.next_pm_due_*` has never had a writer; FleetPal plan F11). This file is
 * that computation, once, so the board and F11's writer cannot disagree when it lands.
 *
 * ── THE NAMES ARE FREE TEXT ──────────────────────────────────────────────────────────────────────
 * Measured in production 2026-10-16: "Annual DOT Inspection" 427, "6-Month Inspection" 420, "Oil
 * Change" 252, and beside them "Oil Chnage", "6-Month Isnpection", "Annual lDOT Inspection", "DOT
 * Annual", "PM Service - Oil Change". A schedule is classified by keyword, typos included, and
 * anything else is "other" and not shown — a guessed kind would put a wrong chip on a truck.
 *
 * ── THE ANNUAL IS OUR RECORD, NOT FLEETPAL'S (Q-DBV2) ────────────────────────────────────────────
 * The §396.17 annual already has a record here (`dot_annual_inspection_expires_at`, the annual-
 * inspection module, `inspectionExpiry`). Two sources for one fact is the workaround CLAUDE.md names,
 * so `pmWarning` answers for the 6-month inspection and the oil change only; the board takes the
 * annual from the record.
 */
import { INSPECTION_EXPIRY_WARNING_DAYS, inspectionExpiry, type InspectionExpiryState } from "./annualInspectionContract.js";
import type { BoardWarning } from "./dispatchBoardContract.js";

export const PM_KINDS = ["annual", "six_month", "oil", "other"] as const;
export type PmKind = (typeof PM_KINDS)[number];

/** Which inspection or service a FleetPal schedule's name means. */
export function classifyPmName(name: string | null | undefined): PmKind {
  const n = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\boil\b/.test(n)) return "oil";
  if (/\b(6|six)\s*(month|mo)\b/.test(n)) return "six_month";
  if (/\bannual\b/.test(n) || /\bdot\b.*\binsp/.test(n)) return "annual";
  return "other";
}

/** A FleetPal PM interval as stored (0349): a TIME interval in months/days/years, or an ODOMETER one in metres. */
export interface PmInterval {
  intervalType: string | null;
  value: number | null;
  valueUnit: string | null;
  threshold: number | null;
  thresholdUnit: string | null;
  lastDoneMeterMeters: number | null;
}

export type DueVerdict = BoardWarning["verdict"];

/**
 * A unit's warning: the contract's `BoardWarning` (`dueOn` is `YYYY-MM-DD`, null for a mileage interval
 * and a repair order; `milesLeft` is negative when overdue, set only for a mileage interval).
 */
export type MaintenanceWarning = BoardWarning & { unit: "truck" | "trailer"; kind: "annual" | "six_month" | "oil" | "repair_order" };

const METERS_PER_MILE = 1609.344;

function addTime(fromIso: string, n: number, unit: string): Date | null {
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) return null;
  const u = unit.toUpperCase();
  if (u === "DAY") d.setUTCDate(d.getUTCDate() + n);
  else if (u === "WEEK") d.setUTCDate(d.getUTCDate() + n * 7);
  else if (u === "MONTH") d.setUTCMonth(d.getUTCMonth() + n);
  else if (u === "YEAR") d.setUTCFullYear(d.getUTCFullYear() + n);
  else return null;
  return d;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Where one PM interval stands against the latest meter or the calendar — the ONE judgement, shared by
 * the dispatch board's chip (`pmWarning`), the truck's page (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §4.3, M3) and F11's `next_pm_due_*` projection, so no two screens can disagree about one schedule.
 *
 * `verdict` is `overdue` past the interval, `due` inside FleetPal's own warning window (`threshold`,
 * the same window FleetPal colours by), `ok` with room left, and NULL when the schedule cannot be
 * judged — never done, a mileage interval with no odometer, an interval with no unit — because a
 * verdict claimed for a truck whose record is merely incomplete is the false alarm that trains people
 * to ignore the column (the annual module's own rule, `inspectionExpiry`). A TIME interval carries
 * `dueOn`; a mileage one carries `dueAtMiles` and `milesLeft` (negative once overdue).
 */
export interface PmStatus {
  verdict: DueVerdict | "ok";
  dueOn: string | null;
  dueAtMiles: number | null;
  milesLeft: number | null;
}
export function pmStatus(i: PmInterval, lastDone: string | null, odometerMiles: number | null, now: Date): PmStatus | null {
  if (i.value == null || i.value <= 0) return null;
  if ((i.intervalType ?? "").toUpperCase() === "ODOMETER") {
    if (i.lastDoneMeterMeters == null || odometerMiles == null) return null;
    const dueAtMiles = Math.round((i.lastDoneMeterMeters + i.value) / METERS_PER_MILE);
    const left = Math.round(dueAtMiles - odometerMiles);
    const window = (i.threshold ?? 0) / METERS_PER_MILE;
    const verdict = left < 0 ? "overdue" : left <= window ? "due" : "ok";
    return { verdict, dueOn: null, dueAtMiles, milesLeft: left };
  }
  if (!lastDone || !i.valueUnit) return null;
  const due = addTime(lastDone, i.value, i.valueUnit);
  if (!due) return null;
  if (due.getTime() < now.getTime()) return { verdict: "overdue", dueOn: ymd(due), dueAtMiles: null, milesLeft: null };
  const warnFrom = i.threshold && i.thresholdUnit ? addTime(due.toISOString(), -i.threshold, i.thresholdUnit) : due;
  const verdict = warnFrom && now.getTime() >= warnFrom.getTime() ? "due" : "ok";
  return { verdict, dueOn: ymd(due), dueAtMiles: null, milesLeft: null };
}

/**
 * Is this 6-month inspection or oil change due? The board's chip: `pmStatus` with `ok` and "cannot be
 * judged" both answered as null, because a chip is only drawn for something to act on.
 */
export function pmWarning(
  kind: "six_month" | "oil",
  unit: "truck" | "trailer",
  i: PmInterval,
  lastDone: string | null,
  odometerMiles: number | null,
  now: Date,
): MaintenanceWarning | null {
  const s = pmStatus(i, lastDone, odometerMiles, now);
  if (!s || s.verdict === "ok") return null;
  return { unit, kind, verdict: s.verdict, dueOn: s.dueOn, milesLeft: s.milesLeft };
}

/**
 * When a TIME interval next falls due: the day it was last done plus the interval, `YYYY-MM-DD`. Null
 * for a mileage interval, a schedule never done, or a unit this does not know — never a guess.
 */
export function pmDueOn(i: PmInterval, lastDone: string | null): string | null {
  if ((i.intervalType ?? "").toUpperCase() === "ODOMETER" || i.value == null || i.value <= 0) return null;
  if (!lastDone || !i.valueUnit) return null;
  const due = addTime(lastDone, i.value, i.valueUnit);
  return due ? ymd(due) : null;
}

/**
 * Where FleetPal's annual and our record disagree (DISPATCH-BOARD-V2-PLAN Q-DBV2, second half). The board
 * takes the annual from our record; FleetPal's own annual PM is used for nothing but this — showing the
 * shop manager which of the two needs correcting.
 *
 * Both dates are judged by the record's own rule (`inspectionExpiry`), so "expired" means one thing on
 * both sides. They disagree when:
 * - their VERDICTS differ — one says expired or due within the warning window and the other does not, so
 *   the board's chip would change if the other date were the true one; or
 * - they are more than the warning window apart (`INSPECTION_EXPIRY_WARNING_DAYS`): too far to be one
 *   inspection entered on two days, even while both still say "valid". Measured 2026-10-16 on the
 *   active fleet: 265 of 409 pairs within 10 days, 61 at 11–31, 83 beyond 31.
 * A unit with no record of ours but an annual in FleetPal disagrees too: the board shows it nothing.
 * One FleetPal has no annual for is not a disagreement — FleetPal simply does not schedule it.
 */
export interface AnnualDisagreement {
  ours: InspectionExpiryState;
  fleetpal: InspectionExpiryState;
  /** FleetPal's date minus ours, in days: positive when FleetPal's is later. Null with no record of ours. */
  gapDays: number | null;
}
export function annualDisagreement(ourExpiresOn: string | null, fleetpalDueOn: string | null, today: string): AnnualDisagreement | null {
  if (!fleetpalDueOn) return null;
  const ours = inspectionExpiry(ourExpiresOn, today);
  const fleetpal = inspectionExpiry(fleetpalDueOn, today);
  const gapDays = ours.daysRemaining == null ? null : fleetpal.daysRemaining! - ours.daysRemaining;
  if (ours.state === fleetpal.state && gapDays != null && Math.abs(gapDays) <= INSPECTION_EXPIRY_WARNING_DAYS) return null;
  return { ours: ours.state, fleetpal: fleetpal.state, gapDays };
}

/** The annual from our own record (Q-DBV2): expired is overdue, inside the record's 30 days is due. */
export function annualWarning(unit: "truck" | "trailer", expiresOn: string | null, today: string): MaintenanceWarning | null {
  const e = inspectionExpiry(expiresOn, today);
  if (e.state === "expired") return { unit, kind: "annual", verdict: "overdue", dueOn: e.expiresOn, milesLeft: null };
  if (e.state === "expiring") return { unit, kind: "annual", verdict: "due", dueOn: e.expiresOn, milesLeft: null };
  return null;
}

/**
 * Must a dispatcher act on it now? Anything overdue, and a random test: a drawn driver is sent to
 * collection promptly once told (§382.305(l)), which is the dispatcher's move to plan around (Q-DBV3).
 * It is red on the board and puts the truck on Needs attention.
 */
export const warningIsUrgent = (w: Pick<BoardWarning, "verdict" | "kind">): boolean => w.verdict === "overdue" || w.kind === "random_test";

/**
 * Urgent first, then the driver before the truck before its trailer — whether the driver may drive at
 * all comes before what the equipment needs — then by kind: the order a dispatcher reads them.
 */
const UNIT_ORDER: Record<BoardWarning["unit"], number> = { driver: 0, truck: 1, trailer: 2 };
const KIND_ORDER: Record<BoardWarning["kind"], number> = {
  random_test: 0, medical_card: 1, cdl: 2, annual: 3, six_month: 4, oil: 5, repair_order: 6,
};
export function sortWarnings<W extends BoardWarning>(w: readonly W[]): W[] {
  return [...w].sort(
    (a, b) =>
      (warningIsUrgent(a) ? 0 : 1) - (warningIsUrgent(b) ? 0 : 1) ||
      UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}
