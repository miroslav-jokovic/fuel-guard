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
  subject.returnToDutyRequired && !subject.returnToDutyDocumented;

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
  /** The item as it reads in the driver's file. */
  label: "Return-to-duty documentation",
} as const;
