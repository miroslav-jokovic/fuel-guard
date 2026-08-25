/**
 * The page furniture: letterhead, running head, section heads, the verdict band, footers.
 *
 * Everything here is about ORIENTATION rather than about data — where the reader is, what they are
 * looking at, and where it came from. The marks themselves are in `fuelSpendReportCharts`, and the
 * tokens both files draw with are in `fuelSpendReportTheme`.
 *
 * ── WHY A DOCUMENT NEEDS THIS MUCH FURNITURE ────────────────────────────────────────────────────
 * This report exists to be forwarded. That means a page of it will be printed, pulled out of the
 * stack, and quoted on its own by somebody who never saw page 1 — so every page has to carry the
 * carrier, the window and the provenance, and every section has to be findable by number. A page of an
 * analytical PDF with no running head is a page of anonymous numbers the moment it leaves the file.
 */
import { C, CONTENT_W, GEOM, T, TRACK_LABEL } from "./fuelSpendReportTheme.js";
import { winAnsi } from "./dqBinder/pdfDraw.js";
import { label } from "./fuelSpendReportCharts.js";

const M = GEOM.margin;
const RIGHT = GEOM.pageWidth - GEOM.margin;

// ── body text ───────────────────────────────────────────────────────────────────────────────────

/** The report's reading size. Used for the sentence a section leads with. */
export function lead(doc: PDFKit.PDFDocument, text: string): void {
  doc.fillColor(C.ink).font("Helvetica").fontSize(T.subhead)
    .text(winAnsi(text), M, doc.y, { width: CONTENT_W, lineGap: 1.2 });
  doc.moveDown(0.45);
}

/** Supporting prose — the caveats, the coverage, the reason a figure is what it is. */
export function note(doc: PDFKit.PDFDocument, text: string, color: string = C.inkMuted): void {
  doc.fillColor(color).font("Helvetica").fontSize(T.small)
    .text(winAnsi(text), M, doc.y, { width: CONTENT_W, lineGap: 1 });
  doc.moveDown(0.4);
}

/**
 * A refusal: something the report will not say, and why.
 *
 * Set apart with a rule rather than folded into the prose, because a withheld figure is the one thing
 * in the document a reader must not skim past thinking they read a number. The bridge withholds its
 * miles/efficiency split on thin odometer coverage, and that refusal is more important than most of
 * the figures around it.
 */
export function withheld(doc: PDFKit.PDFDocument, text: string): void {
  const top = doc.y;
  doc.fillColor(C.warn).font("Helvetica").fontSize(T.small)
    .text(winAnsi(text), M + 10, top, { width: CONTENT_W - 10, lineGap: 1 });
  doc.save().lineWidth(1.6).strokeColor(C.warn).opacity(0.55)
    .moveTo(M + 2, top + 1).lineTo(M + 2, doc.y - 1).stroke().restore();
  doc.x = M;
  doc.moveDown(0.5);
}

// ── letterhead ──────────────────────────────────────────────────────────────────────────────────

export interface MetaField {
  label: string;
  value: string;
}

/**
 * Carrier, report name, window — and the scope strip that says what the numbers were filtered to.
 *
 * ── WHY THE FILTERS ARE ON THE LETTERHEAD AND NOT IN A FOOTNOTE ─────────────────────────────────
 * A report that quietly covered every truck while the screen showed three is a document somebody acts
 * on and cannot reconcile later. The old version ran the period, the grain and the truck scope
 * together into one grey sentence under the title — technically present, and read by nobody. Four
 * labelled fields in a strip is the same information at the same cost, in the shape a reader actually
 * scans.
 */
export function letterhead(
  doc: PDFKit.PDFDocument,
  carrier: string,
  reportTitle: string,
  standfirst: string,
  meta: readonly MetaField[],
): void {
  doc.save().rect(M, M, CONTENT_W, 2.5).fillColor(C.mark).fill().restore();

  // Every vertical position here is set from `top`, never accumulated onto whatever `doc.text` left
  // `doc.y` at. Accumulating opened a 40pt hole between the title and its standfirst, because a 25pt
  // display line advances `doc.y` by its own leading before the explicit nudge is added to it.
  const top = M + 12;
  label(doc, carrier, M, top, CONTENT_W - 120, C.mark);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.display)
    .text(winAnsi(reportTitle), M, top + 14, { width: CONTENT_W, lineBreak: false });
  doc.fillColor(C.inkMuted).font("Helvetica").fontSize(T.body)
    .text(winAnsi(standfirst), M, top + 46, { width: CONTENT_W });

  doc.x = M;
  doc.y = top + 62;
  metaStrip(doc, meta);
}

/** The labelled scope fields, in a wash strip the eye reads as one object. */
export function metaStrip(doc: PDFKit.PDFDocument, meta: readonly MetaField[]): void {
  if (meta.length === 0) return;
  const height = 34;
  const top = doc.y;
  doc.save().roundedRect(M, top, CONTENT_W, height, GEOM.radius).fillColor(C.wash).fill().restore();

  const w = CONTENT_W / meta.length;
  meta.forEach((f, i) => {
    const x = M + i * w;
    if (i > 0) {
      doc.save().lineWidth(0.5).strokeColor(C.hairline)
        .moveTo(x, top + 7).lineTo(x, top + height - 7).stroke().restore();
    }
    label(doc, f.label, x + 11, top + 8, w - 20, C.inkSubtle);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.small)
      .text(winAnsi(f.value), x + 11, top + 18, { width: w - 20, lineBreak: false });
  });

  doc.x = M;
  doc.y = top + height + 18;
}

// ── sections ────────────────────────────────────────────────────────────────────────────────────

/**
 * A numbered section head: numeral, title, and a rule running to the right margin.
 *
 * The numeral is what makes a section quotable on the phone — "look at three, the California one" — and
 * the rule is what makes the section boundary survive a page that is otherwise wall-to-wall figures.
 * The old headings were navy text with nothing else, which at 12pt inside a page of 9pt tables is not
 * enough of a break for the eye to find.
 */
export function sectionHead(doc: PDFKit.PDFDocument, n: number, title: string, standfirst?: string): void {
  doc.moveDown(0.5);
  const top = doc.y;
  const numeral = String(n).padStart(2, "0");

  doc.fillColor(C.mark).font("Helvetica-Bold").fontSize(T.section)
    .text(numeral, M, top, { width: 24, lineBreak: false });
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.section)
    .text(winAnsi(title), M + 26, top, { width: CONTENT_W - 26, lineBreak: false });

  const titleW = doc.widthOfString(winAnsi(title)) + 34;
  if (titleW < CONTENT_W - 24) {
    doc.save().lineWidth(0.5).strokeColor(C.hairline)
      .moveTo(M + titleW, top + T.section * 0.55).lineTo(RIGHT, top + T.section * 0.55).stroke().restore();
  }
  doc.x = M;
  doc.y = top + T.section + 6;

  if (standfirst) {
    doc.fillColor(C.inkMuted).font("Helvetica").fontSize(T.small)
      .text(winAnsi(standfirst), M, doc.y, { width: CONTENT_W, lineGap: 1 });
    doc.moveDown(0.5);
  }
}

/**
 * The answer, at the top of page 1, before any section.
 *
 * ── WHY IT IS THE FIRST THING ON THE PAGE ───────────────────────────────────────────────────────
 * Somebody reads one sentence of a forwarded report and this is the sentence. The old document buried
 * it inside "Why spend moved", a third of the way down page 1, in the same 9.5pt grey as the coverage
 * caveats around it — so the document's actual conclusion had exactly the same visual weight as a note
 * about odometer intervals. A band the eye cannot skip is not decoration; it is the difference between
 * a report that gets acted on and one that gets filed.
 */
export function verdictBand(doc: PDFKit.PDFDocument, sentence: string, support?: string): void {
  const padX = 14;
  const top = doc.y;
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.section);
  const h1 = doc.heightOfString(winAnsi(sentence), { width: CONTENT_W - padX - 16, lineGap: 1.5 });
  doc.font("Helvetica").fontSize(T.small);
  const h2 = support ? doc.heightOfString(winAnsi(support), { width: CONTENT_W - padX - 16, lineGap: 1 }) + 5 : 0;
  const height = h1 + h2 + 22;

  doc.save().roundedRect(M, top, CONTENT_W, height, GEOM.radius).fillColor(C.markWash).fill().restore();
  doc.save().rect(M, top + 2, 2.5, height - 4).fillColor(C.mark).fill().restore();

  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.section)
    .text(winAnsi(sentence), M + padX, top + 11, { width: CONTENT_W - padX - 16, lineGap: 1.5 });
  if (support) {
    doc.fillColor(C.inkSecondary).font("Helvetica").fontSize(T.small)
      .text(winAnsi(support), M + padX, doc.y + 4, { width: CONTENT_W - padX - 16, lineGap: 1 });
  }

  doc.x = M;
  doc.y = top + height + 16;
}

/**
 * Start a new page when less than `needed` points remain.
 *
 * `table` moves a ROW that would straddle a break, but nothing stops a heading and a column header
 * being drawn in the last inch of a page with their rows on the next one — which is exactly how
 * "Avoided brands" and its SITE / FILLS header came out marooned at the foot of page 1. A block that
 * cannot show at least its header and a couple of rows is better started overleaf.
 */
export function keepTogether(doc: PDFKit.PDFDocument, needed = 96): void {
  if (doc.y + needed > GEOM.contentBottom) doc.addPage();
}

// ── page stamps ─────────────────────────────────────────────────────────────────────────────────

/**
 * Stamp every page with its number, its provenance, and — from page 2 — a running head.
 *
 * Requires `bufferPages: true`: the total is not known until the document is finished, and a footer
 * that says "Page 1 of 1" on a four-page report is worse than no footer.
 *
 * ⚠ The footer sits BELOW the bottom margin, and pdfkit answers a write past the margin by starting a
 * new page — which is then itself stamped, and so on. The first render of this report came out six
 * pages for two pages of content. Dropping the margin for the duration of the stamp is the fix;
 * `text()` has no "do not paginate" option.
 */
export function stampPages(doc: PDFKit.PDFDocument, runningHead: string, provenance: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    const top = doc.page.margins.top;
    doc.page.margins.bottom = 0;
    doc.page.margins.top = 0;

    if (i > range.start) {
      doc.fillColor(C.inkSubtle).font("Helvetica-Bold").fontSize(T.micro)
        .text(winAnsi(runningHead.toUpperCase()), M, M - 16, {
          width: CONTENT_W, characterSpacing: TRACK_LABEL, lineBreak: false,
        });
      doc.save().lineWidth(0.5).strokeColor(C.hairline)
        .moveTo(M, M - 4).lineTo(RIGHT, M - 4).stroke().restore();
    }

    const y = GEOM.pageHeight - M + 4;
    doc.save().lineWidth(0.5).strokeColor(C.hairline).moveTo(M, y - 10).lineTo(RIGHT, y - 10).stroke().restore();
    doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro)
      .text(winAnsi(provenance), M, y - 3, { width: CONTENT_W - 46, lineBreak: false });
    doc.fillColor(C.inkMuted).font("Helvetica-Bold").fontSize(T.micro)
      .text(`${i - range.start + 1} / ${range.count}`, RIGHT - 46, y - 3, { width: 46, align: "right", lineBreak: false });

    doc.page.margins.bottom = bottom;
    doc.page.margins.top = top;
  }
}
