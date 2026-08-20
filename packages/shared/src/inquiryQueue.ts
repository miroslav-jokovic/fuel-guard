import { EMPLOYMENT_WINDOW_YEARS, yearsBefore } from "./employmentCoverage.js";
import type { InquiryOutcome } from "./employerInquiryContract.js";

/**
 * What is outstanding on the §391.23 investigation, and when it is due (EMPLOYER-INQUIRY-PLAN E5).
 *
 * ── TWO CLOCKS, AND ONLY ONE OF THEM IS OURS TO MISS (D-PEI3) ──────────────────────────────────
 * §391.23(g)(1) gives the PREVIOUS EMPLOYER 30 days from receiving the request. That is their
 * obligation and we cannot discharge it. §391.23(c)(1) gives US 30 days from the date the driver's
 * employment begins to have replies **or documentation of good-faith efforts** in the file. That one
 * is ours, it is the one an audit measures us against, and it is the one this queue leads with.
 *
 * The difference matters in the direction the product pushes somebody. A queue built on the
 * employer's clock says "wait, they still have eleven days". A queue built on ours says "you have
 * eleven days to have this documented, and a second attempt is documentation". The regulation does
 * not require an answer; it requires the asking and the record of it.
 *
 * ── WHAT COUNTS AS COMPLETE ────────────────────────────────────────────────────────────────────
 * Every DOT-regulated employer inside the §391.23(a)(2) three-year window has either answered or has
 * a documented non-response. An employer who never answered but was chased and documented is DONE —
 * treating them as permanently outstanding would show a lawful file as incomplete forever, which is
 * the failure D-PSP1 named in a different costume.
 *
 * Pure: `today` and the rows come in as arguments.
 */

/** §391.23(g)(1) — the previous employer's own deadline, measured from our contact. */
export const EMPLOYER_RESPONSE_DAYS = 30;
/** §391.23(c)(1) — OURS, measured from the date employment begins. */
export const INVESTIGATION_FILE_DAYS = 30;

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface QueueEmployment {
  id: string;
  employerName: string;
  startedOn: string;
  endedOn: string | null;
  dotRegulated: boolean;
}

export interface QueueAttempt {
  employmentId: string;
  contactedOn: string;
  outcome: InquiryOutcome;
}

export type InquiryState =
  /** Owed, and nobody has written yet. */
  | "not_sent"
  /** Written, and their 30 days have not run out. */
  | "awaiting"
  /** Written, their 30 days are up, and no answer — time to try again or document the effort. */
  | "overdue"
  /** They answered. */
  | "answered"
  /** They never did, and that is written down — §391.23(c)(1) accepts this. */
  | "documented"
  /** It did not reach them; the next attempt needs a different address. */
  | "undeliverable";

export const INQUIRY_STATE_LABELS: Record<InquiryState, string> = {
  not_sent: "Not sent",
  awaiting: "Awaiting their reply",
  overdue: "No reply — document the effort",
  answered: "Answered",
  documented: "Non-response documented",
  undeliverable: "Did not reach them",
};

/** The states that leave §391.23 work outstanding. `documented` is NOT one of them. */
const OPEN_STATES: ReadonlySet<InquiryState> = new Set<InquiryState>([
  "not_sent",
  "awaiting",
  "overdue",
  "undeliverable",
]);

export interface EmployerInquiryState {
  employmentId: string;
  employerName: string;
  state: InquiryState;
  /** When the employer's own §391.23(g)(1) window runs out. Null when nothing has been sent. */
  theirDeadline: string | null;
  attempts: number;
}

export function employerInquiryState(
  employment: QueueEmployment,
  attempts: readonly QueueAttempt[],
  today: string,
): EmployerInquiryState {
  const mine = attempts.filter((a) => a.employmentId === employment.id);
  const base = { employmentId: employment.id, employerName: employment.employerName, attempts: mine.length };

  if (mine.length === 0) return { ...base, state: "not_sent", theirDeadline: null };
  if (mine.some((a) => a.outcome === "responded")) return { ...base, state: "answered", theirDeadline: null };
  if (mine.some((a) => a.outcome === "no_response")) return { ...base, state: "documented", theirDeadline: null };

  // The LATEST attempt owns the clock: writing again on the 25th day restarts their 30, because it
  // is a fresh request and §391.23(g)(1) runs from receipt of the request they are answering.
  const latest = mine.map((a) => a.contactedOn).sort().at(-1)!;
  const theirDeadline = addDays(latest, EMPLOYER_RESPONSE_DAYS);

  if (mine.every((a) => a.outcome === "undeliverable")) {
    return { ...base, state: "undeliverable", theirDeadline: null };
  }
  return { ...base, state: today > theirDeadline ? "overdue" : "awaiting", theirDeadline };
}

export interface DriverInquiryQueue {
  /** Employers who owe an inquiry, inside the §391.23(a)(2) window, with their current state. */
  employers: EmployerInquiryState[];
  /** Those still needing work — `documented` and `answered` are done. */
  outstanding: EmployerInquiryState[];
  /** §391.23(c)(1): 30 days from the hire date. Null for somebody not yet hired. */
  fileDeadline: string | null;
  /** Negative once the deadline has passed. Null when there is no deadline yet. */
  daysToDeadline: number | null;
  /** Every owed employer has answered or been documented. */
  complete: boolean;
}

/**
 * One driver's §391.23 position.
 *
 * ── THE WINDOW IS MEASURED FROM THE APPLICATION, NOT FROM TODAY ────────────────────────────────
 * §391.23(a)(2) reaches the three years preceding — and `employmentCoverage` measures from the hire
 * date when there is one, for the reason its own header gives: measuring a five-year employee
 * against today would manufacture obligations nobody ever had. Same rule here, same argument.
 *
 * ── AND THE DEADLINE ONLY EXISTS ONCE SOMEBODY IS HIRED ────────────────────────────────────────
 * §391.23(c)(1) counts from "the date the driver's employment begins". An applicant has no such
 * date, so they have no deadline — inventing one from their application date would put a red number
 * on a file nobody is yet late for.
 */
export function driverInquiryQueue(input: {
  employment: readonly QueueEmployment[];
  attempts: readonly QueueAttempt[];
  /** Null for an applicant. */
  hireDate: string | null;
  today: string;
}): DriverInquiryQueue {
  const asOf = input.hireDate ?? input.today;
  const windowStart = yearsBefore(asOf, EMPLOYMENT_WINDOW_YEARS);

  const owed = input.employment.filter(
    (e) => e.dotRegulated && (e.endedOn ?? asOf) >= windowStart && e.startedOn <= asOf,
  );
  const employers = owed.map((e) => employerInquiryState(e, input.attempts, input.today));
  const outstanding = employers.filter((e) => OPEN_STATES.has(e.state));

  const fileDeadline = input.hireDate ? addDays(input.hireDate, INVESTIGATION_FILE_DAYS) : null;
  return {
    employers,
    outstanding,
    fileDeadline,
    daysToDeadline: fileDeadline ? daysBetween(input.today, fileDeadline) : null,
    complete: outstanding.length === 0,
  };
}

/**
 * How a queue should be ordered: the file closest to its §391.23(c)(1) deadline first, and a driver
 * with no deadline yet after everyone who has one.
 *
 * An applicant is not less important — they are simply not late, and a list that interleaved them by
 * name would bury the file that is actually running out of days.
 */
export const compareInquiryUrgency = (
  a: Pick<DriverInquiryQueue, "daysToDeadline">,
  b: Pick<DriverInquiryQueue, "daysToDeadline">,
): number => {
  if (a.daysToDeadline === null && b.daysToDeadline === null) return 0;
  if (a.daysToDeadline === null) return 1;
  if (b.daysToDeadline === null) return -1;
  return a.daysToDeadline - b.daysToDeadline;
};
