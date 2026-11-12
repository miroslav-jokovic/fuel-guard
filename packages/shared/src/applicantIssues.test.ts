import { describe, expect, it } from "vitest";
import { APPLICANT_ISSUE_TEXT, applicantIssue, isApplicantIssueKey, issueKeyOf } from "./applicantIssues.js";
import { APPLICATION_CROSS_FIELD_RULES } from "./applicationRules.js";
import { driverApplicationSchema } from "./applicationContract.js";
import { applicationEmployerSchema, unansweredEmployerQuestions } from "./applicationEmployerContract.js";
import { applicationPaperFilingIssues, sevenDayStatementIssues } from "./applicationFilingRules.js";
import { requiredDateOfBirthSchema } from "./rosterContract.js";

/**
 * U7 (APPLICATION-FIX-PLAN §4): every sentence a shared rule says to an applicant carries a key, so the
 * Spanish page can say it in Spanish. The failure this guards against is silent — a rule added with only
 * an English `message` still works, in English, on the Spanish page.
 */
const COMPLETE = {
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01", email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01", experience: "Eight years, dry van.",
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, licence_suspended: false, employers: [], declares_no_employment: true,
  questionnaire_version: "silvicom_driver@v3",
  questionnaire_answers: {
    position: "Company driver", applying_as: "company_driver", heard_from: "A friend",
    legally_work: true, proof_of_age: true, may_contact_employers: true,
    education: [{ school: "Joliet High", years_completed: 4, graduated: true }],
  },
  certified: true as const, signed_name: "Susan Godfrey",
};

describe("every shared rule an applicant can meet is keyed", () => {
  it("each cross-field rule names a key, and its message is that key's English", () => {
    for (const rule of APPLICATION_CROSS_FIELD_RULES) {
      expect(isApplicantIssueKey(rule.issueKey), rule.path).toBe(true);
      const text = APPLICANT_ISSUE_TEXT[rule.issueKey] as (p?: unknown) => string;
      expect(rule.message, rule.path).toBe(text(rule.params));
    }
  });

  it("a cross-field rule's key survives the whole contract's parse, in the issue's params", () => {
    // Otherwise complete, so the refinements run; only the accidents rule fails.
    const parsed = driverApplicationSchema.safeParse({ ...COMPLETE, accidents: [], declares_no_accidents: false });
    expect(parsed.success).toBe(false);
    const accidents = parsed.error!.issues.find((i) => i.path[0] === "accidents" && i.code === "custom")!;
    expect(issueKeyOf(accidents)).toEqual({ issueKey: "accidents_listed" });
  });

  it("the refinements carry theirs too: a job ending before it starts, a birth date in the future", () => {
    const job = applicationEmployerSchema.safeParse({ employer_name: "A", started_on: "2024-05-01", ended_on: "2024-01-01" });
    expect(issueKeyOf(job.error!.issues.find((i) => i.code === "custom")!)).toEqual({ issueKey: "job_ends_before_start" });
    const dob = requiredDateOfBirthSchema.safeParse("2999-01-01");
    expect(issueKeyOf(dob.error!.issues.find((i) => i.code === "custom")!)).toEqual({ issueKey: "birth_date_future" });
  });

  it("the filing rules and the job questions return keys", () => {
    const keys = [
      ...applicationPaperFilingIssues({ violations: [{ occurred_on: "2025-01-01", offence: "Speeding" }], declares_no_violations: false }),
      ...sevenDayStatementIssues({}),
      ...unansweredEmployerQuestions([{}]),
    ].map((i) => i.issueKey);
    expect(keys).toEqual([
      "suspension_answered", "violation_state", "violation_penalty", "seven_day_hours", "last_relieved_at",
      "job_drove_truck", "job_dot_regulated",
    ]);
  });

  it("carries a key's params with it, and the English built from them", () => {
    expect(applicantIssue("employment_gap", { from: "01/01/2025", to: "03/01/2025" })).toEqual({
      message: "Tell us what you were doing from 01/01/2025 to 03/01/2025",
      issueKey: "employment_gap",
      params: { from: "01/01/2025", to: "03/01/2025" },
    });
  });

  it("reads no key from an issue that has none — a schema's own shape message stays unkeyed", () => {
    expect(issueKeyOf({})).toBeNull();
    expect(issueKeyOf({ params: { issueKey: "not_a_key" } })).toBeNull();
  });
});
