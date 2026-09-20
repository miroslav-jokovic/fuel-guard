import {
  CONTENT_WIDTH,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  winAnsi,
} from "../../../lib/pdfDraw.js";

/**
 * What is stamped ACROSS every page once the content has been drawn (A6, F6).
 *
 * Its own module because every line in it is about the same hazard: pdfkit's page machinery, revisited
 * after the fact. Both marks need `bufferPages` and `switchToPage`, both are drawn outside the text
 * flow, and both have already cost a document once — see the warnings below. `render.ts` draws the
 * application; this draws on the sheets.
 *
 * ⚠ **Both live in the page's FURNITURE — the margins the text block never enters — and since AUD-10
 * that is a rule rather than a coincidence.** The footer sits under the text block, the band sits over
 * it, and a document that put either INTO the block would be printing on its own evidence. There is a
 * third member of this family one document away: `dqBinder/merge.ts`'s stamped footers, and AUD-6 is
 * the finding for the sheet that carries none of it.
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
   * The words at the head of every page, or null for the filed document.
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
 *
 * ⚠ The band needs no such care and never has: it is drawn ABOVE the top margin, and pdfkit's
 * overflow rule is about the foot of the sheet only.
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
 * Where the band sits: centred in the top margin, clear of the text block below it.
 *
 * ⚠ 26 is a coordinate on the SHEET, not a distance from anything, and both of its ends were
 * measured on the rendered page. Below: the band's baseline lands at y32.10 and its descenders stop
 * around y34, while the text block starts at `MARGIN` (54) — so ~20pt of white, against the 15.07pt
 * that separates `title()` from its own lede on the same sheet. The band is therefore further from
 * the title than the title's lede is, which is what keeps it reading as the SHEET's rubric instead
 * of as an eyebrow on the document's name. Above: 26pt is 0.36in from the paper edge, outside the
 * ~0.25in a laser printer will not print in, so a band a printer silently dropped cannot happen.
 */
const BAND_TOP = 26;
/**
 * ⚠ The size the rest of this family's small text is set at — `muted()` and `caption()` are both
 * 8.5, the footer is 7.5 — rather than a size chosen to be noticed. A rubric that shouts in POINTS
 * competes with the document; what makes this one carry is that it is bold, tracked, in capitals and
 * alone on its strip of paper. 10pt was rendered beside it and read as a second title.
 */
const BAND_SIZE = 8.5;
/**
 * ⚠ Tracked, and it is the one thing making this line read as a STAMP rather than as a heading.
 * Letter-spaced capitals are what a rubric looks like on paper; without it the band is just a short
 * grey sentence at the top of the sheet, which is the shape of a running head — the furniture a
 * reader has learned to skip.
 */
const BAND_TRACKING = 1.6;

/**
 * ── THE BAND, AT THE HEAD OF EVERY SHEET (A6, F6, AUD-10) ─────────────────────────────────────
 *
 * ⚠ **It was a 30pt diagonal across the middle of the page until 2026-09-20, and what was wrong with
 * that is where it landed rather than what it said.** On six of the permissions document's eight
 * pages it fell in white space and looked fine; on the certificate it ran through the evidence rows
 * of sections 2 to 5 — the page that whole document exists to produce — and on page 1 through the
 * Clearinghouse sentence. A watermark through a table is the next thing a reader notices on the one
 * page that matters, which is AUD-10 in a sentence.
 *
 * ⚠ **The obvious fix was tried first and MEASURED NOT TO WORK, so nobody has to try it again.**
 * Drawing the band UNDER the content instead of over it — the conventional answer, and the layer a
 * watermark belongs on — was built, rendered and compared pixel for pixel against the old document:
 * **696 pixels changed on the certificate at 150 dpi, none of them by more than 9 of 255.** That is
 * arithmetic, not opinion: 12% grey over near-black type barely lightens it, so the z-order was never
 * what made the band intrusive. Its SIZE and its POSITION were. A fix that moved 696 imperceptible
 * pixels and left the diagonal through the table would have been the audit's own workaround — the
 * change that lets a finding be closed without being answered.
 *
 * ⚠ **So the band moved into the furniture, where a collision is impossible rather than unlikely.**
 * The sheet has two strips the text block never enters, and the footer already lives in one of them.
 * This takes the other. No page of any document this module stamps can grow into it, because the
 * margin is what pdfkit paginates against — which is the difference between a mark that does not
 * collide today and one that cannot.
 *
 * ⚠ **And it is more legible than what it replaces, not less.** The diagonal was drawn at 0.12
 * opacity — #666 over white comes out near #ededed — because it had to survive being on top of the
 * answers. In the margin it has nothing to be transparent for, so it is MUTED at full strength: the
 * same grey as the footer, which is the one mark on these documents known to photocopy. The claim
 * the old comment made for 0.12 ("a photocopy still carries it") was measured on a rendered page and
 * never on a photocopier.
 *
 * ⚠ **`packetOverlay.ts` keeps its diagonal, and that is not drift.** Its band goes on the CARRIER's
 * own printed form, whose sheets have no margin to borrow — AUD-19 measured 3.84pt of clear space
 * above page 12's grid and the same under it. The two bands share their words and their reason; the
 * shape is decided by the paper, and only one of the two papers is ours.
 */
function drawBand(doc: PDFKit.PDFDocument, band: string): void {
  const text = winAnsi(band.toUpperCase());
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(BAND_SIZE);
  // Shrink to fit rather than trusting a constant: the band is a sentence, a longer one runs past the
  // margins, and with `lineBreak: false` what runs past them is silently cropped. ⚠ The width is
  // measured WITH the tracking, which is a real part of it — 40 characters of this band carry 62pt of
  // letter-spacing, and a measurement that ignored it would pass a line that does not fit.
  let size = BAND_SIZE;
  const fits = (): boolean =>
    doc.widthOfString(text, { characterSpacing: BAND_TRACKING }) <= CONTENT_WIDTH;
  while (size > 6 && !fits()) {
    size -= 0.5;
    doc.fontSize(size);
  }
  doc.text(text, MARGIN, BAND_TOP, {
    width: CONTENT_WIDTH,
    align: "center",
    characterSpacing: BAND_TRACKING,
    lineBreak: false,
  });
}
