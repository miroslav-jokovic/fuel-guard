import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { PacketFieldOverflow } from "./packetGrid.js";

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
export const continuationNoticeFor = (over: PacketFieldOverflow): string => {
  const continued = over.continued ?? 0;
  const missing = over.rows.length - continued;
  const parts: string[] = [];
  if (missing > 0) {
    parts.push(missing === 1
      ? "1 more entry is on the continuation sheet attached to this application."
      : `${missing} more entries are on the continuation sheet attached to this application.`);
  }
  /**
   * ⚠ **A different sentence, because it is a different fact to the person holding page 2** (AUD-1).
   * A row with no room is *missing from* this page. A row whose text was too wide for its column is
   * printed right there, ending in an ellipsis, and is *shown in full* on the sheet — telling that
   * reader "1 more entry" about a row in front of them is how an attachment stops reading as a
   * continuation and starts reading as the place an answer was put out of sight.
   */
  if (continued > 0) {
    const where = missing > 0 ? "that sheet" : "the continuation sheet attached to this application";
    parts.push(continued === 1
      ? `1 entry above is too long for its column and is printed in full on ${where}.`
      : `${continued} entries above are too long for their columns and are printed in full on ${where}.`);
  }
  // ⚠ Two whole SENTENCES joined by a space, not two clauses joined by "and". The first draft shared
  // one tail between them and printed "1 more entry is, and 1 entry above is too long for its column
  // and is printed in full on the continuation sheet" — grammatical nonsense on a federal form, and
  // the sort of thing only rasterising the page shows you.
  return parts.join(" ");
};

/**
 * The largest size at or below `start` whose text fits, floored at 5pt.
 *
 * ⚠ **The comment here used to say "Shrink to fit, never overrun" and neither half was true**
 * (AUD-2). It returns the floor whether or not the text fits at it, exactly as `packetOverlay.ts`'s
 * `fittedSize` did — the two were written together and were wrong together. Every surviving caller
 * now either passes the result straight to `clipped()` or is a single line of our own copy whose
 * length this module controls, so the floor can no longer reach the page uncut. Answers do not come
 * through here at all any more: they WRAP.
 */
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
 * ⚠ **Applied to HEADINGS and to our own copy, never to an answer** — and the second half of that
 * rule changed on 2026-09-19. It used to end *"a value too long for its column shrinks to 5pt and is
 * allowed to be small"*, which was measured to be false: at 5pt the fourth accident's description
 * still did not fit and ran through the column beside it. An answer now WRAPS instead, which is the
 * option this page has and the carrier's 15.2pt rows do not. The first half stands: a truncated
 * column name is still readable beside the page it continues, and a truncated conviction is the
 * silent loss this whole sheet prevents.
 */
function clipped(font: PDFFont, text: string, width: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Break text onto as many lines as it needs, by word.
 *
 * ⚠ **A word wider than the column is broken by character rather than left to overrun** — the one
 * case word-wrapping alone cannot answer, and not hypothetical: the sheet's columns are a fifth of
 * the page and `Featherstonehaugh-Villanueva` is wider than that at 8.5pt. Breaking a surname is
 * ugly; drawing it through the next column is the defect this file was opened to fix.
 *
 * ⚠ **Exported for its own test only.** It makes the claim this whole module now rests on — *no line
 * that comes back is wider than the width it was given* — and that claim cannot be read back off a
 * produced page, because a drawn page's coordinates stop being trustworthy once pdf-lib has
 * bracketed the carrier's content in `q … Q`. So it is pinned directly, by "breaks a word that is
 * itself wider than the column, rather than letting it run"; what the RENDERER does with the lines
 * is pinned by "is drawn as several lines, not one run that overruns", which counts runs rather
 * than reading words, because rejoining wrapped lines reproduces the original sentence.
 */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  const flush = (): void => {
    if (line) out.push(line);
    line = "";
  };
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    flush();
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let take = rest;
      while (take.length > 1 && font.widthOfTextAtSize(take, size) > width) take = take.slice(0, -1);
      out.push(take);
      rest = rest.slice(take.length);
    }
    line = rest;
  }
  flush();
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
    // ⚠ Clipped as well as fitted: the sentence is ours but the NAME in it is theirs, and a long
    // enough one reaches the floor and runs off the right margin of the sheet's own header.
    const whoSize = fitted(font, who, RIGHT - LEFT, HEADING_SIZE);
    page.drawText(clipped(font, who, RIGHT - LEFT, whoSize), {
      x: LEFT,
      y,
      size: whoSize,
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

  /**
   * A block's heading and its column row, drawn at the cursor.
   *
   * ⚠ **A function because it has to run again on every page the block spills onto** (AUD-1). It was
   * inline, once per block, and a block whose rows crossed a page boundary left its heading and its
   * column names orphaned at the foot of one page while the rows landed headerless at the top of the
   * next — the reader of that second page has five unlabelled columns and no idea which grid they
   * continue. Measured on the long fixture: page 33 opened with the employment log's rows and no
   * heading. ⚠ It is the same defect class as AUD-4 next door in the certificate, and it is not
   * enough to reserve room before the heading: rows here wrap, so their height is not known until
   * the row is laid out.
   */
  const openBlock = (block: PacketFieldOverflow, columnWidth: number): void => {
    for (const line of wrap(bold, `${block.label} — continued from page ${block.page}`, HEADING_SIZE, RIGHT - LEFT)) {
      cursor.page.drawText(line, { x: LEFT, y: cursor.y, size: HEADING_SIZE, font: bold, color: INK });
      cursor.y -= 11;
    }
    cursor.y -= 3;
    if (!block.columns.some((c) => c.trim())) return;
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
  };

  for (const block of blocks) {
    /**
     * ⚠ Widened by the LONGEST row as well as by the column list. A block whose rows carry more
     * cells than its headings — which `p02.experience` did, because the carrier's `DATES FROM / TO`
     * is one bordered column holding two captions — drew its last value past the right margin and
     * off the paper. Taking the max means a mismatch produces a cramped column rather than a lost
     * answer.
     */
    const span = Math.max(block.columns.length, ...block.rows.map((r) => r.length), 1);
    // ⚠ The sheet's columns are EVEN, and do not copy the carrier's widths. Their grid's proportions
    // belong to their printed page; reproducing them here would squeeze `Address` into 103pt again
    // for no reason, and this page is ours to lay out.
    const columnWidth = (RIGHT - LEFT) / span;

    // A block needs its heading, its column row and at least one row, or it starts a fresh page.
    if (cursor.y - ROW_HEIGHT * 4 < BOTTOM) cursor = newPage();
    openBlock(block, columnWidth);

    for (const row of block.rows) {
      /**
       * ⚠ **Values WRAP here, and on the carrier's own grids they cannot** (AUD-2). The comment this
       * replaced said a value too long for its column *"shrinks to 5pt and is allowed to be small"*.
       * It was not allowed to be small enough: at 5pt the fourth accident's description still did not
       * fit a fifth of the page, so it ran through `FATALITIES NUMBER` and the `0` landed inside the
       * word `must` — on the one sheet whose entire purpose is that nothing is lost.
       *
       * This page is OURS. It has no printed rules to sit on and no fixed row pitch, so the honest
       * answer here is the one the carrier's 15.2pt rows cannot give: let the text take the lines it
       * needs and let the row grow. Nothing on this sheet is ever cut.
       */
      const cells = row.map((cell) => {
        const text = cell.trim();
        if (!text) return [];
        const width = span > 1 ? columnWidth : RIGHT - LEFT;
        return wrap(font, text, ROW_SIZE, width - 4);
      });
      const tallest = Math.max(1, ...cells.map((lines) => lines.length));
      // ⚠ A row taller than the page's remainder starts a fresh one AND re-opens the block, so the
      // rows that land there still carry the heading and the columns they belong to.
      if (cursor.y - tallest * ROW_HEIGHT < BOTTOM) {
        cursor = newPage();
        openBlock(block, columnWidth);
      }
      cells.forEach((lines, i) => {
        lines.forEach((text, l) => {
          cursor.page.drawText(text, {
            x: LEFT + (span > 1 ? i * columnWidth : 0),
            y: cursor.y - l * ROW_HEIGHT,
            size: ROW_SIZE,
            font,
            color: INK,
          });
        });
      });
      cursor.y -= tallest * ROW_HEIGHT;
    }
    cursor.y -= 8;
  }

  return added;
}
