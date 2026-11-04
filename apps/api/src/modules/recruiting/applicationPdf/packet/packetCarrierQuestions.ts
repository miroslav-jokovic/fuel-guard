import { rgb, type PDFDocument, type PDFPage } from "pdf-lib";
import { carrierQuestionnaire, carrierStampOf, choiceLabel } from "@silvicom/shared";
import { embedPdfFace, pdfUnicodeText } from "../../../../lib/pdfFonts.js";
import { clipped, fitted, wrap } from "./packetContinuationText.js";
import { TEXT_BLOCK, addFurnishedPage, carrierFurniture } from "./packetContinuationFurniture.js";

/**
 * "The carrier's own questions" — the questions the carrier wrote itself in Settings → Recruiting, and the
 * applicant's answers, on a sheet APPENDED to the carrier's packet (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3).
 *
 * ── ⚠ APPENDED, NEVER INSERTED ───────────────────────────────────────────────────────────────
 * The carrier's paper has no place for questions it wrote after the paper was printed, and a page added
 * among theirs would move every signature after it: their footer number IS the PDF index
 * (`packetContinuation.ts`'s header). So it goes at the back, after the continuation sheet if there is one,
 * dressed in the same letterhead, footer and page sequence (`addFurnishedPage`).
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

const { left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM } = TEXT_BLOCK;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const TITLE_SIZE = 10;
const NOTE_SIZE = 7;
const QUESTION_SIZE = 8.5;
const ANSWER_SIZE = 8.5;
const LINE = 11;
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
  if (questions.length === 0) return 0;
  const answers = input.answers ?? {};

  const font = await embedPdfFace(doc, "regular");
  const bold = await embedPdfFace(doc, "bold");
  const furniture = await carrierFurniture(doc);
  const applicant = pdfUnicodeText(input.applicantName);
  let added = 0;
  let page: PDFPage;
  let y = 0;

  const newPage = (): void => {
    page = addFurnishedPage(doc, furniture, bold);
    added += 1;
    y = TOP;
    page.drawText(added === 1 ? "THE CARRIER'S OWN QUESTIONS" : "THE CARRIER'S OWN QUESTIONS (CONTINUED)", {
      x: LEFT, y, size: TITLE_SIZE, font: bold, color: INK,
    });
    y -= 13;
    const who = `Attached to and part of the application of ${applicant}`.trim();
    const whoSize = fitted(font, who, RIGHT - LEFT, QUESTION_SIZE);
    page.drawText(clipped(font, who, RIGHT - LEFT, whoSize), { x: LEFT, y, size: whoSize, font, color: INK });
    y -= LINE;
    page.drawText("Questions the carrier added to its application, as worded when the application was sent.", {
      x: LEFT, y, size: NOTE_SIZE, font, color: MUTED,
    });
    y -= 20;
  };

  newPage();
  for (const question of questions) {
    const asked = wrap(bold, pdfUnicodeText(question.label), QUESTION_SIZE, RIGHT - LEFT);
    const given = wrap(font, pdfUnicodeText(answerText(question, answers[question.id])), ANSWER_SIZE, RIGHT - LEFT - 12);
    // A question and its answer are never parted across a page.
    if (y - (asked.length + given.length) * LINE - 8 < BOTTOM) newPage();
    for (const line of asked) {
      page!.drawText(line, { x: LEFT, y, size: QUESTION_SIZE, font: bold, color: INK });
      y -= LINE;
    }
    for (const line of given) {
      page!.drawText(line, { x: LEFT + 12, y, size: ANSWER_SIZE, font, color: INK });
      y -= LINE;
    }
    y -= 8;
  }
  return added;
}
