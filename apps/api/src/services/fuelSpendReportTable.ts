/**
 * The report's table.
 *
 * ── WHY IT IS NOT `dqBinder/pdfDraw`'s TABLE ────────────────────────────────────────────────────
 * That one is a checklist: an auditor works down it item by item, so it rules every row, sets 9pt
 * left-aligned text, and renders an empty cell as an em-dash because in a checklist an empty cell IS a
 * missing answer. All three of those are wrong for a figure table that a reader scans ACROSS a row and
 * DOWN a column: the rules turn twelve weeks of fuel into a grid, and the em-dash turned a layout
 * gutter into "no data" (see `rankedBars`).
 *
 * So this one bands instead of ruling, keeps the header on every page, renders an empty cell as
 * nothing, and can encode one column as a bar. The binder's table is untouched.
 *
 * ── THE BAR COLUMN ──────────────────────────────────────────────────────────────────────────────
 * One column may carry `bar: true`, which draws each row's value as a proportional track under the
 * number. It is deliberately limited to ONE column. Two encoded columns in a nine-column table is a
 * chart pretending to be a table, and the reader stops trusting either reading.
 */
import { C, CONTENT_W, GEOM, T } from "./fuelSpendReportTheme.js";
import { fit, label } from "./fuelSpendReportCharts.js";

const M = GEOM.margin;
const RIGHT = GEOM.pageWidth - GEOM.margin;
const ROW_H = 19;
const HEAD_H = 15;

export interface Column {
  /**
   * Width in points. The caller's widths must sum to `CONTENT_W` or less, or the last column is drawn
   * past the right margin and simply cut in half.
   *
   * Every table in the document is pinned by `fuelSpendReport.widths.test.ts`, one scenario each:
   * "keeps the period table inside the content width", "and the policy-exception summary", and
   * "and the largest-overcharges table". A column widened in a section fails there rather than in a
   * rendered PDF nobody re-reads.
   */
  width: number;
  header: string;
  align?: "left" | "right";
  /** Encode this column's `value` as a proportional bar under the number. At most one per table. */
  bar?: boolean;
  /** The bar's colour. Defaults to the neutral grey, which is right for a quantity with no verdict. */
  barColor?: string;
  /**
   * Anchor the bar at this value instead of at zero, drawing each row as a DEVIATION from it.
   *
   * ── WHY THE PERIOD TABLE NEEDS THIS AND THE EXCEPTION TABLE DOES NOT ──────────────────────────
   * A zero-anchored bar is only readable when the values reach toward zero. Twelve weeks of fuel spend
   * run $11,706 to $15,038 — every bar came out between 78% and 100% of the track, which is a row of
   * near-identical full-width rails sitting directly under a right-aligned figure. It did not read as
   * a chart at all; it read as though every number in the column had been underlined, and it carried
   * no information because the differences it was supposed to show were compressed into the last fifth
   * of the track.
   *
   * Anchored at the window average instead, the same column answers the question somebody actually
   * scans a period table for: which weeks were heavy. Policy excess keeps its zero anchor, because
   * there the distance to zero is the finding.
   */
  barBaseline?: number;
}

export interface Cell {
  text: string;
  /** The magnitude behind the text, for a `bar` column. Absent means no bar on this row. */
  value?: number;
  bold?: boolean;
  color?: string;
  /** A second, smaller line under the value — "in progress" under a period still filling. */
  sub?: string;
}

export interface Row {
  cells: Cell[];
  /**
   * Draw this row as the one the reader came for — a mark-coloured spine and a heavier wash.
   *
   * Used for the newest period. In a table sorted newest-first the top row is already where the eye
   * lands, but the same table at day grain runs to sixty rows across two pages, and after a break
   * "the latest week" is just another row.
   */
  emphasis?: boolean;
}

/**
 * A banded figure table that repeats its header across pages.
 *
 * Rows are a fixed height rather than measured. Every cell in this document is a formatted number or a
 * short label that fits its column, and anything that does not fit is cut by `fit` rather than wrapped.
 * A measured-height table exists to survive prose in a cell, which this one never has, and fixed rows
 * keep the banding regular — which is the whole point of banding.
 */
export function figureTable(doc: PDFKit.PDFDocument, columns: readonly Column[], rows: readonly Row[]): void {
  const barMax = barScale(columns, rows);
  drawHeader(doc, columns);

  rows.forEach((row, i) => {
    const height = row.cells.some((c) => c.sub) ? ROW_H + 9 : ROW_H;
    if (doc.y + height > GEOM.contentBottom) {
      doc.addPage();
      drawHeader(doc, columns);
    }
    const top = doc.y;

    if (row.emphasis) {
      doc.save().rect(M, top, CONTENT_W, height).fillColor(C.markWash).fill().restore();
      doc.save().rect(M, top, 2, height).fillColor(C.mark).fill().restore();
    } else if (i % 2 === 1) {
      doc.save().rect(M, top, CONTENT_W, height).fillColor(C.wash).fill().restore();
    }

    let x = M;
    columns.forEach((col, ci) => {
      const cell = row.cells[ci];
      if (!cell) { x += col.width; return; }
      const pad = ci === 0 ? 8 : 0;
      const cellW = col.width - 6 - pad;
      doc.fillColor(cell.color ?? C.ink)
        .font(cell.bold || row.emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(T.body);
      doc.text(fit(doc, cell.text, cellW), x + pad, top + 4, { width: cellW, align: col.align ?? "left", lineBreak: false });
      if (cell.sub) {
        doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro);
        doc.text(fit(doc, cell.sub, cellW), x + pad, top + 15, { width: cellW, align: col.align ?? "left", lineBreak: false });
      }
      if (col.bar && cell.value != null && barMax > 0) {
        // The TRACK is what makes either form read as a bar. Without it the filled length alone sat
        // under a right-aligned figure and looked like an underline on the number.
        const trackW = col.width - 8;
        // Anchored to the TOP of the row, not to its bottom. Anchored to the bottom, the bar drifted
        // away from the figure it encodes as soon as a row grew a sub-caption — in the exception table
        // it ended up floating on the boundary between two rows, reading as a divider rather than as
        // the excess it measures. 16pt clears the 9pt line above it in every row height there is.
        const by = top + 16;
        const fill = col.barColor ?? C.neutral;
        doc.save().rect(x + 2, by, trackW, 2.5).fillColor(C.hairline).fill().restore();
        if (col.barBaseline == null) {
          const w = Math.max(0.8, (Math.abs(cell.value) / barMax) * trackW);
          doc.save().rect(x + 2 + trackW - w, by, w, 2.5)
            .fillColor(fill).opacity(row.emphasis ? 1 : 0.75).fill().restore();
        } else {
          const mid = x + 2 + trackW / 2;
          const dev = cell.value - col.barBaseline;
          const w = Math.max(0.8, (Math.abs(dev) / barMax) * (trackW / 2));
          doc.save().rect(dev >= 0 ? mid : mid - w, by, w, 2.5)
            .fillColor(fill).opacity(row.emphasis ? 1 : 0.75).fill().restore();
          doc.save().rect(mid - 0.25, by - 1.5, 0.5, 5.5).fillColor(C.inkSubtle).fill().restore();
        }
      }
      x += col.width;
    });

    doc.x = M;
    doc.y = top + height;
  });

  doc.save().lineWidth(0.5).strokeColor(C.rule).moveTo(M, doc.y).lineTo(RIGHT, doc.y).stroke().restore();
  doc.y += 10;
}

/**
 * A closing row for a figure table — the window's own totals, under the rule.
 *
 * Without it the table's twelve rows are twelve periods and nothing adds them up, so the reader either
 * takes the headline card's figure on faith or reaches for a calculator. Drawn in the same columns so
 * a total sits under the column it totals.
 */
export function totalRow(doc: PDFKit.PDFDocument, columns: readonly Column[], cells: readonly Cell[]): void {
  const top = doc.y - 6;
  let x = M;
  columns.forEach((col, ci) => {
    const cell = cells[ci];
    if (!cell) { x += col.width; return; }
    const pad = ci === 0 ? 8 : 0;
    const cellW = col.width - 6 - pad;
    doc.fillColor(cell.color ?? C.ink).font("Helvetica-Bold").fontSize(T.body);
    doc.text(fit(doc, cell.text, cellW), x + pad, top, { width: cellW, align: col.align ?? "left", lineBreak: false });
    x += col.width;
  });
  doc.x = M;
  doc.y = top + ROW_H;
}

function drawHeader(doc: PDFKit.PDFDocument, columns: readonly Column[]): void {
  const top = doc.y;
  let x = M;
  for (const col of columns) {
    // Right-aligned headers are pulled 6pt left of their column edge, the same inset the numbers under
    // them get, so a column header sits over its own digits rather than over the gap to the next one.
    label(doc, col.header, x + (col.align === "right" ? 0 : 8), top + 4, col.width - 6, C.inkSubtle, col.align ?? "left");
    x += col.width;
  }
  doc.save().lineWidth(0.8).strokeColor(C.rule)
    .moveTo(M, top + HEAD_H).lineTo(RIGHT, top + HEAD_H).stroke().restore();
  doc.x = M;
  doc.y = top + HEAD_H + 2;
}

/**
 * The largest magnitude in the bar column, so every row on every page is scaled to the same maximum.
 *
 * Computed across ALL rows before the first one is drawn, which is why a table that breaks over two
 * pages keeps one scale. Scaling per page would make the same $13,495 a different length on page 2.
 */
function barScale(columns: readonly Column[], rows: readonly Row[]): number {
  const idx = columns.findIndex((c) => c.bar);
  if (idx < 0) return 0;
  const base = columns[idx]?.barBaseline ?? 0;
  return Math.max(0, ...rows.map((r) => Math.abs((r.cells[idx]?.value ?? base) - base)));
}
