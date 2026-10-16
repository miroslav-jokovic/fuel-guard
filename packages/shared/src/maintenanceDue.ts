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
import { inspectionExpiry } from "./annualInspectionContract.js";
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
 * Is this 6-month inspection or oil change due? Overdue past the interval; due inside FleetPal's own
 * warning window (`threshold`, the same window FleetPal colours by); otherwise nothing to say, so null.
 * Null too when the schedule cannot be judged — never done, an unknown unit, no odometer — because a
 * chip claiming "overdue" for a truck whose record is merely incomplete is the false alarm that trains
 * people to ignore the column (the annual module's own rule, `inspectionExpiry`).
 */
export function pmWarning(
  kind: "six_month" | "oil",
  unit: "truck" | "trailer",
  i: PmInterval,
  lastDone: string | null,
  odometerMiles: number | null,
  now: Date,
): MaintenanceWarning | null {
  if (i.value == null || i.value <= 0) return null;
  if ((i.intervalType ?? "").toUpperCase() === "ODOMETER") {
    if (i.lastDoneMeterMeters == null || odometerMiles == null) return null;
    const dueAtMiles = (i.lastDoneMeterMeters + i.value) / METERS_PER_MILE;
    const left = Math.round(dueAtMiles - odometerMiles);
    const window = (i.threshold ?? 0) / METERS_PER_MILE;
    if (left < 0) return { unit, kind, verdict: "overdue", dueOn: null, milesLeft: left };
    if (left <= window) return { unit, kind, verdict: "due", dueOn: null, milesLeft: left };
    return null;
  }
  if (!lastDone || !i.valueUnit) return null;
  const due = addTime(lastDone, i.value, i.valueUnit);
  if (!due) return null;
  if (due.getTime() < now.getTime()) return { unit, kind, verdict: "overdue", dueOn: ymd(due), milesLeft: null };
  const warnFrom = i.threshold && i.thresholdUnit ? addTime(due.toISOString(), -i.threshold, i.thresholdUnit) : due;
  if (warnFrom && now.getTime() >= warnFrom.getTime()) return { unit, kind, verdict: "due", dueOn: ymd(due), milesLeft: null };
  return null;
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
