import { questionnaireForApplicant, sectionOwningPath, type QuestionnaireQuestion } from "@silvicom/shared";
import type { TableColumn } from "./applicantFactRows";

/**
 * One row of a table answer as the office reads it: each answered column with its label —
 * "Full name: Ann Lee · Years known: 5" — so a reference is not three bare values in a row.
 */
export function tableRowText(columns: readonly TableColumn[], value: unknown): string {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const parts = columns
    .map((c) => {
      const v = row[c.id];
      if (c.input === "yesno") return v === true ? `${c.label}: Yes` : null;
      return v === null || v === undefined || String(v).trim() === "" ? null : `${c.label}: ${String(v).trim()}`;
    })
    .filter((p): p is string => p !== null);
  return parts.length === 0 ? "Not answered" : parts.join(" · ");
}

/**
 * The carrier questions answered as a table that a row may be added to, in this card section: each
 * with how many rows the driver gave, and only while under the question's own limit (`maxRows`; the
 * API refuses past it too). From the questionnaire, never a list of ids.
 */
export function addableTables(
  payload: Record<string, unknown> | null | undefined,
  section: string,
): Array<{ question: QuestionnaireQuestion; count: number }> {
  const answers = (payload?.questionnaire ?? {}) as Record<string, unknown>;
  return questionnaireForApplicant().questions
    .filter((q) => q.kind === "table" && (sectionOwningPath(["questionnaire_answers", q.id]) ?? "questions") === section)
    .map((q) => ({ question: q, count: Array.isArray(answers[q.id]) ? (answers[q.id] as unknown[]).length : 0 }))
    .filter((t) => t.count < (t.question.maxRows ?? Infinity));
}
