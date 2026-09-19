import { StandardFonts, rgb } from "pdf-lib";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { FIELD_BASELINE_LIFT } from "./packetFieldGeometry.js";
import type { PacketFieldOverflow, PlacedFieldValue } from "./packetGrid.js";

/**
 * What fits on the carrier's paper, and what has to be carried off it (AUD-1, 2026-09-19).
 *
 * ── WHY THIS IS NOT PART OF `packetOverlay.ts` ────────────────────────────────────────────────
 * That module answers *"put these marks and these answers on somebody else's 31-page form"*. This one
 * answers a narrower question that has nothing to do with the form: *given a span and a string, what
 * can actually be drawn, and where does the remainder go*. The seam is not a line-budget dodge — it
 * is where the file split when the budget forced a choice, and it split here because the rule below
 * is reviewable against `packetGrid.ts`'s overflow model rather than against page 12's column order.
 *
 * ── THE RULE, IN ONE SENTENCE ─────────────────────────────────────────────────────────────────
 * **Nothing is ever drawn outside the span its geometry gives it, and nothing that gets cut is lost.**
 * The first half is `fitText`; the second is `cutBlocks`, which hands the full text to the
 * continuation sheet the driver already certifies. Neither half is safe alone: cutting without the
 * sheet drops an answer out of a §391.51(b)(1) record, and before 2026-09-19 the code did neither and
 * drew the string at full length over whatever was beside it.
 */

/** Ink, matching the carrier's own black rather than a theme colour. */
const INK = rgb(0.1, 0.1, 0.1);

/**
 * The same two numbers for an ANSWER, named apart from the mark's (AUD-1).
 *
 * ⚠ They were one pair, and a signature's fitting policy is not an answer's. A name is a few words
 * that nearly always fit and may be shrunk a little; a `NATURE OF ACCIDENT` cell is a free-text
 * sentence in a 103pt column that reaches the floor routinely. Sharing the constants meant the floor
 * chosen for the first case silently governed the second. The values are deliberately identical
 * today so this change moves nothing on the page — what it buys is that either can move alone.
 */
const FIELD_TEXT_SIZE = 11;
const FIELD_MIN_SIZE = 6;

/**
 * The block id for cut answers that belong to no grid.
 *
 * ⚠ Deliberately not a `fieldTableFor` id, and the notice loop below leans on that: it looks the
 * block's table up and skips what it cannot find, so this block appends to the sheet and prints no
 * notice under a grid it is not part of. Its own notice is drawn under the rule that was cut.
 */
const LOOSE_ANSWERS_BLOCK = "loose.answers";

/** What `fitText` decided: a size, the text to draw at it, and whether anything had to be cut. */
interface FittedText {
  size: number;
  /** ⚠ DRAW THIS, not the input. It is the input, or as much of it as fits, with an ellipsis. */
  text: string;
  /** True when the returned text is shorter than the input — the caller owes the rest a home. */
  cut: boolean;
}

/**
 * The largest size at or below `start` whose text fits `width`, and the text that fits at it.
 *
 * ── ⚠ THIS REPLACES A FUNCTION THAT RETURNED A SIZE THE TEXT DID NOT FIT AT (AUD-1, 2026-09-19) ──
 * `fittedSize` walked 11pt down to a floor of 6 and then RETURNED THE FLOOR whether or not the text
 * fitted at it. Its caller passed that straight to `page.drawText`, which neither wraps nor clips —
 * so a value too long for its column at 6pt was drawn at full length anyway, straight through the
 * rule and over whatever was in the next column. Measured on the carrier's page 12: company, address
 * and position drawn on top of each other, an unreadable row on the §391.23 verification log.
 *
 * ⚠ **No test in this repo could fail on that, and that is the part worth remembering.** Both runs
 * are in the PDF's content stream either way, so `pdfText()` finds every word and every assertion
 * passes. What catches it is a GEOMETRIC claim — `packetOverlay.test.ts`'s *"draws nothing past the
 * span its geometry gives it"* — or looking at the raster.
 *
 * ⚠ **Cutting is a last resort and never a silent one.** `packetContinuation.ts` had the right
 * instinct written down — *"a truncated conviction is the silent loss this whole sheet prevents"* —
 * and drew the reverse conclusion from it, that overrunning was the lesser harm. It is not:
 * overrunning loses the value just as completely AND destroys the one beside it. So the text is cut
 * here, and `renderPacketOverlay` carries what was cut to the continuation sheet in full and prints
 * a notice under the grid saying so. The ellipsis on the paper is the pointer to it.
 *
 * ⚠ **Exported for its test, and that is the only reason** — `packetOverlay.ts` is its one caller.
 * The guarantee it makes — *what comes back is never wider than the span it was given* — is the one
 * claim here that can be checked without a raster, and it cannot be checked through the renderer:
 * a produced page's coordinates stop being readable honestly once pdf-lib has bracketed the
 * carrier's content in `q … Q`. `packetFit.test.ts` pins it by "is never returned wider than the
 * span it was given" and, so the helper cannot pass by cutting everything, by "says it was cut, and
 * is left alone when it fits". What the renderer then DOES with a cut value is pinned next door in
 * `packetOverlay.test.ts` by "is on the continuation sheet in full, and is not on the page it came
 * from".
 */
export function fitText(
  font: PDFFont,
  text: string,
  width: number,
  start: number,
  floor: number,
): FittedText {
  for (let size = start; size >= floor; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width) return { size, text, cut: false };
  }
  // ⚠ By WORD first, so a cut answer still ends on a word a reader can act on; by character only
  // when one word is itself wider than the column, which `Featherstonehaugh-Villanueva` in a 90pt
  // rule genuinely is. A character slice alone would print half a surname and call it an answer.
  const fits = (candidate: string): boolean =>
    font.widthOfTextAtSize(`${candidate}\u2026`, floor) <= width;
  const words = text.split(/\s+/);
  let keep = "";
  for (const word of words) {
    const candidate = keep ? `${keep} ${word}` : word;
    if (!fits(candidate)) break;
    keep = candidate;
  }
  if (!keep) {
    keep = text;
    while (keep.length > 1 && !fits(keep)) keep = keep.slice(0, -1);
  }
  return { size: floor, text: `${keep.trimEnd()}\u2026`, cut: true };
}

/**
 * Turn the cut values into continuation blocks, one per grid plus one for the loose rules (AUD-1).
 *
 * ⚠ **A cut GRID CELL takes its whole row with it, not just itself.** A sheet carrying
 * `Rear-ended while stopped at a construction flagger on I-80 westbound near mile 118` with no date
 * beside it cannot be matched back to the row it came from, and the row it came from is now showing
 * an ellipsis. The carrier's own headings come off the cell's `grid`, so the sheet reads in the same
 * words as the page it continues (Q-PKT10).
 *
 * ⚠ A standalone rule has no row and gets its own block, headed by the carrier's printed question.
 * The two kinds are kept apart rather than merged into a table of pairs, because a grid block's
 * columns are the carrier's and a loose answer has none to borrow.
 */
function cutBlocks(
  cut: readonly PlacedFieldValue[],
  all: readonly PlacedFieldValue[],
): PacketFieldOverflow[] {
  const blocks: PacketFieldOverflow[] = [];

  /** Grid cells, grouped by their grid, then by the row each sits in. */
  const byGrid = new Map<string, PlacedFieldValue[]>();
  const loose: PlacedFieldValue[] = [];
  for (const value of cut) {
    const key = value.line.cell?.tableId;
    if (!key || !value.grid) loose.push(value);
    else byGrid.set(key, [...(byGrid.get(key) ?? []), value]);
  }

  for (const [tableId, cells] of byGrid) {
    const grid = cells[0]?.grid;
    if (!grid) continue;
    // ⚠ The page comes off the LINE, not off `fieldTableFor` — page 1's name and address rows are
    // caption-aligned pseudo-grids with no entry in the measured table, and looking them up would
    // drop exactly the row an applicant with a 60-character street needs carried.
    const page = cells[0]!.line.page;
    const width = Math.max(grid.columns.length, 1);
    const rows = [...new Set(cells.map((c) => c.line.cell!.row))]
      .sort((a, b) => a - b)
      .map((row) =>
        // Read back off the FULL placed list, not off `cut`: the siblings of a cut cell are the
        // ones that fitted, and they are the date and the state that make the row identifiable.
        Array.from({ length: width }, (_, col) =>
          all.find((v) => v.line.cell?.tableId === tableId
            && v.line.cell.row === row
            && v.line.cell.col === col)?.text ?? ""),
      );
    blocks.push({
      tableId,
      label: grid.label,
      columns: grid.columns,
      page,
      rows,
      continued: rows.length,
    });
  }

  /**
   * ⚠ **One block per PAGE, not one block for all the loose answers.** The sheet heads each block
   * *"… continued from page N"*, and a single block carrying page 1's address, page 2's explanation
   * and page 16's service record would have to pick one of those numbers and be wrong about the other
   * two — on the sheet whose whole job is being matchable back to the page it continues.
   */
  const pages = [...new Set(loose.map((v) => v.line.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const rows = loose.filter((v) => v.line.page === page).map((v) => [v.label ?? "", v.text]);
    blocks.push({
      tableId: `${LOOSE_ANSWERS_BLOCK}.${page}`,
      /** Our own words, and the only place on this sheet that may be — there is no grid to quote. */
      label: "Answers that did not fit the space on the form",
      columns: ["QUESTION", "ANSWER"],
      page,
      rows,
      continued: rows.length,
    });
  }

  return blocks;
}

/**
 * Draw every placed answer onto the loaded packet, and hand back the ones that had to be cut.
 *
 * ⚠ **Values are drawn before marks, so that if a coordinate is ever wrong enough for the two to
 * collide the SIGNATURE is the one on top.** A date drawn over a signature is a document whose
 * signature is obscured; a signature drawn over a date is a legible signature and a smudged date.
 * That ordering lives in the caller and this function must stay the first half of it.
 */
export async function drawFieldValues(
  doc: PDFDocument,
  fields: readonly PlacedFieldValue[],
): Promise<{ font: PDFFont; cut: PlacedFieldValue[] }> {
  /**
   * ⚠ **Upright, not the signature's oblique.** A mark is a person's hand and reads as one; an
   * ANSWER is a fact somebody typed into a form. Drawing a date of birth in italic would make every
   * filled field look like a signature, on a document whose whole point is that the signatures are
   * distinguishable from everything else on it.
   */
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cut: PlacedFieldValue[] = [];

  for (const field of fields) {
    const text = field.text.trim();
    if (!text) continue;
    const page = doc.getPage(field.line.page - 1);
    const width = field.line.x2 - field.line.x1;
    const fit = fitText(font, text, width - 4, FIELD_TEXT_SIZE, FIELD_MIN_SIZE);
    if (fit.cut) cut.push(field);
    // ⚠ `fit.text`, never `text`. That substitution IS the fix: the old line passed the untouched
    // string with a size it did not fit at, and pdf-lib drew it across the column boundary.
    page.drawText(fit.text, {
      x: field.line.x1 + 2,
      y: field.line.y + FIELD_BASELINE_LIFT,
      size: fit.size,
      font,
      color: INK,
    });
  }

  return { font, cut };
}

/**
 * Merge what the carrier had no ROOM for with what it had no WIDTH for.
 *
 * ⚠ **The same sentence about the same paper, which is why it is the same mechanism and not a
 * second one.** `fillGrid` already produced overflow for *"the carrier printed no more rows"*;
 * a value that cannot be drawn inside its own column is *"the carrier's row is not wide enough"*.
 * Both end on the continuation sheet the driver certifies, under the carrier's own headings.
 */
export function mergeOverflow(
  existing: readonly PacketFieldOverflow[],
  cut: readonly PlacedFieldValue[],
  all: readonly PlacedFieldValue[],
): PacketFieldOverflow[] {
  const overflow: PacketFieldOverflow[] = existing.map((o) => ({ ...o }));
  for (const block of cutBlocks(cut, all)) {
    const match = overflow.find((o) => o.tableId === block.tableId);
    if (!match) {
      overflow.push(block);
      continue;
    }
    // ⚠ Appended AFTER the capacity leftovers, which is what `continued` counts from the end of.
    match.rows = [...match.rows, ...block.rows];
    match.continued = (match.continued ?? 0) + block.rows.length;
  }
  return overflow;
}
