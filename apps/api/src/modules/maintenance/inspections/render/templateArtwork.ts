import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { INSPECTION_GROUPS } from "@silvicom/shared";
import {
  CHECKBOX_SIZE,
  PAGE_HEIGHT,
  TEMPLATE_SUPPLIES,
  type TickBox,
} from "./layouts/keller14834Rev0122.js";
import {
  GROUP_HEADINGS,
  HEADING_SIZE,
  IDENTIFICATION_TICK,
  KELLER_RED,
  LEGEND_MARKS,
  LEGEND_MARK_BASELINE,
  LEGEND_MARK_SIZE,
  OK_COLUMN_HEADER,
  OTHER_GROUP_TITLE,
  RULE,
  COLUMN_GROUP_BOUNDS,
} from "./layouts/keller14834Rev0122Artwork.js";

/**
 * Putting back the printed ink our copy of Keller form 14834 lost (D-AVI22, revised 2026-09-01).
 *
 * ── WHY THIS FILE EXISTS AND WHAT WOULD DELETE IT ──────────────────────────────────────────────
 * The blank in `assets/` is an Illustrator round trip of the carrier's own purchased form, and it
 * dropped four pieces of artwork: the sixteen coloured section bands, the `OK` column heading, the
 * ✓ inside `VEHICLE IDENTIFICATION (✓ AND COMPLETE)`, and the ✓ / X / NA marks on the INSTRUCTIONS
 * legend. Every one of them is ink the office's filed reports carry, so a report printed without
 * them does not look like the document the binder holds and an auditor recognises.
 *
 * This is not a compensation for a bug we could fix upstream — we do not hold a clean export, and
 * the one we hold came out of the editor damaged twice. Drawing the artwork ourselves makes the
 * page right regardless of which export is in the repo. `TEMPLATE_SUPPLIES` is what stops that
 * becoming permanent: it declares what the asset carries and `assets.test.ts` proves the declaration
 * against the bytes — "headingBands: no filled rectangle sits at any of the sixteen band positions"
 * and its four siblings. The day a clean blank lands, those fail by name, the flags flip, and none
 * of this draws.
 *
 * ── ONLY ON PLAIN PAPER ────────────────────────────────────────────────────────────────────────
 * None of it draws on the overlay path (`background: "none"`, D-AVI8). That page goes onto a real
 * pre-printed Keller pad, which carries all of it already — this is the one place the old "the pad
 * has it" reasoning was true, and it was true about the PAD rather than about the PDF.
 */

/** Keller red, as pdf-lib wants it. */
const RED = rgb(KELLER_RED.r, KELLER_RED.g, KELLER_RED.b);
/** The page's own near-black rule colour, so a redrawn frame matches the rules beside it. */
const RULE_INK = rgb(RULE.r, RULE.g, RULE.b);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0, 0, 0);

/** Top-down baseline to pdf-lib's bottom-up y. Nothing here goes through `baselineOf`: these are
 * artwork positions read off the page's own operators, not text boxes measured by `pdftotext`, so
 * the descender correction that map needs would push every one of them low. */
const up = (y: number, offset: number): number => PAGE_HEIGHT - y + offset;

export interface ArtworkFonts {
  readonly bold: PDFFont;
  readonly dingbats: PDFFont;
}

export async function embedArtworkFonts(doc: PDFDocument, bold: PDFFont): Promise<ArtworkFonts> {
  // ZapfDingbats is a standard-14 face, so the ✓ costs no embedded bytes. pdf-lib encodes U+2714
  // against it directly; the MyriadPro codepoint the template used (`\037`) is not recoverable.
  return { bold, dingbats: await doc.embedFont(StandardFonts.ZapfDingbats) };
}

/**
 * The sixteen section bands: a filled rule across the whole column group with the heading knocked
 * out of it in white.
 *
 * The band spans the group EDGE TO EDGE — over the OK / NEEDS REPAIR / REPAIRED DATE boxes as well
 * as the ITEM column — which is what the office's filed report shows and what the page's own pair
 * of full-group-width rules per section measures. Drawing it only across the ITEM column would
 * leave three white notches the original does not have.
 *
 * The title is drawn from `INSPECTION_GROUPS` rather than from a list of strings, so a heading
 * cannot go missing the way `1. BRAKE SYSTEM` did in the export, and cannot disagree with the items
 * printed beneath it.
 */
export function drawHeadingBands(page: PDFPage, bold: PDFFont, offset: { x: number; y: number }): void {
  const titleOf = (n: number) =>
    (INSPECTION_GROUPS.find((g) => g.number === n)?.title ?? OTHER_GROUP_TITLE).toUpperCase();

  for (const h of GROUP_HEADINGS) {
    if (!TEMPLATE_SUPPLIES.headingBands) {
      const left = h.x0 + offset.x;
      const bottom = PAGE_HEIGHT - h.top - h.height + offset.y;
      page.drawRectangle({ x: left, y: bottom, width: h.x1 - h.x0, height: h.height, color: RED });
      // The band's own frame, redrawn because the fill covers it: the two horizontal rules and the
      // group's two boundary verticals. The internal column rules are NOT redrawn — they stop at a
      // band on the printed form and resume beneath it.
      const edge = { borderColor: RULE_INK, borderWidth: RULE.width, opacity: 0, borderOpacity: 1 };
      page.drawRectangle({ x: left, y: bottom, width: h.x1 - h.x0, height: h.height, ...edge });
    }
    if (TEMPLATE_SUPPLIES.headingTitles) continue;
    // Knocked out of the band in white, which is what the form does. Black on red would be legible
    // and would still be wrong: this page gets photocopied beside originals that are white-on-colour.
    const style = { y: up(h.baseline, offset.y), size: HEADING_SIZE, font: bold, color: WHITE };
    page.drawText(`${h.number}.`, { x: h.numberX + offset.x, ...style });
    page.drawText(titleOf(h.number), { x: h.titleX + offset.x, ...style });
  }
}

/**
 * The `OK` heading, centred in the first ruled column of each group.
 *
 * Its two neighbours (`NEEDS REPAIR`, `REPAIRED DATE`) survived the export at 4 pt and are left
 * alone; only the label the editor dropped is redrawn, on `ITEM`'s own baseline.
 */
export function drawOkColumnHeaders(page: PDFPage, bold: PDFFont, offset: { x: number; y: number }): void {
  if (TEMPLATE_SUPPLIES.okColumnHeader) return;
  const width = bold.widthOfTextAtSize("OK", OK_COLUMN_HEADER.size);
  for (const [groupLeft] of COLUMN_GROUP_BOUNDS) {
    page.drawText("OK", {
      x: groupLeft + (OK_COLUMN_HEADER.width - width) / 2 + offset.x,
      y: up(OK_COLUMN_HEADER.y, offset.y),
      size: OK_COLUMN_HEADER.size,
      font: bold,
      color: INK,
    });
  }
}

/**
 * The ✓ / X / NA the legend uses to say what each column takes, centred on their own red blanks.
 *
 * The fourth blank, under REPAIRED DATE, carries no mark on the original: it is the one column that
 * takes a written value rather than a mark, so it gets none here either.
 */
export function drawLegendMarks(page: PDFPage, fonts: ArtworkFonts, offset: { x: number; y: number }): void {
  if (TEMPLATE_SUPPLIES.legendMarks) return;
  for (const { mark, rule } of LEGEND_MARKS) {
    const [x0, x1] = rule;
    const font = mark === "check" ? fonts.dingbats : fonts.bold;
    const text = mark === "check" ? "✔" : mark;
    const width = font.widthOfTextAtSize(text, LEGEND_MARK_SIZE);
    page.drawText(text, {
      x: (x0 + x1) / 2 - width / 2 + offset.x,
      y: up(LEGEND_MARK_BASELINE, offset.y),
      size: LEGEND_MARK_SIZE,
      font,
      color: RED,
    });
  }
}

/** The ✓ the export turned into a hollow .notdef box in the middle of a printed sentence. */
export function drawIdentificationTick(
  page: PDFPage,
  fonts: ArtworkFonts,
  offset: { x: number; y: number },
): void {
  if (TEMPLATE_SUPPLIES.identificationTick) return;
  page.drawText("✔", {
    x: IDENTIFICATION_TICK.x + offset.x,
    y: up(IDENTIFICATION_TICK.y, offset.y),
    size: IDENTIFICATION_TICK.size,
    font: fonts.dingbats,
    color: INK,
  });
}

/**
 * An `X` centred in a tick box, from the box's OWN rectangle.
 *
 * Kept here rather than in the value stamper because it is the same kind of fact as the artwork
 * above: a position read off the page's `re` operators, not a text cell measured with `pdftotext`.
 * Running it through `baselineOf` is what put every mark 1.5 pt low, and inferring the x is what
 * put three of them on top of a printed label.
 */
export function drawTick(page: PDFPage, font: PDFFont, box: TickBox, offset: { x: number; y: number }): void {
  const size = 8;
  const width = font.widthOfTextAtSize("X", size);
  // Cap height, 0.717 em for Helvetica, centred in the 5.5 pt box.
  const capHeight = 0.717 * size;
  page.drawText("X", {
    x: box.x + (CHECKBOX_SIZE - width) / 2 + offset.x,
    y: PAGE_HEIGHT - box.y - CHECKBOX_SIZE + (CHECKBOX_SIZE - capHeight) / 2 + offset.y,
    size,
    font,
    color: INK,
  });
}
