import {
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
  employmentCoverage,
  employmentSegments,
  type EmploymentPeriod,
} from "@silvicom/shared";
import type { DraftEmployer } from "./draft";

/**
 * How much of the ten years the driver has accounted for, said to the driver (X5).
 *
 * ── WHY NONE OF THE ARITHMETIC IS HERE ────────────────────────────────────────────────────────
 * `employmentCoverage` in `packages/shared` already computes it, and it computes the thing that is
 * easy to get wrong: §391.21(b)(10) is **three years of all employment, where a hole is meaningful**,
 * and (b)(11) is **the seven years before that, commercial driving only, where a hole is not**. A
 * driver who spent year five in a warehouse owes no explanation, and a second implementation here
 * would eventually report one — the file's own header says its first version made exactly that
 * mistake. This module converts and phrases; it decides nothing.
 *
 * ── AND WHY A GAP IS SHOWN TO THE APPLICANT AT ALL ────────────────────────────────────────────
 * Because the recruiter is going to ask about it, and the cheapest moment to answer is while the
 * driver is still holding the form. ⚠ The wording is careful for a reason: this form has no way to
 * record "I was not working then", so telling somebody to *explain* a gap would point them at a box
 * that does not exist. It says what is not covered and what happens next, which is true and is
 * something they can act on.
 */

export interface EmploymentProgress {
  /** Nothing entered and nothing declared — a different state from "entered and incomplete". */
  empty: boolean;
  /** Days of the three-year window accounted for, and the size of that window. */
  coveredDays: number;
  windowDays: number;
  /** 0–100, for the meter. Clamped, because two concurrent jobs must not read as 140%. */
  percent: number;
  /** Plain-language periods with nothing in them. Segment A only — see the header. */
  gaps: Array<{ from: string; to: string; months: number }>;
  /** How many of the entered jobs the regulation actually asked for, by window. */
  b10: number;
  b11: number;
}


/** "March 2022". Formatted in UTC so a test in any timezone reads the same month. */
export function monthName(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A draft row as the shared calculator needs it.
 *
 * ⚠ `inquiryStatus` is `not_required` for every row and that is not a placeholder. The applicant's
 * screen has nothing to do with §391.23 inquiries — those are the carrier's act, days later, against
 * rows that do not exist yet. Passing anything else would make `inquiriesOutstanding` non-empty on a
 * form nobody has sent.
 */
const asPeriod = (e: DraftEmployer, i: number): EmploymentPeriod => ({
  id: String(i),
  employerName: e.employer_name.trim(),
  startedOn: e.started_on,
  endedOn: e.ended_on.trim() === "" ? null : e.ended_on,
  dotRegulated: e.dot_regulated,
  operatedCmv: e.operated_cmv,
  inquiryStatus: "not_required",
});

/** Only rows with enough of a period to place on a timeline; a half-typed date is not a claim. */
const datedEnough = (e: DraftEmployer): boolean =>
  e.employer_name.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(e.started_on);

export function employmentProgress(
  employers: readonly DraftEmployer[],
  asOf: string,
): EmploymentProgress {
  const usable = employers.filter(datedEnough);
  const coverage = employmentCoverage(usable.map(asPeriod), asOf);
  const { segmentA } = coverage;

  let b10 = 0;
  let b11 = 0;
  for (const e of usable) {
    const segments = employmentSegments(
      { started_on: e.started_on, ended_on: e.ended_on.trim() === "" ? null : e.ended_on, operated_cmv: e.operated_cmv },
      asOf,
    );
    if (segments.includes("b10")) b10 += 1;
    if (segments.includes("b11")) b11 += 1;
  }

  return {
    empty: usable.length === 0,
    coveredDays: segmentA.coveredDays,
    windowDays: segmentA.windowDays,
    // Clamped: overlapping jobs are merged by the calculator, but a row running past `asOf` can
    // still push the total over, and a meter reading 118% is a meter nobody trusts again.
    percent: segmentA.windowDays === 0 ? 0 : Math.min(100, Math.round((segmentA.coveredDays / segmentA.windowDays) * 100)),
    /**
     * ⚠ Suppressed entirely when nothing has been entered, and that is a UI decision rather than an
     * arithmetic one. With no rows at all `employmentCoverage` correctly reports the whole three-year
     * window as one gap — and rendering it would greet a driver who has typed nothing with "September
     * 2023 to September 2026 is not covered. If you were working then, add that job", which reads as
     * an accusation about a form they have not started. The empty state says the same thing kindly.
     */
    gaps: usable.length === 0 ? [] : segmentA.gaps.map((g) => ({
      from: monthName(g.from),
      to: monthName(g.to),
      months: Math.max(1, Math.round(g.days / 30.44)),
    })),
    b10,
    b11,
  };
}

export { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS };
