import {
  CONTENT_WIDTH,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  winAnsi,
} from "../../../lib/pdfDraw.js";

/**
 * What is stamped ACROSS every page once the content has been drawn (A6, F6).
 *
 * Its own module because every line in it is about the same hazard: pdfkit's page machinery, revisited
 * after the fact. Both marks need `bufferPages` and `switchToPage`, both are drawn outside the text
 * flow, and both have already cost a document once — see the two warnings below. `render.ts` draws the
 * application; this draws on the sheets.
 */

/** One pass over the buffered pages: the footer on each, and the draft band when there is one. */
export interface PageStamp {
  /** The applicant, so a loose sheet says who it is about. */
  name: string;
  /** The invitation or the application — whichever identifies what was drawn. */
  reference: string;
  /** The digest of the SOURCE, not of the file. `render.ts`'s header says why it cannot be the file's. */
  digest: string;
  /**
   * The words across the middle of every page, or null for the filed document.
   *
   * ⚠ Words rather than a colour, and the same reasoning as D-AVI22 next door: the annual-inspection
   * preview used to stamp its VALUES in red, and the office read that as the product printing in red.
   * A preview whose ink differs from the filing is not previewing the filing. So the ink is identical
   * and the band says what it is in a sentence.
   */
  band: string | null;
}

/**
 * ⚠ The bottom margin is dropped to zero while the footer is written and restored afterwards. pdfkit
 * treats any text drawn below the bottom margin as content that has OVERFLOWED and auto-adds a page
 * for it — so a footer stamped at the foot of the sheet silently doubles the document, and the new
 * blank pages arrive after `bufferedPageRange()` was read, so the count printed on them is wrong too.
 * It presents as "every page added two pages", which is how it was found.
 */
export function stampPages(doc: PDFKit.PDFDocument, stamp: PageStamp): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (stamp.band) drawBand(doc, stamp.band);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        winAnsi(
          `${stamp.name} · ${stamp.reference} · source ${stamp.digest.slice(0, 16)}`
          + ` · page ${i - range.start + 1} of ${range.count}`,
        ),
        MARGIN,
        PAGE_HEIGHT - MARGIN - 6,
        { width: CONTENT_WIDTH, lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
}

/**
 * The draft band, across the diagonal of one page.
 *
 * ⚠ `save`/`restore` around the whole of it, and `lineBreak: false` inside. The rotation is applied to
 * the page's transform, not to the text run — anything drawn afterwards without a restore comes out at
 * 30 degrees, which on this document is the footer of every page after the first. And rotated text
 * that is allowed to wrap wraps against the UNROTATED margins, which puts half the band off the sheet.
 *
 * `opacity` rather than a pale grey: the band sits UNDER nothing — it is drawn last, over the answers —
 * so it has to be legible as a mark and transparent as ink. 0.12 is where a photocopy still carries it
 * and the smallest field label underneath is still readable, measured on the rendered page.
 */
function drawBand(doc: PDFKit.PDFDocument, band: string): void {
  const text = winAnsi(band);
  doc.save();
  doc.rotate(-30, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] });
  doc.fillColor(MUTED).opacity(0.12).font("Helvetica-Bold");
  // Shrink to fit rather than trusting a constant: the band is a sentence, and a longer one at a
  // fixed size runs off the sheet with `lineBreak: false` and is silently cropped.
  let size = 30;
  doc.fontSize(size);
  while (size > 10 && doc.widthOfString(text) > PAGE_WIDTH - 100) {
    size -= 1;
    doc.fontSize(size);
  }
  doc.text(text, 0, PAGE_HEIGHT / 2 - size * 0.7, {
    width: PAGE_WIDTH,
    align: "center",
    lineBreak: false,
  });
  doc.opacity(1);
  doc.restore();
}
