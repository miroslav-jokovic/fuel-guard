import {
  questionnaireByRef,
  readableAnswers,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
import { caption, field, heading, rule, section } from "../../../lib/pdfDraw.js";
import type { ApplicationPdfInput } from "./render.js";

/**
 * What this document says where the applicant said nothing (AUD-22).
 *
 * ⚠ It is the SAME SENTENCE the §391.21 pages print, word for word, and that is the whole point of
 * the constant. `render.ts` says "Not answered." under an empty (b)(3), (b)(7), (b)(8) and (b)(10);
 * a reader who has learnt what that sentence means on page 2 must not meet a different phrasing for
 * the same fact on the last page. Two wordings for one state read as two different states.
 */
const NOT_ANSWERED = "Not answered.";

/**
 * Whether the applicant answered this question at all — and `false` and `0` ARE answers.
 *
 * ⚠ The nullish check is not enough on its own and `payload` is why. It is historical jsonb: the
 * wizard trims every string before it stores one (`draft.ts`'s `cleanQuestionnaire`), so a
 * whitespace-only answer cannot arrive from today's client, but a document filed against an older
 * one must still render, and `"  "` printed through `String()` is a row with an invisible value —
 * which is the defect this predicate exists to remove, not a subtler version of it.
 *
 * ⚠ An empty ARRAY is unanswered for the same reason a missing one is: a grid the applicant added no
 * row to was not filled in. It is written here rather than inside `questionnaireTable` so the caller
 * can decide what to draw before it commits to drawing table furniture.
 */
const unanswered = (value: unknown): boolean =>
  value === undefined
  || value === null
  || (typeof value === "string" && value.trim() === "")
  || (Array.isArray(value) && value.length === 0);

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
 * ── ⚠ EVERY QUESTION IS PRINTED, ANSWERED OR NOT (AUD-22, owner's ruling 2026-09-20) ──────────
 * This loop used to `continue` past any answer that was undefined, null or empty — so a question the
 * applicant left blank was absent from the document, and a recruiter reading it could not tell a
 * question nobody was asked from one somebody declined to answer. The audit raised it as a finding of
 * its own rather than folding it into AUD-11 because the answer was not obvious: NONE of these
 * questions is mandatory (`questionnaireContract.ts` explains at length why there is no `required`
 * flag and why there must not be), so a line per unanswered question is a cost paid on a document
 * that is mostly optional. The ruling is that the fact is worth the line: a recruiter deciding a hire
 * needs to know the applicant would not say whether they may contact previous employers.
 *
 * ⚠ THE RESERVED `eeo` KEY NEVER APPEARS HERE. `readableAnswers` drops it, and a test pins that a
 * payload carrying one renders nothing from it: voluntary self-identification must not reach the
 * person deciding the hire, and this document is what that person reads.
 *
 * ⚠ A definition this build no longer carries renders NOTHING rather than throwing. `payload` is
 * historical jsonb. Answers without their questions are not worth printing anyway: a bare "true"
 * beside no question is not evidence of anything — and after AUD-22 it is the ONLY silence left,
 * because a version we do carry now prints its questions whether or not any of them was answered.
 * That case is reachable and is not hypothetical: `draft.ts` stamps the version only when something
 * was answered, but `cleanQuestionnaire` counts the reserved `eeo` key as something, so an applicant
 * who self-identified and answered nothing else arrives here with a version and no readable answer.
 * The page it gets says every question was unanswered, which is true, and says nothing about the key
 * that was — which is the only other thing that matters about it.
 */
export function questionnaireSection(doc: PDFKit.PDFDocument, input: ApplicationPdfInput): void {
  const definition = questionnaireByRef(input.application.questionnaire_version);
  if (!definition) return;
  const answers = readableAnswers(input.application.questionnaire_answers as Record<string, unknown>);

  doc.addPage();
  heading(doc, `${input.carrier.name} — the carrier's own questions`);
  // ⚠ `caption`, and its hand-written `moveDown(0.3)` went with it: 2.95pt under the line against
  // the 6.96pt of the heading's own air above left this reading as the first question rather than
  // as a note about all of them (AUD-8). One constant for the relationship, in `pdfDraw.ts`.
  caption(
    doc,
    `Questionnaire ${definition.id} version ${definition.version}. These questions are the carrier's `
    + "and are not part of 49 CFR §391.21.",
  );

  for (const question of definition.questions) {
    const value = answers[question.id];
    if (question.kind === "table") {
      questionnaireTable(doc, question, value);
      continue;
    }
    field(doc, question.label, unanswered(value) ? NOT_ANSWERED : scalarAnswer(value));
  }
}

/**
 * One scalar answer as the document prints it.
 *
 * ⚠ THERE IS NO EM DASH HERE AND THERE USED TO BE. This module carried its own `blank()` — the
 * house rule for a value that is missing — and AUD-22 leaves it with nothing to do: a dash under a
 * carrier's question is the absence of an answer wearing the costume of a value, which is the
 * finding itself. `unanswered()` above now catches every empty state and says so in words.
 *
 * ⚠ **Which makes the empty branch below UNREACHABLE, and it is kept deliberately.** Measured
 * 2026-09-20: putting the em dash back in it changes not one coordinate of a rendered page across
 * five payloads, because nothing that reaches here can stringify to nothing — `unanswered()` has
 * already taken the nullish, the whitespace and the empty array. It is a guard against the edit that
 * weakens `unanswered()`, and what it guards against is not a dash but an EMPTY value column: a row
 * with a label and no answer beside it, which no assertion about text could see.
 */
const scalarAnswer = (value: unknown): string => {
  if (typeof value === "boolean") return yesNo(value);
  const text = String(value).trim();
  return text === "" ? NOT_ANSWERED : text;
};

/**
 * A table answer, one labelled block per row — a five-column grid on a 612pt sheet is unreadable.
 *
 * ⚠ AN UNANSWERED GRID GETS A ROW, NOT A HEADING (AUD-22). It returned early on an empty list, so
 * "Education and training" and "Three personal references" vanished from the document exactly as the
 * scalar questions did. What replaces the early return is deliberately NOT this function's heading
 * over a lone sentence: a grid nobody filled in is not a grid, and printing it as a label/value row
 * puts it in the same shape as every other unanswered question on the page — which is what lets a
 * reader see at a glance which of the carrier's questions were answered.
 *
 * ⚠ AND THE CELLS FOLLOW THE SAME RULE, for the reason a second rule would be worse than either: a
 * blank `Phone number` on a reference the applicant DID name is the same ambiguity at column scale,
 * and a document that prints "Not answered." for questions but stays silent for cells would teach a
 * reader that silence is safe to interpret in one place and not in another.
 *
 * ── ⚠ AND THE FIRST ROW TRAVELS WITH THE HEADING (AUD-23, measured 2026-09-20) ────────────────
 * The heading used to be a bare `heading()` call with nothing binding it to the rows under it —
 * AUD-4's defect, in the one family of tables that never got AUD-4's fix. **Measured over 1,148
 * payloads** (education 0–6 rows × references 0–3 × 41 lengths of the free-text answer above them):
 * **27 of them put `Three personal references` alone at the foot of a sheet**, with `Full name` and
 * a stranger's telephone number opening the next one under nothing that says whose they are.
 *
 * ⚠ **It is NOT a defect AUD-22 introduced, and that was measured rather than assumed**: the same
 * sweep against the renderer as it stood at 3d4b298 strands the same heading in the same payloads,
 * because every question in those cases was answered and the rows AUD-22 adds are not drawn. It is
 * fixed here because it is four lines of an existing primitive and because a heading stranded beside
 * the new rows would read as their doing.
 */
function questionnaireTable(doc: PDFKit.PDFDocument, question: QuestionnaireQuestion, value: unknown): void {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  if (rows.length === 0) {
    field(doc, question.label, NOT_ANSWERED);
    return;
  }
  doc.moveDown(0.3);
  // ⚠ `section()` rather than `heading()` plus a loop: it measures the heading and the parts it is
  // given and turns the page BEFORE drawing when they will not fit together (AUD-4). Only the first
  // row is passed — binding the whole grid would refuse to break a six-row education table that no
  // page can hold, and `section()` would then draw it where it stands anyway. One row is what a
  // heading needs to not be alone.
  section(doc, question.label, cellParts(question, rows[0]!));
  rule(doc);
  for (const row of rows.slice(1)) {
    for (const part of cellParts(question, row)) field(doc, part.label, part.value);
    rule(doc);
  }
}

/**
 * One row of a grid as label/value parts — the shape `section()` measures and `field()` draws.
 *
 * ⚠ Narrower than `SectionPart` on purpose: that union's other member is a note, and the caller
 * reads `.label` and `.value` off every part it gets back. The array is still assignable where a
 * `SectionPart[]` is wanted.
 */
const cellParts = (
  question: QuestionnaireQuestion,
  row: Record<string, unknown>,
): { label: string; value: string }[] =>
  (question.columns ?? []).map((column) => ({
    label: column.label,
    value: unanswered(row[column.id]) ? NOT_ANSWERED : scalarAnswer(row[column.id]),
  }));
