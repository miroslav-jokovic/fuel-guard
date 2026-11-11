import { rgb, type PDFDocument, type PDFPage } from "pdf-lib";
import { embedPdfFace, pdfUnicodeText } from "../../../../lib/pdfFonts.js";
import { clipped, fitted, wrap } from "./packetContinuationText.js";
import { TEXT_BLOCK, addFurnishedPage, carrierFurniture } from "./packetContinuationFurniture.js";

/**
 * A sheet of questions and answers APPENDED to the carrier's packet — the one layout two sheets share:
 * the carrier's own questions (§15.3, `packetCarrierQuestions.ts`) and the addendum of answers the
 * carrier's paper has no place for (APPLICATION-FIX-PLAN F2, `packetAddendum.ts`).
 *
 * ── ⚠ APPENDED, NEVER INSERTED ───────────────────────────────────────────────────────────────
 * The carrier's footer number IS the PDF index (`packetContinuation.ts`'s header), so a page added among
 * theirs would move every signature after it. Both sheets go at the back, dressed in the same letterhead,
 * footer and page sequence (`addFurnishedPage`).
 *
 * ── ONE LAYOUT, BECAUSE TWO WOULD DRIFT ──────────────────────────────────────────────────────
 * The carrier's-questions sheet drew this layout inline before F2. A second sheet copying it would be two
 * definitions of "a question and its answer on an appended page", and the first fix made to one (a question
 * parted from its answer across a page, say) would miss the other.
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
const SECTION_SIZE = 9.5;
const QUESTION_SIZE = 8.5;
const ANSWER_SIZE = 8.5;
const LINE = 11;
const INDENT = 12;

/** One question and the applicant's answer, printed as the answer's own words. */
export interface AnswerSheetEntry {
  question: string;
  answer: string;
}

/** A run of entries under one heading — an employer, say. A sheet of one untitled section has no heading. */
export interface AnswerSheetSection {
  heading?: string;
  entries: readonly AnswerSheetEntry[];
}

export interface AnswerSheetInput {
  /** The sheet's title, in capitals as the carrier's own headings are. "(CONTINUED)" is added on a second page. */
  title: string;
  /** One muted line under the applicant's name: what this sheet is. */
  note: string;
  /** The applicant, so a sheet separated from the packet can be put back with it. */
  applicantName: string;
  sections: readonly AnswerSheetSection[];
}

/** Appends the sheet when any section holds an entry; returns how many pages it added. */
export async function appendAnswerSheet(doc: PDFDocument, input: AnswerSheetInput): Promise<number> {
  const sections = input.sections.filter((s) => s.entries.length > 0);
  if (sections.length === 0) return 0;

  const font = await embedPdfFace(doc, "regular");
  const bold = await embedPdfFace(doc, "bold");
  const furniture = await carrierFurniture(doc);
  const applicant = pdfUnicodeText(input.applicantName);
  let added = 0;
  let page: PDFPage;
  let y = 0;
  /** Nothing drawn on this page yet below its title. */
  let fresh = true;

  const newPage = (): void => {
    page = addFurnishedPage(doc, furniture, bold);
    added += 1;
    y = TOP;
    page.drawText(added === 1 ? input.title : `${input.title} (CONTINUED)`, {
      x: LEFT, y, size: TITLE_SIZE, font: bold, color: INK,
    });
    y -= 13;
    const who = `Attached to and part of the application of ${applicant}`.trim();
    const whoSize = fitted(font, who, RIGHT - LEFT, QUESTION_SIZE);
    page.drawText(clipped(font, who, RIGHT - LEFT, whoSize), { x: LEFT, y, size: whoSize, font, color: INK });
    y -= LINE;
    page.drawText(input.note, { x: LEFT, y, size: NOTE_SIZE, font, color: MUTED });
    y -= 20;
    fresh = true;
  };

  newPage();
  for (const section of sections) {
    const heading = section.heading ? wrap(bold, pdfUnicodeText(section.heading), SECTION_SIZE, RIGHT - LEFT) : [];
    section.entries.forEach((entry, i) => {
      const asked = wrap(bold, pdfUnicodeText(entry.question), QUESTION_SIZE, RIGHT - LEFT - (heading.length ? INDENT : 0));
      const given = wrap(font, pdfUnicodeText(entry.answer), ANSWER_SIZE, RIGHT - LEFT - INDENT - (heading.length ? INDENT : 0));
      // A question and its answer are never parted across a page, and a heading never ends one.
      const head = i === 0 ? heading.length * LINE + 4 : 0;
      if (y - head - (asked.length + given.length) * LINE - 8 < BOTTOM) newPage();
      // A section that crosses a page is headed again, so the second page says whose answers these are.
      if (heading.length && (i === 0 || fresh)) {
        for (const line of heading) {
          page!.drawText(line, { x: LEFT, y, size: SECTION_SIZE, font: bold, color: INK });
          y -= LINE;
        }
        y -= 4;
      }
      const x = LEFT + (heading.length ? INDENT : 0);
      for (const line of asked) {
        page!.drawText(line, { x, y, size: QUESTION_SIZE, font: bold, color: INK });
        y -= LINE;
      }
      for (const line of given) {
        page!.drawText(line, { x: x + INDENT, y, size: ANSWER_SIZE, font, color: INK });
        y -= LINE;
      }
      y -= 8;
      fresh = false;
    });
    y -= 6;
  }
  return added;
}
