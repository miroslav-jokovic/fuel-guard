import type { PDFDocument } from "pdf-lib";
import { carrierQuestionnaire, carrierStampOf, choiceLabel } from "@silvicom/shared";
import { appendAnswerSheet } from "./packetAnswerSheet.js";

/**
 * "The carrier's own questions" — the questions the carrier wrote itself in Settings → Recruiting, and the
 * applicant's answers, on a sheet APPENDED to the carrier's packet (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3).
 *
 * ── ⚠ APPENDED, NEVER INSERTED ───────────────────────────────────────────────────────────────
 * The carrier's paper has no place for questions it wrote after the paper was printed, and a page added
 * among theirs would move every signature after it: their footer number IS the PDF index
 * (`packetContinuation.ts`'s header). So it goes at the back, after the continuation sheet if there is one,
 * dressed in the same letterhead, footer and page sequence, in the layout it shares with F2's addendum
 * (`packetAnswerSheet.ts`).
 *
 * ── WHOSE WORDS, AND WHICH ───────────────────────────────────────────────────────────────────
 * The STAMP's — the wording this applicant was asked when the office first sent the form (D-CQ2), never
 * the carrier's list today, so a question retired since still prints beside its answer. Every stamped
 * question prints, an unanswered one as "Not answered." (the §391.21 summary's AUD-22 sentence); a skip
 * prints as the words the applicant chose.
 *
 * ⚠ No signature line, for the continuation sheet's reason: the driver's stops are a measurement of the
 * carrier's paper (`driverPlacements()`), and a line here would make the count vary per applicant. The
 * certification covers the document.
 */

/** The summary's sentence for a question left blank, word for word (`questionnairePage.ts`, AUD-22). */
const NOT_ANSWERED = "Not answered.";

export interface CarrierQuestionsSheetInput {
  /** The stamp as stored — read through `carrierStampOf`, so a malformed one appends nothing. */
  stamp: unknown;
  /** `carrier_answers`, the same key in a draft and a filed payload. */
  answers: Record<string, unknown> | null | undefined;
  /** The applicant, so a sheet separated from the packet can be put back with it. */
  applicantName: string;
}

const answered = (v: unknown): boolean =>
  v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/** One answer as the sheet prints it: yes/no in words, a choice by its own words, nothing as the sentence. */
function answerText(question: ReturnType<typeof carrierQuestionnaire>["questions"][number], raw: unknown): string {
  if (!answered(raw)) return NOT_ANSWERED;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(choiceLabel(question, raw)).trim();
}

/** Appends the sheet when the stamp holds any question; returns how many sheets it added. */
export async function appendCarrierQuestionsSheet(doc: PDFDocument, input: CarrierQuestionsSheetInput): Promise<number> {
  const questions = carrierQuestionnaire(carrierStampOf(input.stamp)).questions;
  const answers = input.answers ?? {};
  return appendAnswerSheet(doc, {
    title: "THE CARRIER'S OWN QUESTIONS",
    note: "Questions the carrier added to its application, as worded when the application was sent.",
    applicantName: input.applicantName,
    sections: [{ entries: questions.map((q) => ({ question: q.label, answer: answerText(q, answers[q.id]) })) }],
  });
}
