/**
 * The drawings the fuel-spend report needs and the DQ binder's toolkit does not have: a KPI row, a
 * signed waterfall, and a letterhead/footer for a document that goes to somebody who did not ask for
 * it and will not read a legend.
 *
 * Everything else — colours, margins, `table`, `heading`, `winAnsi` — is `dqBinder/pdfDraw`, on purpose.
 * A second PDF house style in one product is how two documents from the same system start looking like
 * they came from different companies.
 */
import {
  CONTENT_WIDTH, INK, MARGIN, MUTED, NAVY, PAGE_HEIGHT, PAGE_WIDTH, RULE, DANGER, OK,
  winAnsi,
} from "./dqBinder/pdfDraw.js";

export interface Kpi {
  label: string;
  value: string;
  /** Period-over-period change, already formatted. */
  delta?: string;
  /**
   * Whether THIS movement was bad — the direction already applied, not "which way would be bad".
   *
   * It was the latter for one draft, and every spend tile rendered red whether spend rose or fell,
   * because the flag never met the sign. The caller knows both the direction and which way is good,
   * so it resolves them and hands over the verdict.
   */
  deltaIsBad?: boolean;
}

const KPI_HEIGHT = 52;
const GAP = 8;

/**
 * A row of KPI boxes across the content width.
 *
 * The delta carries its own colour because the direction IS the message: a report whose headline
 * figures are all one shade makes the reader do the comparison the report exists to have done for them.
 */
export function kpiRow(doc: PDFKit.PDFDocument, kpis: Kpi[]): void {
  if (kpis.length === 0) return;
  const w = (CONTENT_WIDTH - GAP * (kpis.length - 1)) / kpis.length;
  const top = doc.y;

  kpis.forEach((k, i) => {
    const x = MARGIN + i * (w + GAP);
    doc.save().roundedRect(x, top, w, KPI_HEIGHT, 3).lineWidth(0.5).strokeColor(RULE).stroke().restore();
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(6.5)
      .text(winAnsi(k.label.toUpperCase()), x + 8, top + 8, { width: w - 16, lineBreak: false });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14)
      .text(winAnsi(k.value), x + 8, top + 19, { width: w - 16, lineBreak: false });
    if (k.delta) {
      doc.fillColor(k.deltaIsBad === undefined ? MUTED : k.deltaIsBad ? DANGER : OK)
        .font("Helvetica").fontSize(7)
        .text(winAnsi(k.delta), x + 8, top + 37, { width: w - 16, lineBreak: false });
    }
  });

  doc.x = MARGIN;
  doc.y = top + KPI_HEIGHT + 14;
}

export interface WaterfallBar {
  label: string;
  /** Positive pushed spend UP. */
  dollars: number;
  detail: string;
}

const BAR_H = 13;
const ROW_H = 26;
const LABEL_W = 118;
const VALUE_W = 74;

/**
 * A signed waterfall: each component's bar grows from a shared centre line, right for money added and
 * left for money saved.
 *
 * Centre-anchored rather than stacked because the reader's question is "which of these is the big one",
 * and a stacked waterfall answers "what order did they happen in" — an order these components do not
 * have. The zero line makes a saving visually the opposite of a cost instead of a shorter bar.
 */
export function waterfall(doc: PDFKit.PDFDocument, bars: WaterfallBar[], total: number): void {
  if (bars.length === 0) return;
  const trackX = MARGIN + LABEL_W;
  const trackW = CONTENT_WIDTH - LABEL_W - VALUE_W - 10;
  const centre = trackX + trackW / 2;
  const widest = Math.max(1, ...bars.map((b) => Math.abs(b.dollars)));
  const half = trackW / 2 - 2;
  const firstTop = doc.y;

  for (const b of bars) {
    const top = doc.y;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5)
      .text(winAnsi(b.label), MARGIN, top + 1, { width: LABEL_W - 8, lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5)
      .text(winAnsi(b.detail), MARGIN, top + 11, { width: LABEL_W - 8, lineBreak: false });

    const len = Math.max(1.5, (Math.abs(b.dollars) / widest) * half);
    const up = b.dollars >= 0;
    doc.save()
      .roundedRect(up ? centre : centre - len, top + 1, len, BAR_H, 1.5)
      .fillColor(up ? DANGER : OK).opacity(0.82).fill()
      .restore();

    doc.fillColor(up ? DANGER : OK).font("Helvetica-Bold").fontSize(9)
      .text(winAnsi(money(b.dollars)), trackX + trackW + 10, top + 3, { width: VALUE_W, align: "right", lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5)
      .text(winAnsi(total === 0 ? "" : `${Math.round((b.dollars / total) * 100)}%`),
        trackX + trackW + 10, top + 14, { width: VALUE_W, align: "right", lineBreak: false });

    doc.y = top + ROW_H;
  }

  // The zero line last, so it sits over the bars and the eye reads it as the axis it is. Anchored to the
  // top captured before the loop — reconstructing it from `doc.y` afterwards drew it a row short and
  // faint enough to look like a rendering artifact rather than an axis.
  doc.save().strokeColor(INK).lineWidth(0.6).opacity(0.45)
    .moveTo(centre, firstTop - 2).lineTo(centre, firstTop + ROW_H * (bars.length - 1) + BAR_H + 3).stroke().restore();
  doc.x = MARGIN;
  doc.moveDown(0.5);
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
  if (doc.y + needed > PAGE_HEIGHT - MARGIN - 18) doc.addPage();
}

export function money(n: number): string {
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return `${n < 0 ? "-" : "+"}$${v}`;
}

/** Carrier name, report name, period. Drawn once at the top of page 1. */
export function letterhead(doc: PDFKit.PDFDocument, carrier: string, reportTitle: string, period: string): void {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(winAnsi(carrier.toUpperCase()), MARGIN, MARGIN);
  doc.moveDown(0.35);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(19).text(winAnsi(reportTitle));
  doc.moveDown(0.15);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(winAnsi(period));
  doc.moveDown(0.5);
  doc.save().strokeColor(NAVY).lineWidth(1.4)
    .moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke().restore();
  doc.moveDown(0.8);
}

/**
 * Stamp every page with its number and where the figures came from.
 *
 * Requires `bufferPages: true` — the total is not known until the document is finished, and a footer
 * that says "Page 1 of 1" on a four-page report is worse than no footer.
 */
export function stampFooters(doc: PDFKit.PDFDocument, provenance: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // The footer sits BELOW the bottom margin, and pdfkit answers a write past the margin by starting a
    // new page — which is then itself stamped, and so on. The first render of this report came out six
    // pages for two pages of content. Dropping the margin for the duration of the stamp is the fix;
    // `text()` has no "do not paginate" option.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE_HEIGHT - MARGIN + 2;
    doc.save().strokeColor(RULE).lineWidth(0.5).moveTo(MARGIN, y - 8).lineTo(PAGE_WIDTH - MARGIN, y - 8).stroke().restore();
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5)
      .text(winAnsi(provenance), MARGIN, y - 2, { width: CONTENT_WIDTH - 60, lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5)
      .text(`${i - range.start + 1} / ${range.count}`, PAGE_WIDTH - MARGIN - 60, y - 2, { width: 60, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
