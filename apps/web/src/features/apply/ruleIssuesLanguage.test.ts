import { afterEach, describe, expect, it } from "vitest";
import { APPLICANT_ISSUE_TEXT, applicantIssue, type ApplicantIssueKey } from "@silvicom/shared";
import { setApplyLanguage } from "./language";
import { messageFor } from "./fieldLabels";
import { v2FilingIssues } from "./useApplicationWizard";
import { checkEmployer } from "./employerCheck";
import { emptyDraft, emptyEmployer } from "./draftShape";
import { APPLY_COPY } from "./strings";

/**
 * U7 (APPLICATION-FIX-PLAN §4): a shared rule's sentence is said in the page's language. Before, the
 * Spanish page passed every rule's English through untouched — the F2c and page-21 refusals among them.
 */
afterEach(() => setApplyLanguage("en"));

const SAMPLE: Partial<Record<ApplicantIssueKey, Record<string, string>>> = {
  question_answered: { question: "Q" },
  address_gap_month: { month: "01/2025" },
  address_gap: { from: "01/2025", to: "03/2025" },
  employment_gap: { from: "01/01/2025", to: "03/01/2025" },
  license_expiration: { state: "OH" },
};

describe("a shared rule's sentence in the page's language", () => {
  it("has a Spanish sentence for every key, and none of them is the English", () => {
    setApplyLanguage("es");
    for (const key of Object.keys(APPLICANT_ISSUE_TEXT) as ApplicantIssueKey[]) {
      const english = (APPLICANT_ISSUE_TEXT[key] as (p?: unknown) => string)(SAMPLE[key]);
      const spanish = (APPLY_COPY.ruleIssues[key] as (p?: unknown) => string)(SAMPLE[key]);
      expect(spanish, key).not.toBe(english);
      // A param reaches the sentence it was given to.
      for (const v of Object.values(SAMPLE[key] ?? {})) expect(spanish, key).toContain(v);
    }
  });

  it("renders a keyed issue by its key, in English and in Spanish", () => {
    const issue = { code: "custom", ...applicantIssue("suspension_answered"), path: ["licence_suspended"] };
    expect(messageFor(issue, undefined)).toBe(APPLICANT_ISSUE_TEXT.suspension_answered());
    setApplyLanguage("es");
    expect(messageFor(issue, undefined)).toMatch(/suspendieron o revocaron/);
  });

  it("⚠ the F2c refusals on the page are Spanish on the Spanish page", () => {
    setApplyLanguage("es");
    const draft = { ...emptyDraft(), licence_suspended: null, declares_no_violations: false,
      violations: [{ key: "00000000-0000-4000-8000-000000000001", occurred_on: "2025-01-01", offence: "Exceso de velocidad", state: "", penalty: "" }] };
    const says = v2FilingIssues(draft, null).map((i) => i.say);
    expect(says).toContain(APPLY_COPY.ruleIssues.suspension_answered());
    expect(says).toContain("Indique el estado donde ocurrió");
    expect(says.some((s) => /^(Say|Give|Tell)\b/.test(s))).toBe(false);
  });

  it("the job form's own rules are Spanish too (`employerProblems`)", () => {
    setApplyLanguage("es");
    const job = { ...emptyEmployer(), employer_name: "Acme", started_on: "2024-01-01", ended_on: "2024-06-01" };
    const says = checkEmployer(job, 0, null).map((i) => i.say);
    expect(says).toContain("Diga si manejó un camión en este trabajo");
    expect(says.some((s) => /^Say\b/.test(s))).toBe(false);
  });
});
