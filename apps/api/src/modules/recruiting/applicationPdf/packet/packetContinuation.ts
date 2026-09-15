import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { PacketFieldOverflow } from "./packetFieldValues.js";

/**
 * The continuation sheet — the answers the carrier's own grids had no room for (Q-PKT10).
 *
 * ── ⚠ WHY THERE IS ONE AT ALL, AND WHY IT IS THIS SHAPE ───────────────────────────────────────
 * The carrier's licence grid has ONE row, its accident and conviction grids THREE each. §391.21(b)(7)
 * asks for every accident in the preceding three years and (b)(8) for every conviction other than
 * parking — so a driver with four convictions is an ordinary driver, and a form that drew three and
 * dropped the fourth would be **signed, filed and materially false**. That was the only real
 * question here; truncating was never an option.
 *
 * **The carrier answered it themselves.** Page 11 of their own packet heads the employment section
 * `EMPLOYMENT RECORD ( ATTACH SHEET IF MORE SPACE IS NEEDED)`. §391.21(a) makes the application "a
 * form furnished by the motor carrier" and §391.21(c) lets the carrier ask for more than the minimum
 * on it, so the FORMAT is theirs to set — and they set it. This sheet is the attachment their own
 * instruction contemplates.
 *
 * ── ⚠ IT IS APPENDED, NEVER INSERTED, AND THAT IS NOT A STYLE CHOICE ──────────────────────────
 * `packetMarkGeometry.ts` and `packetFieldGeometry.ts` record the carrier's own FOOTER page number,
 * and `packetOverlay.ts` uses it directly as the PDF index (`doc.getPage(line.page - 1)`). Inserting
 * a sheet after page 2 would shift every page after it by one and silently move nineteen of the
 * driver's twenty-two signatures onto the wrong pages. Appending after page 31 changes no index.
 *
 * ── ⚠ AND THE GRID IT CONTINUES SAYS SO ───────────────────────────────────────────────────────
 * A page-2 conviction grid showing three rows, with a fourth conviction on an unreferenced sheet at
 * the back, is a page that misleads a reader who stops there. `continuationNoticeFor` puts a line
 * under the grid pointing at the sheet. Without it the attachment is a place the answer was hidden
 * rather than a place it was continued.
 *
 * ── WHOSE WORDS ARE ON IT ─────────────────────────────────────────────────────────────────────
 * The carrier's, out of `packetText.ts` — their heading and their column names verbatim, including
 * `reisdture`-class spellings (D-PKT11), because a reader comparing the sheet against the page it
 * continues has to see the same words.
 *
 * ⚠ **Two exceptions, both named.** The sheet's own title is ours and says what the sheet IS. And
 * the LICENCE block's heading is ours, because that grid is the one on the carrier's page with no
 * printed heading at all — the §383.21 sentence above it is a legal preamble and reads as nonsense
 * over a continuation block.
 *
 * ── ⚠ IT CARRIES NO SIGNATURE LINE, AND THAT IS DELIBERATE ────────────────────────────────────
 * The driver's twenty-two stops are `driverPlacements()`, a measurement of the carrier's paper, and
 * `packetDriverMarkCount()` is derived from it. A signature line here would make the count vary per
 * applicant — the one thing 0339's header says it must not do. It does not need one: a paper form
 * that says "attach sheet if more space is needed" does not ask the applicant to sign the sheet, and
 * the certification on pages 11, 13 and 17 covers "all entries on it and information in it", which
 * is the document. ⚠ Counsel owns whether that reading holds; the question is on the plan.
 */

/** Letter, matching the carrier's own pages so the sheet prints on the same paper. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
/** The carrier's own text margin, measured off their pages — x51.4 to x553.6. */
const LEFT = 51.4;
const RIGHT = 553.6;
const TOP = 726;
const BOTTOM = 72;

const INK = rgb(0.1, 0.1, 0.1);
const RULE = rgb(0.45, 0.45, 0.45);
const TITLE_SIZE = 10;
const HEADING_SIZE = 8.5;
const COLUMN_SIZE = 7;
const ROW_SIZE = 8.5;
const ROW_HEIGHT = 15.2;

export interface ContinuationInput {
  overflow: readonly PacketFieldOverflow[];
  /** The applicant, so a sheet separated from the packet can be put back with it. */
  applicantName: string;
}

/**
 * The line drawn under a grid that continues, pointing at the sheet.
 *
 * ⚠ Returned rather than drawn here, because it goes on the CARRIER's page and this module only
 * makes new ones. `packetOverlay.ts` places it.
 */
export const continuationNoticeFor = (over: PacketFieldOverflow): string =>
  over.rows.length === 1
    ? "1 more entry is on the continuation sheet attached to this application."
    : `${over.rows.length} more entries are on the continuation sheet attached to this application.`;

/** Shrink to fit, never overrun — `packetOverlay.ts`'s rule, for the same reason. */
function fitted(font: PDFFont, text: string, width: number, start: number): number {
  for (let size = start; size > 5; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width) return size;
  }
  return 5;
}

/**
 * Cut a string to what fits at its floor size, with an ellipsis.
 *
 * ⚠ **Shrinking alone is not enough and the sheet proved it.** `NATURE OF ACCIDENT (HEAD-ON,
 * REAR-END, ROLLOVER, ETC.)` does not fit an even fifth of the text width even at 5pt, so it ran
 * straight through `FATALITIES NUMBER` beside it — two headings on top of each other, on the sheet
 * that exists so nothing is lost.
 *
 * ⚠ Applied to HEADINGS only, never to an answer. A truncated column name is still readable beside
 * the page it continues; a truncated conviction is the silent loss this whole sheet prevents. A value
 * too long for its column shrinks to 5pt and is allowed to be small.
 */
function clipped(font: PDFFont, text: string, width: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Break a heading onto as many lines as it needs, by word. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      out.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(line);
  return out;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

/**
 * Append the continuation sheet to a loaded packet, and return how many pages it took.
 *
 * ⚠ **Returns 0 and adds nothing when there is no overflow**, which is the ordinary case: a driver
 * with one licence, no accidents and two convictions fills the carrier's grids with room to spare.
 * A packet that grew a blank "continuation sheet" page every time would be 32 pages of which one
 * says nothing.
 */
export async function appendContinuationSheet(
  doc: PDFDocument,
  input: ContinuationInput,
): Promise<number> {
  const blocks = input.overflow.filter((o) => o.rows.length > 0);
  if (blocks.length === 0) return 0;

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let added = 0;

  const newPage = (): Cursor => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    added += 1;
    let y = TOP;
    page.drawText("CONTINUATION SHEET", { x: LEFT, y, size: TITLE_SIZE, font: bold, color: INK });
    y -= 13;
    const who = `Attached to and part of the application of ${input.applicantName}`.trim();
    page.drawText(who, {
      x: LEFT,
      y,
      size: fitted(font, who, RIGHT - LEFT, HEADING_SIZE),
      font,
      color: INK,
    });
    y -= 11;
    // ⚠ The carrier's own instruction, quoted, so a reader knows this sheet is the form's own idea.
    page.drawText("The carrier's form asks that a sheet be attached if more space is needed.", {
      x: LEFT,
      y,
      size: COLUMN_SIZE,
      font,
      color: RULE,
    });
    y -= 20;
    return { page, y };
  };

  let cursor = newPage();

  for (const block of blocks) {
    // A block needs its heading, its column row and at least one row, or it starts a fresh page.
    if (cursor.y - ROW_HEIGHT * 4 < BOTTOM) cursor = newPage();

    for (const line of wrap(bold, `${block.label} — continued from page ${block.page}`, HEADING_SIZE, RIGHT - LEFT)) {
      cursor.page.drawText(line, { x: LEFT, y: cursor.y, size: HEADING_SIZE, font: bold, color: INK });
      cursor.y -= 11;
    }
    cursor.y -= 3;

    /**
     * ⚠ Widened by the LONGEST row as well as by the column list. A block whose rows carry more
     * cells than its headings — which `p02.experience` did, because the carrier's `DATES FROM / TO`
     * is one bordered column holding two captions — drew its last value past the right margin and
     * off the paper. Taking the max means a mismatch produces a cramped column rather than a lost
     * answer.
     */
    const span = Math.max(block.columns.length, ...block.rows.map((r) => r.length), 1);
    const columnWidth = (RIGHT - LEFT) / span;
    // ⚠ The sheet's columns are EVEN, and do not copy the carrier's widths. Their grid's proportions
    // belong to their printed page; reproducing them here would squeeze `Address` into 103pt again
    // for no reason, and this page is ours to lay out.
    const showColumns = block.columns.some((c) => c.trim());
    if (showColumns) {
      block.columns.forEach((heading, i) => {
        const text = heading.trim();
        if (!text) return;
        const size = fitted(font, text, columnWidth - 4, COLUMN_SIZE);
        cursor.page.drawText(clipped(font, text, columnWidth - 4, size), {
          x: LEFT + i * columnWidth,
          y: cursor.y,
          size,
          font,
          color: RULE,
        });
      });
      cursor.y -= 4;
      cursor.page.drawLine({
        start: { x: LEFT, y: cursor.y },
        end: { x: RIGHT, y: cursor.y },
        thickness: 0.6,
        color: RULE,
      });
      cursor.y -= 11;
    }

    for (const row of block.rows) {
      if (cursor.y < BOTTOM) cursor = newPage();
      row.forEach((cell, i) => {
        const text = cell.trim();
        if (!text) return;
        // ⚠ A single-column block (page 16's free text) gets the whole width rather than a fifth of it.
        const width = span > 1 ? columnWidth : RIGHT - LEFT;
        cursor.page.drawText(text, {
          x: LEFT + (span > 1 ? i * columnWidth : 0),
          y: cursor.y,
          size: fitted(font, text, width - 4, ROW_SIZE),
          font,
          color: INK,
        });
      });
      cursor.y -= ROW_HEIGHT;
    }
    cursor.y -= 8;
  }

  return added;
}
