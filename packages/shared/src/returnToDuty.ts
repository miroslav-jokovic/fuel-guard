import { canReadTestingRecords } from "./auth.js";
import type { UserRole } from "./constants.js";

/**
 * §40.25(j) — the obligation an application's admission creates, and the one thing that ends it.
 *
 * ── THE RULE, IN ITS OWN WORDS ────────────────────────────────────────────────────────────────
 * 49 CFR §40.25(j) requires the employer to ask whether the applicant tested positive, or refused to
 * test, on a pre-employment drug or alcohol test for a job they applied for but did not obtain, in
 * the preceding two years. If the applicant admits it, the employer "must not use the employee to
 * perform safety-sensitive functions" until the employee documents successful completion of the
 * return-to-duty process (§40.305).
 *
 * P8 shipped the question. This is the half that acts on the answer.
 *
 * ── WHY THIS IS A PURE FUNCTION IN SHARED AND NOT A QUERY IN THE API ──────────────────────────
 * Three surfaces have to agree about it and they read different things: the dispatch service refuses
 * an assignment, the hire preview warns before a recruiter commits, and the driver's file shows the
 * outstanding item. A predicate written three times is a predicate that will be true in two places
 * and false in the third on the day it matters.
 *
 * ── WHAT "SAFETY-SENSITIVE" MEANS HERE ────────────────────────────────────────────────────────
 * §382.107 defines it as, among other things, driving a commercial motor vehicle. In this product the
 * act that puts a driver behind the wheel is a LOAD ASSIGNMENT, so that is where the refusal lives.
 * Hiring is not a safety-sensitive function and is not refused — a carrier may lawfully hire somebody
 * mid-process, and a gate on the hire would be stricter than the rule while leaving the thing the
 * rule forbids wide open.
 */

/** The shape the gate needs from a driver row — nothing more, so any caller can satisfy it. */
export interface ReturnToDutySubject {
  /** `drivers.return_to_duty_required`, projected from the application by trigger (0237). */
  returnToDutyRequired: boolean;
  /** True when a `return_to_duty` qualification record is on file for this driver. */
  returnToDutyDocumented: boolean;
  /**
   * MS2 (MEDSTOP-PLAN.md §6 F-5): the collection day of this driver's newest verified POSITIVE or
   * REFUSAL in Med-Stop, as `medstopViolationOn` reads it — null when there is none (or it is history
   * from before the product watched, D-MS5). Absent for callers that only know the application flag.
   */
  violationOn?: string | null;
  /** The newest `return_to_duty` record's `occurred_on`, read beside `violationOn`. */
  lastReturnToDutyOn?: string | null;
}

/**
 * May this driver be put behind the wheel?
 *
 * ⚠ **Documented, not "recent".** §40.25(j) asks for documentation of a completed process; it sets no
 * expiry on it, and inventing one here would refuse a driver the regulation permits. If the SAP's
 * follow-up testing plan is still running that is a §40.307 matter with its own records, and it is
 * not this predicate's business to guess at it.
 */
export const returnToDutyOutstanding = (subject: ReturnToDutySubject): boolean =>
  returnToDutyCause(subject) !== null;

/**
 * WHY a driver is held, or null when they are not. Two obligations, discharged differently:
 *
 * - `admission` — §40.25(j), the application's answer. Any `return_to_duty` record discharges it,
 *   because the admission is about a test before this employer, and one documented process is the
 *   documentation the rule asks for.
 * - `violation` — a Med-Stop POSITIVE or REFUSAL on this employer's own test (§382.211/§382.215).
 *   ⚠ Only a record dated ON OR AFTER the violation discharges it. A driver who completed
 *   return-to-duty in 2025 and tests positive in 2026 owes a second process; "any record ever" —
 *   the admission's rule — would wave them through, which is the gap MS2 found in the door it reuses.
 *
 * A violation outranks an admission: it is the more recent, more specific fact, and what the office
 * has to do about it (a new SAP process) is the same either way.
 */
export function returnToDutyCause(subject: ReturnToDutySubject): "violation" | "admission" | null {
  const violationOn = subject.violationOn ?? null;
  if (violationOn !== null) {
    const last = subject.lastReturnToDutyOn ?? null;
    if (last === null || last < violationOn) return "violation";
  }
  if (subject.returnToDutyRequired && !subject.returnToDutyDocumented) return "admission";
  return null;
}

/**
 * What the refusal says, and to whom.
 *
 * ⚠ **It names no regulation** (D-UI9) on the dispatcher-facing side, and it does not say what the
 * driver admitted. A dispatcher assigning a load needs to know the assignment cannot be made and who
 * can unblock it; the underlying fact is a §382.401(a) testing record and they are not entitled to
 * it. "Safety review" is the honest euphemism — it is what the block is.
 */
export const RETURN_TO_DUTY_BLOCK = {
  code: "return_to_duty_required",
  /** Shown to whoever tried to assign the load. */
  dispatch:
    "This driver cannot be assigned to a load yet. Their file has an outstanding safety review that "
    + "has to be closed by a safety manager or an administrator first.",
  /**
   * Shown to the recruiter at the hire. More than the dispatcher gets, and deliberately: the
   * recruiter read the application answer, so nothing here is new to them, and they are the person
   * who has to ask the applicant for the paperwork.
   */
  hire:
    "This applicant said they had a positive or refused pre-employment test in the past two years. "
    + "Hiring them is allowed — putting them behind the wheel is not, until the paperwork showing "
    + "they finished the return-to-duty process is on file.",
  /**
   * Shown to the recruiter when the hold comes from a Med-Stop result rather than the application.
   * ⚠ Names no result: the recruiter may not read testing records (`canReadTestingRecords`), and
   * unlike the admission, the applicant never told them. The DER has the result and the alert.
   */
  hireViolation:
    "Hiring is allowed, but this person cannot be put behind the wheel yet. Their file has an "
    + "outstanding safety review that a safety manager or an administrator has to close first.",
  /** The item as it reads in the driver's file. */
  label: "Return-to-duty documentation",
} as const;

/**
 * The driver page's view of the hold (MEDSTOP-PLAN §7A.15, the MS2 open item: the file never showed a
 * Med-Stop hold). EVERY reader learns THAT the driver is held — the dispatcher must not find out by
 * having a load refused. Only a reader `canReadTestingRecords` admits learns that it is a Med-Stop
 * violation, and on which day: that is the §382.401(a) record itself.
 *
 * The admission stays visible to every reader, as it always has (`drivers.return_to_duty_required`
 * is not a testing record, auth.ts) — so a violation must not read differently from "held, cause not
 * yours to know" for anybody else.
 */
export interface DriverDispatchHold {
  held: boolean;
  /** `violation` only for a testing-record reader; `admission` for every reader. */
  cause: "violation" | "admission" | null;
  /** The violation's collection day, for a testing-record reader; else null. */
  violationOn: string | null;
}

export function dispatchHoldForReader(
  standing: { cause: "violation" | "admission" | null; violationOn: string | null },
  role: UserRole | null | undefined,
): DriverDispatchHold {
  if (canReadTestingRecords(role)) return { held: standing.cause !== null, cause: standing.cause, violationOn: standing.violationOn };
  return { held: standing.cause !== null, cause: standing.cause === "admission" ? "admission" : null, violationOn: null };
}

/** What the driver page's notice says for one reader's view, or null when the driver is not held. */
export function dispatchHoldNotice(hold: DriverDispatchHold, formatDay: (day: string) => string): string | null {
  if (!hold.held) return null;
  if (hold.cause === "admission") return RETURN_TO_DUTY_BLOCK.hire;
  if (hold.cause === "violation" && hold.violationOn)
    return `Med-Stop reported a positive or refused test collected ${formatDay(hold.violationOn)}. This driver cannot be dispatched until return-to-duty documentation dated on or after that day is filed below.`;
  return RETURN_TO_DUTY_BLOCK.dispatch;
}

