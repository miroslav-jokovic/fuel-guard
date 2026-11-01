import { applicationEmployerSchema } from "@silvicom/shared";
import { employerProblems } from "@/components/employment/employerRow";
import { describeField, fieldId, messageFor, valueAt, type FieldPath } from "@/features/apply/fieldLabels";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { toEmployerPayload, type DraftEmployer } from "@/features/apply/draft";

/**
 * One job, judged as the applicant's Save judges it (X5, C3c2b; moved out of `EmployerDrawer.vue` when
 * HW5b replaced that panel with the one employer form).
 *
 * The row schema first — `applicationEmployerSchema`, the server's own — and on a v2 link the filing's
 * rules for this row alone (`employerProblems`, shared with the office). Problems come back in the
 * page's vocabulary: the path is rebased onto the document (`["employers", 2, "city"]`) so the label,
 * the id and the sentence are the SAME ones the page would produce for that box. Two vocabularies for
 * one box is how a form starts contradicting itself.
 */
export function checkEmployer(e: DraftEmployer, index: number, v2AsOf: string | null): SectionIssue[] {
  const rowIssue = (field: FieldPath, message: string, say: string): SectionIssue => {
    const path = ["employers", index, ...field];
    return { path, key: "employers", message, label: describeField(path), say, fieldId: fieldId(path), section: "employment" };
  };
  const candidate = toEmployerPayload(e);
  const parsed = applicationEmployerSchema.safeParse(candidate);
  if (!parsed.success) {
    // The value comes from the ORIGINAL, row-relative path — the rebased one describes a document this
    // check does not hold.
    return parsed.error.issues.map((issue) => {
      const field = issue.path as (string | number)[];
      const say = messageFor({ ...issue, path: ["employers", index, ...field] }, valueAt(candidate, field));
      return rowIssue(field, issue.message, say);
    });
  }
  return employerProblems(e, v2AsOf).map((p) => rowIssue([p.field], p.message, p.message));
}

/** The issues inside job `index`, as the form wants them: field → sentence (the first for each field). */
export function errorsByField(issues: readonly SectionIssue[], index: number): Record<string, string> {
  const prefix = `${fieldId(["employers", index])}-`;
  const out: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue.fieldId.startsWith(prefix)) continue;
    const field = issue.fieldId.slice(prefix.length);
    out[field] ??= issue.say;
  }
  return out;
}
