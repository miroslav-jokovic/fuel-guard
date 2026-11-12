import { APPLICANT_ISSUE_TEXT } from "@silvicom/shared";

/**
 * What a shared rule says to the applicant, by key (APPLICATION-FIX-PLAN §4 U7).
 *
 * The English is the shared catalogue itself (`APPLICANT_ISSUE_TEXT`), never a copy of it: the API's
 * refusal and this page say the same sentence because they are the same object. The Spanish twin
 * (`es/strings.es.issues.ts`) is checked key for key by `satisfies`, so a rule added in shared without a
 * Spanish sentence fails `vue-tsc` rather than reaching the Spanish page in English.
 */
export const APPLY_ISSUES_COPY = {
  ruleIssues: APPLICANT_ISSUE_TEXT,
} as const;
