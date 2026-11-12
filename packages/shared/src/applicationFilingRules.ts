import type { DriverApplicationFields } from "./applicationContract.js";
import { employmentSegments, type ApplicationEmployer } from "./applicationEmployerContract.js";
import { addressCoverage } from "./addressCoverage.js";
import { employmentCoverage, type EmploymentGap, type EmploymentPeriod } from "./employmentCoverage.js";
import { formatDisplayDate, formatDisplayMonth } from "./displayDate.js";

/**
 * What a v2 filing must carry that the base contract leaves optional (AW1, D-AW13, plan §4).
 *
 * ── WHY A LIST OF ISSUES AND NOT A STRICTER SCHEMA ────────────────────────────────────────────
 * §391.21(b)(10) says "shall" for the employer's address, the reason for leaving, and the two
 * (iv) questions, and the base schema has them `.nullish()`. They cannot be made required THERE:
 * `driver_applications` is append-only, and every payload filed before this must go on parsing — the
 * §390.32(d) reproducibility the renderer exists for. So they become required for NEW filings only,
 * by a rule the filing and the applicant's screen both run, and a legacy invitation (no
 * `application_intakes` row — plan §7's legacy rule) is never asked.
 *
 * The rules return issues rather than throwing so the applicant's screen can name each field, the
 * same shape `APPLICATION_CROSS_FIELD_RULES` has for the same reason (A3: one validator, the
 * server's own, run in both places).
 *
 * ⚠ §40.25(j) is NOT here. D-AW13 moved it into Part 1, where `record_applicant_intake` refuses to
 * store an intake without it (AI009); asking again at certification would be a second writer of one
 * answer.
 */

export interface ApplicationFilingIssue {
  /** A dotted path — `employers.2.reason_for_leaving`, `addresses`, `employment_gaps.2023-09-26` (the gap's start). */
  path: string;
  message: string;
}

const blank = (v: string | null | undefined): boolean => !v || v.trim() === "";

/** The draft's employers as the coverage arithmetic reads them — dates and CMV only. */
const asPeriod = (e: ApplicationEmployer, i: number): EmploymentPeriod => ({
  id: e.key ?? String(i),
  employerName: e.employer_name,
  startedOn: e.started_on,
  endedOn: e.ended_on ?? null,
  // F1 part 2: unanswered is not Yes. The gap arithmetic runs on a draft, where a job may not be answered yet.
  dotRegulated: e.dot_regulated === true,
  operatedCmv: e.operated_cmv === true,
  inquiryStatus: "not_required",
});

/**
 * The (b)(10) gaps an application must explain — over 30 days (`GAP_TOLERANCE_DAYS`, Q-AW22), in the
 * three years before `asOf`. Exported so the applicant's screen shows one box per gap THIS returns:
 * the boxes and the refusal below are the same list, never two computations of it (C3c1).
 */
export function applicationEmploymentGaps(
  employers: readonly ApplicationEmployer[],
  asOf: string,
): EmploymentGap[] {
  return employmentCoverage(employers.map(asPeriod), asOf).segmentA.gaps;
}

/** Is this computed gap inside one explanation the applicant gave? */
const explained = (gap: EmploymentGap, given: DriverApplicationFields["employment_gaps"]): boolean =>
  (given ?? []).some((g) => g.from <= gap.from && g.to >= gap.to && g.explanation.trim() !== "");

/**
 * Every reason this application may not be filed under v2's rules — empty when it may.
 *
 * `asOf` is the application's date (the carrier's calendar day), passed in for the reason
 * `employmentCoverage` states: a rule that read a clock would judge a draft against a day nobody
 * chose.
 */
export function applicationV2FilingIssues(
  application: Pick<DriverApplicationFields, "employers" | "employment_gaps" | "addresses">,
  asOf: string,
): ApplicationFilingIssue[] {
  const issues: ApplicationFilingIssue[] = [];
  const employers = application.employers ?? [];

  employers.forEach((e, i) => {
    const at = (field: string) => `employers.${i}.${field}`;
    // D-AW8: the phone verification is keyed on it, and a filing without it strands every call.
    if (!e.key) issues.push({ path: at("key"), message: "Open this employer and save it again" });
    // (b)(10)(i) "name and address" and (b)(11)'s "names and addresses" — every listed employer.
    if (blank(e.address_line1) || blank(e.city) || blank(e.state)) {
      issues.push({ path: at("address_line1"), message: "Give this employer's street, city and state" });
    }
    // (b)(10)(iii) and (b)(11): "the reason for leaving such employment".
    if (blank(e.reason_for_leaving)) {
      issues.push({ path: at("reason_for_leaving"), message: "Say why you left this job" });
    }
    // (b)(10)(iv)(A)/(B) are (b)(10)'s alone — the three years, not the seven before them.
    if (employmentSegments(e, asOf).includes("b10")) {
      if (e.subject_to_fmcsr == null) {
        // Plain words since C3c2b: this sentence lands under the driver's own Yes/No, and "FMCSRs" is
        // the regulation's abbreviation, not theirs.
        issues.push({ path: at("subject_to_fmcsr"), message: "Say whether the Federal Motor Carrier Safety Regulations applied to you in this job" });
      }
      if (e.safety_sensitive == null) {
        issues.push({ path: at("safety_sensitive"), message: "Say whether this job was subject to DOT drug and alcohol testing" });
      }
    }
  });

  /**
   * (b)(3): "The addresses at which the applicant has resided during the 3 years preceding" (C3c1). The
   * base contract asks for one address and nothing checked the three years (plan §4), so this is the
   * rule, for new filings only, for the reason the employer fields are.
   */
  for (const gap of addressCoverage(application.addresses ?? [], asOf).gaps) {
    issues.push({
      path: "addresses",
      message: gap.from === gap.to
        ? `Tell us where you lived in ${formatDisplayMonth(gap.from)}`
        : `Tell us where you lived from ${formatDisplayMonth(gap.from)} to ${formatDisplayMonth(gap.to)}`,
    });
  }

  for (const gap of applicationEmploymentGaps(employers, asOf)) {
    if (!explained(gap, application.employment_gaps)) {
      issues.push({
        // Keyed on the gap's own start date, not an index: the gaps are computed, not a list anybody
        // typed, and the applicant's screen keys each explanation box the same way (C3c1).
        path: `employment_gaps.${gap.from}`,
        message: `Tell us what you were doing from ${formatDisplayDate(gap.from)} to ${formatDisplayDate(gap.to)}`,
      });
    }
  }
  return issues;
}

/**
 * What a LEGACY link (no Part 1) may not be filed without, beyond the contract (F1 part 2, 2026-11-10).
 *
 * §40.25(j)'s two-year question. A v2 link asks it in Part 1, which refuses to store an intake without
 * it (AI009), so this is the legacy link's alone. Not a contract rule: the field is nullish because every
 * application filed before P8 has no answer and must go on parsing — but a NEW filing must answer it.
 * It was an unticked box until F1 part 2, so a driver who skipped it had said No (audit finding 13).
 */
export const PRIOR_TEST_UNANSWERED =
  "Say whether, in the last two years, you tested positive or refused a test for a driving job you applied for";

export function applicationLegacyFilingIssues(
  application: Pick<DriverApplicationFields, "prior_failed_pre_employment_test">,
): ApplicationFilingIssue[] {
  return typeof application.prior_failed_pre_employment_test === "boolean"
    ? []
    : [{ path: "prior_failed_pre_employment_test", message: PRIOR_TEST_UNANSWERED }];
}

/**
 * What EVERY new filing must carry because the carrier's paper asks it (F2c, owner 2026-11-11: "the paper
 * application is our guidance and the form must match it"), on a v2 link and a legacy one alike.
 *
 * Not the contract, for `applicationV2FilingIssues`'s reason: each is nullish there because applications
 * filed before F2c lack them and must go on parsing.
 * - Page 2's question B, "Has any license, permit or privilege ever been suspended or revoked?", asked
 *   apart from A (denied) since F2c (P4).
 * - Page 2's conviction grid: `STATE OF VIOLATION` and `PENALTY` are columns of every row (P10). They were
 *   optional on the form, so a conviction printed with two empty cells.
 */
// US spelling, as the question it answers (Q-AM6, and the carrier's own page 2).
export const SUSPENSION_UNANSWERED = "Say whether a license, permit or privilege of yours has ever been suspended or revoked";

export function applicationPaperFilingIssues(
  application: Pick<DriverApplicationFields, "licence_suspended" | "violations" | "declares_no_violations">,
): ApplicationFilingIssue[] {
  const issues: ApplicationFilingIssue[] = [];
  if (typeof application.licence_suspended !== "boolean") {
    issues.push({ path: "licence_suspended", message: SUSPENSION_UNANSWERED });
  }
  if (!application.declares_no_violations) {
    (application.violations ?? []).forEach((v, i) => {
      if (blank(v.state)) issues.push({ path: `violations.${i}.state`, message: "Give the state where it happened" });
      if (blank(v.penalty)) issues.push({ path: `violations.${i}.penalty`, message: "Give the penalty — a fine, points, a suspension" });
    });
  }
  return issues;
}

/**
 * Page 21, the seven-day work statement (Q-AM4, owner 2026-11-11): asked at SIGNING, so judged only
 * there and at filing — never at the form's hand-off to the office, which comes before it is asked.
 * Zeros are an answer ("most of the time … all zeros"); an empty one is not. Every new filing, v2 or
 * legacy; a filing from before Q-AM4 is never re-judged (`driver_applications` is append-only).
 */
export function sevenDayStatementIssues(
  application: Pick<DriverApplicationFields, "seven_day_hours" | "last_relieved_at">,
): ApplicationFilingIssue[] {
  const issues: ApplicationFilingIssue[] = [];
  if (!Array.isArray(application.seven_day_hours) || application.seven_day_hours.length !== 7) {
    issues.push({ path: "seven_day_hours", message: "Give your hours on duty for each of the last seven days — 0 for a day you did not work" });
  }
  if (blank(application.last_relieved_at)) {
    issues.push({ path: "last_relieved_at", message: "Give the date and time you were last off duty" });
  }
  return issues;
}
