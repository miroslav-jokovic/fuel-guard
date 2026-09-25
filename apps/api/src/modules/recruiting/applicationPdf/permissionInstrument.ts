import {
  PERMISSION_SIGNATURE_BOX,
  PERMISSION_SIGNATURE_DESTINATION,
  formatDisplayDate,
} from "@silvicom/shared";
import {
  CONTENT_WIDTH, INK, MARGIN, MUTED, NAVY, PAGE_HEIGHT, RULE, newDrawing, winAnsi,
} from "../../../lib/pdfDraw.js";

/**
 * ONE permission, as its own PDF (AF6, D-AF2).
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────────────────────────
 * The owner asked for the permissions as *"well designed and professional looking PDF documents that
 * have a signing format as DocuSign has"*. Until now each was a block of text on a screen, and the
 * office's only printable copy was B2's summary pages (`instrumentPage`), which print an instrument
 * the way a record prints a fact about it: a heading of ours, a version line, the text, then `Signed:`.
 * This draws the instrument as a DOCUMENT: its own title, its text, the sentence the signer affirms,
 * and a signature block with a box, a date and a printed name.
 *
 * ⚠ **One function draws it everywhere it is shown.** The applicant signs against
 * `permissionInstrumentPdf` (unsigned), and the office's B2 document draws each signed instrument
 * with `drawPermissionInstrument` onto its own pages. A2's lesson (`instrumentPages.ts`): for four
 * days the office previewed one renderer while the driver signed another. The text on this page is
 * what FCRA §604(b)(2) disputes are about, so it is the last thing to draw twice.
 *
 * ── ⚠ THE PSP FORM IS DRAWN AS FMCSA'S, AND NOTHING ELSE ─────────────────────────────────────
 * The form's own NOTICE: *"the language on this form must exist as one stand-alone document. The
 * language may NOT be included with other consent forms or any other language."* So the PSP PDF has
 * no letterhead, no version line and no words of ours. The signature block's captions are the form's
 * own: `Date`, `Signature`, `Name (Please Print)`. The two NOTICE paragraphs are drawn BELOW the
 * signature block, which is where the paper has them. `pspDisclosure.ts` stores them inside the body
 * because "in whole" allows no omission, and the order is the form's.
 *
 * ⚠ The other four carry the carrier's name at the top. They are the carrier's own instruments (the
 * packet's pages, their counsel's words; FMCSA's Clearinghouse sample names the employer), and a
 * letterhead is what makes a loose printout say whose document it is.
 *
 * ── THE SIGNATURE BOX IS FOUND BY NAME ────────────────────────────────────────────────────────
 * Its top-left is written into the PDF as the named destination `PERMISSION_SIGNATURE_DESTINATION`
 * (`packages/shared/src/permissionInstrument.ts` explains why a name and not a coordinate). In the
 * file it is PDF user space, origin bottom-left; pdfkit does that flip itself (see the call).
 */

export interface PermissionInstrumentInput {
  purpose: string;
  /** Stored on the signed row, and printed on every instrument except PSP's (see the header). */
  version: string;
  title: string;
  body: string;
  intent: string;
  carrier: { name: string; address: string | null };
  /** Null for the copy the applicant is about to sign: the box, the date and the name are left empty. */
  signer: { name: string; signedAt: string; mark: Buffer | null } | null;
}

const BODY_SIZE = 10;
const BODY_GAP = 6;
const CAPTION_SIZE = 8.5;
const DATE_WIDTH = 150;
const ROW_GAP = 22;
/** The block's full height: the box, its caption, a gap, the name rule and its caption. */
const BLOCK_HEIGHT = PERMISSION_SIGNATURE_BOX.height + 14 + ROW_GAP + 18 + 14;

const isPsp = (purpose: string): boolean => purpose === "psp";

/**
 * The body's paragraphs, split where the stored text puts a blank line.
 *
 * ⚠ **PSP's trailing `NOTICE:` paragraphs are separated out** so they can be drawn under the signature
 * block, where the form has them. Only trailing ones, and only on PSP: a NOTICE in the middle of some
 * other instrument's text is that instrument's sentence and stays where it is.
 */
function paragraphs(input: PermissionInstrumentInput): { before: string[]; after: string[] } {
  const all = input.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!isPsp(input.purpose)) return { before: all, after: [] };
  let cut = all.length;
  while (cut > 0 && all[cut - 1]!.startsWith("NOTICE:")) cut -= 1;
  return { before: all.slice(0, cut), after: all.slice(cut) };
}

function text(doc: PDFKit.PDFDocument, value: string, font: string, size: number, opts: PDFKit.Mixins.TextOptions = {}): void {
  doc.fillColor(INK).font(font).fontSize(size)
    .text(winAnsi(value), MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1.5, ...opts });
}

function letterhead(doc: PDFKit.PDFDocument, input: PermissionInstrumentInput): void {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11)
    .text(winAnsi(input.carrier.name), MARGIN, doc.y, { width: CONTENT_WIDTH });
  if (input.carrier.address) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(CAPTION_SIZE)
      .text(winAnsi(input.carrier.address), MARGIN, doc.y, { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.6);
  doc.strokeColor(RULE).lineWidth(0.75)
    .moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).stroke();
  doc.moveDown(1.2);
}

/** One ruled line with its caption underneath, the shape of every blank in the block. */
function blank(doc: PDFKit.PDFDocument, x: number, y: number, width: number, caption: string): void {
  doc.strokeColor(INK).lineWidth(0.75).moveTo(x, y).lineTo(x + width, y).stroke();
  doc.fillColor(MUTED).font("Helvetica").fontSize(CAPTION_SIZE)
    .text(winAnsi(caption), x, y + 3, { width, lineBreak: false });
}

/**
 * What is written ON a blank: a value set on its rule, never through it.
 *
 * ⚠ **Shrunk to fit, never wrapped.** pdfkit wraps a long value even with `lineBreak: false` once it
 * is given a width, and a typed signature that wrapped put its second line through the `Signature`
 * caption under the rule. Seen on the first raster of a long-name fixture. A name is one line on a
 * signature rule; a smaller one is still the name, a wrapped one overprints the paper.
 */
function onRule(doc: PDFKit.PDFDocument, value: string, x: number, y: number, width: number, font = "Helvetica", size = 11): void {
  const v = winAnsi(value);
  let fit = size;
  doc.font(font);
  while (fit > 7 && doc.fontSize(fit).widthOfString(v) > width - 4) fit -= 0.5;
  doc.fillColor(INK).fontSize(fit).text(v, x + 2, y - fit - 2, { lineBreak: false });
}

/**
 * The mark in the box: the drawn picture if there is one, the typed name otherwise (D-APP8).
 *
 * ⚠ Wrapped for `drawnMark`'s reason (`instrumentPages.ts`): these bytes came from a canvas on a
 * stranger's phone, and pdfkit throws on anything that is not a PNG or JPEG. A bad upload costs the
 * picture, and the typed name that is the signature of record is drawn instead.
 */
function mark(doc: PDFKit.PDFDocument, signer: NonNullable<PermissionInstrumentInput["signer"]>, top: number): void {
  const { width, height } = PERMISSION_SIGNATURE_BOX;
  if (signer.mark) {
    try {
      doc.image(signer.mark, MARGIN + 2, top + 2, { fit: [width - 4, height - 6], valign: "bottom" });
      return;
    } catch (e) {
      console.warn("[application] the drawn signature mark could not be rendered", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  onRule(doc, signer.name, MARGIN, top + height, width, "Helvetica-Oblique", 16);
}

function signatureBlock(doc: PDFKit.PDFDocument, input: PermissionInstrumentInput, named: boolean): void {
  // Kept whole on one sheet: a box on one page and its date on the next is not a signature block.
  if (doc.y + BLOCK_HEIGHT > PAGE_HEIGHT - doc.page.margins.bottom) doc.addPage();
  const { width, height } = PERMISSION_SIGNATURE_BOX;
  const top = doc.y;
  const line = top + height;
  const dateX = MARGIN + width + 40;

  // ⚠ `top` as pdfkit measures it, NOT `PAGE_HEIGHT - top`: pdfkit flips an XYZ destination's y into
  // PDF space itself. Flipping it here as well put the box at y54 on a page where it was drawn at y738,
  // which only a box at the top of a sheet made visible (previous_employer, first render).
  if (named) doc.addNamedDestination(PERMISSION_SIGNATURE_DESTINATION, "XYZ", MARGIN, top, null);
  blank(doc, MARGIN, line, width, "Signature");
  blank(doc, dateX, line, DATE_WIDTH, "Date");

  const nameLine = line + 14 + ROW_GAP + 18;
  blank(doc, MARGIN, nameLine, width, isPsp(input.purpose) ? "Name (Please Print)" : "Printed name");

  if (input.signer) {
    mark(doc, input.signer, top);
    // ⚠ The UTC calendar day of the moment it was signed, as every other signed date in these
    // documents prints it (`packetDraw.ts`'s `date`). MM/DD/YYYY from the one definition.
    onRule(doc, formatDisplayDate(input.signer.signedAt.slice(0, 10), ""), dateX, line, DATE_WIDTH);
    onRule(doc, input.signer.name, MARGIN, nameLine, width);
  }
  doc.x = MARGIN;
  doc.y = nameLine + 14 + ROW_GAP;
}

/**
 * Draw one instrument from the CURRENT page's cursor. The caller owns the page: the standalone PDF
 * starts on its first page, and B2 adds a page per instrument.
 *
 * ⚠ `nameSignatureBox` only for the applicant's standalone copy. B2 draws five instruments into one
 * file, and five destinations sharing one name in one name tree is a malformed tree with a place to
 * sign on a document nobody signs.
 */
export function drawPermissionInstrument(
  doc: PDFKit.PDFDocument,
  input: PermissionInstrumentInput,
  opts: { nameSignatureBox?: boolean } = {},
): void {
  const psp = isPsp(input.purpose);
  if (!psp) letterhead(doc, input);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(psp ? 13 : 15)
    .text(winAnsi(input.title), MARGIN, doc.y, { width: CONTENT_WIDTH, align: psp ? "center" : "left" });
  if (!psp) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(CAPTION_SIZE)
      .text(winAnsi(`Version ${input.version}`), MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
  }
  doc.moveDown(1);

  const { before, after } = paragraphs(input);
  for (const p of before) {
    // FMCSA sets its one-word `AUTHORIZATION` as a centred heading; the word is unchanged.
    if (psp && p === "AUTHORIZATION") text(doc, p, "Helvetica-Bold", 11, { align: "center" });
    else text(doc, p, "Helvetica", BODY_SIZE);
    doc.moveDown(BODY_GAP / BODY_SIZE);
  }
  doc.moveDown(0.4);
  /**
   * ⚠ **The sentence the signer affirms and the block they sign it in stay on ONE sheet.** The first
   * B2 render put previous_employer's signature block alone on a page of its own, under a band and
   * nothing else, a sheet away from *"By signing below, I certify…"*. A signature with nothing above it
   * signs nothing a reader can see. So the intent is measured with the block, and the page turns
   * BEFORE the intent when both will not fit. ⚠ Measured in the font it is drawn in, set first:
   * `heightOfString` measures in whatever font is current (the pdfkit trap that moved a line by
   * 1.04pt in the packet).
   */
  doc.font("Helvetica-Bold").fontSize(BODY_SIZE);
  const intentHeight = doc.heightOfString(winAnsi(input.intent), { width: CONTENT_WIDTH, lineGap: 1.5 });
  const leadIn = doc.currentLineHeight(true) * 1.6;
  if (doc.y + intentHeight + leadIn + BLOCK_HEIGHT > PAGE_HEIGHT - doc.page.margins.bottom) doc.addPage();
  text(doc, input.intent, "Helvetica-Bold", BODY_SIZE);
  doc.moveDown(1.6);

  signatureBlock(doc, input, opts.nameSignatureBox === true);

  for (const p of after) {
    text(doc, p, "Helvetica", 8.5);
    doc.moveDown(0.5);
  }
}

/** The instrument alone, as the applicant reads and signs it: no band, no footer, no other page. */
export async function permissionInstrumentPdf(input: PermissionInstrumentInput): Promise<Buffer> {
  const { doc, done } = newDrawing(input.title);
  drawPermissionInstrument(doc, input, { nameSignatureBox: true });
  doc.end();
  return done;
}
