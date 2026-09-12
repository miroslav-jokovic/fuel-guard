import {
  questionnaireByRef,
  readableAnswers,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
import { field, heading, muted, rule } from "../../../lib/pdfDraw.js";
import type { ApplicationPdfInput } from "./render.js";

/**
 * A value, or an em dash — the same rule the rest of this document follows.
 *
 * ⚠ Declared here rather than imported from `render.ts`, for the reason `certificate.ts` gives beside
 * its own copy: this module is imported BY that one, and reaching back for a four-token helper would
 * make the pair circular at runtime. The type import above is erased and does not.
 */
const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "—");
const yesNo = (v: boolean): string => (v ? "Yes" : "No");

/**
 * The carrier's own questions and what the driver answered (A9, D-APP12).
 *
 * ── WHY IT IS RENDERED AT ALL, GIVEN "PROJECTED NOWHERE" ──────────────────────────────────────
 * D-APP12 names three places the answers must not reach: `drivers`, `driver_employment_history`, and
 * the DQF item set. This document is none of them — it is a DERIVATIVE of the very payload the
 * answers live in. And it is the only place a recruiter ever sees them: the staff route serves this
 * PDF and nothing else of the application's content, so a questionnaire left out of it would be a
 * form collected and read by nobody.
 *
 * ── WHY IT IS ITS OWN SECTION, AFTER THE REGULATION'S ─────────────────────────────────────────
 * The pages above are numbered §391.21(b)(1)–(12) so a reader with the CFR open can check them line
 * by line. Carrier questions interleaved among them would break exactly that, and would imply the
 * regulation asks for a driver's personal references. So they come last, under the carrier's name,
 * and the heading says whose questions they are.
 *
 * ⚠ THE RESERVED `eeo` KEY NEVER APPEARS HERE. `readableAnswers` drops it, and a test pins that a
 * payload carrying one renders nothing from it: voluntary self-identification must not reach the
 * person deciding the hire, and this document is what that person reads.
 *
 * ⚠ A definition this build no longer carries renders NOTHING rather than throwing. `payload` is
 * historical jsonb — the same rule `blank()` exists for. Answers without their questions are not
 * worth printing anyway: a bare "true" beside no question is not evidence of anything.
 */
export function questionnaireSection(doc: PDFKit.PDFDocument, input: ApplicationPdfInput): void {
  const definition = questionnaireByRef(input.application.questionnaire_version);
  if (!definition) return;
  const answers = readableAnswers(input.application.questionnaire_answers as Record<string, unknown>);
  if (Object.keys(answers).length === 0) return;

  doc.addPage();
  heading(doc, `${input.carrier.name} — the carrier's own questions`);
  muted(
    doc,
    `Questionnaire ${definition.id} version ${definition.version}. These questions are the carrier's `
    + "and are not part of 49 CFR §391.21.",
  );
  doc.moveDown(0.3);

  for (const question of definition.questions) {
    const value = answers[question.id];
    if (value === undefined || value === null || value === "") continue;
    if (question.kind === "table") {
      questionnaireTable(doc, question, value);
      continue;
    }
    field(doc, question.label, scalarAnswer(value));
  }
}

const scalarAnswer = (value: unknown): string => {
  if (typeof value === "boolean") return yesNo(value);
  return blank(String(value));
};

/** A table answer, one labelled block per row — a five-column grid on a 612pt sheet is unreadable. */
function questionnaireTable(doc: PDFKit.PDFDocument, question: QuestionnaireQuestion, value: unknown): void {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  if (rows.length === 0) return;
  doc.moveDown(0.3);
  heading(doc, question.label);
  for (const row of rows) {
    for (const column of question.columns ?? []) {
      const cell = row[column.id];
      if (cell === undefined || cell === null || cell === "") continue;
      field(doc, column.label, scalarAnswer(cell));
    }
    rule(doc);
  }
}

