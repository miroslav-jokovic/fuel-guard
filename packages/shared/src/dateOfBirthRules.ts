import { APPLICANT_ISSUE_TEXT } from "./applicantIssues.js";

type BirthDateProblem = "birth_date_not_real" | "birth_date_future" | "birth_date_under_18" | "birth_date_over_120";

/**
 * Date of birth — a `date` column with three rules `isoDateSchema` deliberately does not have.
 *
 * WHY THIS IS NOT JUST ANOTHER DATE (PSP-PLAN.md P0, D-PSP1's neighbourhood). DOB is the input that
 * gates every driver-screening integration we are building: FMCSA PSP makes it mandatory and matches
 * it EXACTLY against MCMIS (guide v3.9 §5.4.1, §8.1), a SambaSafety MVR needs it, and a §382.701
 * Clearinghouse query needs it. And PSP **charges the transaction fee on a `Failure` response**
 * (§8) — so a DOB typed as 2025 instead of 1925 is not a validation annoyance, it is an invoice for
 * a lookup that could never have matched. Catching it at the door is the cheapest place.
 *
 * The three rules, each with a source:
 *   • a REAL calendar date — `isoDateSchema`'s regex accepts `2026-02-31`, which Postgres then
 *     rejects with a 500. Fine for an expiry nobody screens on; not fine for a match key.
 *   • not in the future, and at least 18 years ago — PSP Error 27: *"Driver must be at least 18
 *     years of age."* 18 and not 21 on purpose: 21 is §391.11(b)(1)'s interstate rule and belongs to
 *     the qualification gate, which judges fitness to drive. This schema only judges whether the
 *     value can be a date of birth at all, so it takes the vendor's floor rather than inventing one.
 *   • not more than 120 years ago — the transposed-century typo, which is the common one.
 *
 * `dateOfBirthIssue` is exported separately and takes `today` as an argument so the rule is testable
 * without freezing a clock; the schema is the one place that reads the wall clock.
 */
export function dateOfBirthIssue(value: string, today: string): string | null {
  const problem = dateOfBirthProblem(value, today);
  return problem === null ? null : problem === "shape" ? "Expected a date as YYYY-MM-DD" : APPLICANT_ISSUE_TEXT[problem]();
}

/**
 * The same rule as a key (U7): the applicant's page says it in its own language. `shape` is the one answer
 * with no applicant sentence — the form's date control never produces it (`dateOfBirthIssue`'s caller
 * below stays silent on it, for the reason given there).
 */
export function dateOfBirthProblem(value: string, today: string): BirthDateProblem | "shape" | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const todayParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!parts || !todayParts) return "shape";
  const y = Number(parts[1]), m = Number(parts[2]), d = Number(parts[3]);
  // Round-trip through UTC: `Date.UTC(2026, 1, 31)` normalises to March 3, so a component that comes
  // back different is a day that does not exist. Local-time construction would shift by a timezone.
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) {
    return "birth_date_not_real";
  }
  const ty = Number(todayParts[1]), tm = Number(todayParts[2]), td = Number(todayParts[3]);
  // Whole years elapsed, birthday-aware — never a millisecond division, which gets leap years wrong.
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  if (age < 0) return "birth_date_future";
  if (age < 18) return "birth_date_under_18";
  if (age > 120) return "birth_date_over_120";
  return null;
}
