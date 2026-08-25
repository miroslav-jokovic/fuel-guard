/**
 * The marks this document draws — sparkline, waterfall, proportion bar, ranked bars.
 *
 * ── WHY A REPORT THIS SMALL NEEDS CHARTS AT ALL ─────────────────────────────────────────────────
 * The version this replaced printed twelve weeks of fuel spend as twelve rows of nine right-aligned
 * numbers and asked the reader to difference them by eye. Every figure was correct and the trend —
 * which is the entire question the report is named after — was invisible. A reader who wants to know
 * whether fuel is getting worse should not have to subtract.
 *
 * So each number that has a shape gets its shape drawn beside it, at the smallest size that still
 * reads. Nothing here invents a figure: every function takes finished values and puts marks on a page,
 * exactly as the sections do, so a chart cannot disagree with the table under it.
 *
 * ── THE COLOUR RULE ─────────────────────────────────────────────────────────────────────────────
 * A mark is coloured by its VERDICT, never by its series. Money added is `C.bad`, money saved is
 * `C.good`, a quantity with no verdict attached is `C.neutral`. The first draft of the old waterfall
 * coloured by "which direction would be bad" rather than by which direction it actually went, and every
 * tile came out red whether spend rose or fell.
 */
import { C, CONTENT_W, GEOM, T, TRACK_LABEL } from "./fuelSpendReportTheme.js";
import { winAnsi } from "./dqBinder/pdfDraw.js";
import { gap, withoutAutoBreak } from "./fuelSpendReportFlow.js";

const M = GEOM.margin;

/**
 * Text clipped to a width, with an ellipsis when it does not fit.
 *
 * ── WHY `lineBreak: false` IS NOT ENOUGH ────────────────────────────────────────────────────────
 * It is documented as disabling wrapping and it does not reliably do so when a `width` is also given:
 * the TRUCKS column header came out as "TRUCK" over "S", and "Avoided brands (ONE9 and other
 * off-brand)" wrapped onto the line its own sub-caption was already drawn on. Both were passing
 * `lineBreak: false`. Measuring and cutting is the only version that cannot wrap, and a visible
 * ellipsis is a better failure than two overlapping lines.
 *
 * The caller must have set the font and size already — `widthOfString` measures the CURRENT font.
 */
export function fit(doc: PDFKit.PDFDocument, text: string, width: number): string {
  const t = winAnsi(text);
  if (doc.widthOfString(t) <= width) return t;
  let cut = t;
  while (cut.length > 1 && doc.widthOfString(`${cut}...`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** A label in the small tracked caps this document uses for every caption. */
export function label(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, color: string = C.inkMuted, align: "left" | "right" = "left"): void {
  doc.fillColor(color).font("Helvetica-Bold").fontSize(T.micro);
  doc.text(fit(doc, text.toUpperCase(), w), x, y, { width: w, align, characterSpacing: TRACK_LABEL, lineBreak: false });
}

// ── sparkline ───────────────────────────────────────────────────────────────────────────────────

/**
 * A line with a soft fill under it, and the last point marked.
 *
 * Deliberately AXIS-FREE and unlabelled. It sits inside a KPI card whose value is the last point and
 * whose caption is the period, so an axis would repeat what is already printed an inch away. What it
 * adds is the one thing the number cannot carry: whether this is where the series has been sitting or
 * where it has just arrived.
 *
 * Scaled to its own min/max rather than to zero. A zero baseline on twelve weeks of fuel spend that
 * never varies by more than 15% draws a flat line and says nothing; the question is the variation.
 */
export function sparkline(
  doc: PDFKit.PDFDocument,
  values: readonly (number | null)[],
  x: number, y: number, w: number, h: number,
  color: string,
): void {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v));
  if (pts.length < 2) return;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const n = values.length - 1 || 1;
  const px = (i: number) => x + (i / n) * w;
  // 1.5pt of padding top and bottom so the extreme points are not clipped by the card's own edge.
  const py = (v: number) => y + h - 1.5 - ((v - lo) / span) * (h - 3);

  doc.save();
  doc.moveTo(px(pts[0]!.i), y + h);
  for (const p of pts) doc.lineTo(px(p.i), py(p.v));
  doc.lineTo(px(pts[pts.length - 1]!.i), y + h).closePath().fillColor(color).opacity(0.1).fill();
  doc.restore();

  doc.save().lineWidth(0.9).strokeColor(color).opacity(0.85);
  doc.moveTo(px(pts[0]!.i), py(pts[0]!.v));
  for (const p of pts.slice(1)) doc.lineTo(px(p.i), py(p.v));
  doc.stroke().restore();

  const last = pts[pts.length - 1]!;
  doc.save().circle(px(last.i), py(last.v), 1.6).fillColor(color).fill().restore();
}

// ── KPI strip ───────────────────────────────────────────────────────────────────────────────────

export interface Metric {
  label: string;
  value: string;
  /** What the value is a total OF — "12 weeks", "week to Aug 23". Never omitted; see `metricStrip`. */
  scope: string;
  /** Period-over-period change, already formatted. */
  delta?: string;
  /** Whether THIS movement was bad — the direction already applied, not "which way would be bad". */
  deltaIsBad?: boolean;
  /** One point per period, oldest first. Nulls are gaps, not zeroes. */
  trend?: readonly (number | null)[];
}

const CARD_H = 66;
const CARD_GAP = 7;

/**
 * The headline row: one card per metric, each carrying its own trend.
 *
 * ── THE BUG THIS SHAPE EXISTS TO KILL ───────────────────────────────────────────────────────────
 * The old KPI row printed the LAST COMPLETE BUCKET's figures under bare labels — "FUEL SPEND $13,495"
 * at the top of a document whose letterhead said "2026-06-01 to 2026-08-23". The report covered twelve
 * weeks and its headline number was one week's spend, with nothing on the page saying so. A figure in a
 * PDF gets quoted back months later; that one would have been quoted as a quarter's fuel bill.
 *
 * So `scope` is REQUIRED rather than optional, and it is drawn under every value. A metric that cannot
 * say what period it covers does not belong in the headline of a document about a period.
 */
/** The cards themselves. The gap after them is density-scaled and added by `metricStrip`. */
export const METRIC_STRIP_HEIGHT = CARD_H + 16;

export function metricStrip(doc: PDFKit.PDFDocument, metrics: readonly Metric[]): void {
  if (metrics.length === 0) return;
  const w = (CONTENT_W - CARD_GAP * (metrics.length - 1)) / metrics.length;
  const top = doc.y;

  withoutAutoBreak(doc, () => metrics.forEach((m, i) => {
    const x = M + i * (w + CARD_GAP);
    doc.save().roundedRect(x, top, w, CARD_H, GEOM.radius).fillColor(C.wash).fill().restore();
    doc.save().roundedRect(x, top, w, CARD_H, GEOM.radius).lineWidth(0.5).strokeColor(C.hairline).stroke().restore();

    label(doc, m.label, x + 9, top + 9, w - 18);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.metric)
      .text(winAnsi(m.value), x + 9, top + 19, { width: w - 18, lineBreak: false });
    doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro)
      .text(winAnsi(m.scope), x + 9, top + 39, { width: w - 18, lineBreak: false });

    // The trend sits in the bottom strip of the card, under a hairline, so it reads as a footnote to
    // the value rather than as a second figure competing with it.
    const trendTop = top + CARD_H - 18;
    doc.save().lineWidth(0.4).strokeColor(C.hairline)
      .moveTo(x + 9, trendTop - 2).lineTo(x + w - 9, trendTop - 2).stroke().restore();
    // Always neutral. Colouring the LINE by the direction of the final step said "these twelve weeks
    // were good", which is a claim about the window that one week's delta cannot support. The verdict
    // belongs to the percentage beside it, which is the figure that actually has a direction.
    if (m.trend && m.trend.length > 1) {
      sparkline(doc, m.trend, x + 9, trendTop, w - 18 - (m.delta ? 44 : 0), 14, C.neutral);
    }
    if (m.delta) {
      doc.fillColor(m.deltaIsBad === undefined ? C.inkMuted : m.deltaIsBad ? C.bad : C.good)
        .font("Helvetica-Bold").fontSize(T.micro)
        .text(winAnsi(m.delta), x + w - 9 - 42, trendTop + 4, { width: 42, align: "right", lineBreak: false });
    }
  }));

  doc.x = M;
  doc.y = top + CARD_H + gap(doc, 16);
}

// ── waterfall ───────────────────────────────────────────────────────────────────────────────────

export interface WaterfallBar {
  label: string;
  /** Positive pushed spend UP. */
  dollars: number;
  detail: string;
}

const BAR_H = 12;
const ROW_H = 25;
/** One `rankedBars` entry: key line, bar, detail line. Kept beside `rankedBarsHeight` so they agree. */
const ROW_PITCH = 27;
const LABEL_W = 116;
const VALUE_W = 78;

/**
 * A signed waterfall: each component's bar grows from a shared centre line, right for money added and
 * left for money saved.
 *
 * Centre-anchored rather than stacked because the reader's question is "which of these is the big one",
 * and a stacked waterfall answers "what order did they happen in" — an order these components do not
 * have. The zero line makes a saving visually the opposite of a cost instead of a shorter bar.
 *
 * ── WHAT CHANGED IN THE REDESIGN ────────────────────────────────────────────────────────────────
 * The axis is captioned. Unlabelled, a centre line is a convention the reader has to infer from the
 * colours, and half of them will read the left-hand bars as smaller rather than as negative. Two words
 * at the head of the track — SAVED and ADDED — cost one line and remove the inference. The share under
 * each value is captioned once for the same reason.
 */
/** Axis captions, one row per bar, and the gap that follows. Measured, so `ensure` need not guess. */
export function waterfallHeight(bars: number): number {
  return bars === 0 ? 0 : 13 + ROW_H * (bars - 1) + BAR_H + 10;
}

export function waterfall(doc: PDFKit.PDFDocument, bars: readonly WaterfallBar[], total: number): void {
  if (bars.length === 0) return;
  const trackX = M + LABEL_W;
  const trackW = CONTENT_W - LABEL_W - VALUE_W - 10;
  const centre = trackX + trackW / 2;
  const widest = Math.max(1, ...bars.map((b) => Math.abs(b.dollars)));
  const half = trackW / 2 - 2;

  // `label` writes through `doc.text`, which advances `doc.y` by a line height of its own. Adding a
  // gap on top of that opened a 25pt canyon between the axis captions and the first bar, so the
  // captions read as a stray heading rather than as the axis they label. The row top is computed once
  // and set, never accumulated.
  const captionTop = doc.y;
  label(doc, "\u00ab saved", trackX, captionTop, half - 4, C.good, "right");
  label(doc, "added \u00bb", centre + 4, captionTop, half - 4, C.bad);
  label(doc, "share", trackX + trackW + 10, captionTop, VALUE_W, C.inkSubtle, "right");
  const firstTop = captionTop + 13;
  doc.y = firstTop;

  withoutAutoBreak(doc, () => { for (const b of bars) {
    const top = doc.y;
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.small)
      .text(winAnsi(b.label), M, top, { width: LABEL_W - 8, lineBreak: false });
    doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro)
      .text(winAnsi(b.detail), M, top + 10, { width: LABEL_W - 8, lineBreak: false });

    const len = Math.max(1.5, (Math.abs(b.dollars) / widest) * half);
    const up = b.dollars >= 0;
    doc.save()
      .roundedRect(up ? centre : centre - len, top, len, BAR_H, 1.5)
      .fillColor(up ? C.bad : C.good).opacity(0.88).fill()
      .restore();

    doc.fillColor(up ? C.bad : C.good).font("Helvetica-Bold").fontSize(T.subhead)
      .text(winAnsi(money(b.dollars)), trackX + trackW + 10, top + 1, { width: VALUE_W, align: "right", lineBreak: false });
    doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro)
      .text(winAnsi(total === 0 ? "" : `${Math.round((b.dollars / total) * 100)}%`),
        trackX + trackW + 10, top + 13, { width: VALUE_W, align: "right", lineBreak: false });

    doc.y = top + ROW_H;
  } });

  // The zero line last, so it sits over the bars and the eye reads it as the axis it is. Anchored to the
  // top captured before the loop — reconstructing it from `doc.y` afterwards drew it a row short and
  // faint enough to look like a rendering artifact rather than an axis.
  doc.save().strokeColor(C.ink).lineWidth(0.7).opacity(0.5)
    .moveTo(centre, firstTop - 3).lineTo(centre, firstTop + ROW_H * (bars.length - 1) + BAR_H + 3).stroke().restore();
  doc.x = M;
  doc.y = firstTop + ROW_H * (bars.length - 1) + BAR_H + gap(doc, 10);
}

export function money(n: number): string {
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return `${n < 0 ? "-" : "+"}$${v}`;
}

// ── proportion bar ──────────────────────────────────────────────────────────────────────────────

export interface Segment {
  label: string;
  value: number;
  color: string;
  /** Printed under the label in the legend — the dollars or hours behind the share. */
  detail?: string;
}

/**
 * One bar divided into its parts, with a legend under it.
 *
 * Used where the report's claim is a SPLIT rather than a total: measured against unmeasured gallons,
 * idle that was avoidable against idle nobody had an alternative to. Those sections used to be three
 * paragraphs of prose each, and a reader who wanted the proportion had to build it from two numbers in
 * different sentences. The bar is the proportion; the prose underneath is why it is what it is.
 */
/**
 * The bar plus its two-line legend. `LEGEND_H` is the legend's own ink, NOT air.
 *
 * ── THE DISTINCTION THAT MATTERS ────────────────────────────────────────────────────────────────
 * The trailing space used to be one number, 22, covering both the legend's second line and the gap
 * after it. Density-scaling that number then scaled the legend's own height, so at the tighter setting
 * the next paragraph was set on top of "4,658 gal, $16,981". Only the air may shrink; a block's ink is
 * a fixed size or it is not a block.
 */
const LEGEND_H = 17;

export function proportionBarHeight(doc: PDFKit.PDFDocument, height = 15): number {
  return height + 7 + LEGEND_H + gap(doc, 6);
}

export function proportionBar(doc: PDFKit.PDFDocument, segments: readonly Segment[], height = 15): void {
  const parts = segments.filter((s) => s.value > 0);
  if (parts.length === 0) return;
  const total = parts.reduce((a, s) => a + s.value, 0);
  const top = doc.y;
  let x = M;

  parts.forEach((s, i) => {
    // 0.6pt minimum: a 0.2% slice must still be visible as a slice, or the bar quietly lies about
    // whether the category is present at all.
    const w = Math.max(0.6, (s.value / total) * CONTENT_W);
    const first = i === 0;
    const last = i === parts.length - 1;
    doc.save();
    if (first || last) {
      // Only the outer ends are rounded, so the bar reads as one object rather than as a row of pills.
      doc.roundedRect(x, top, w, height, 2.5).fillColor(s.color).fill();
      if (!first) doc.rect(x, top, Math.min(3, w), height).fillColor(s.color).fill();
      if (!last) doc.rect(x + w - Math.min(3, w), top, Math.min(3, w), height).fillColor(s.color).fill();
    } else {
      doc.rect(x, top, w, height).fillColor(s.color).fill();
    }
    doc.restore();
    x += w;
  });

  // One Y for every legend entry, captured before the loop. `doc.text` moves `doc.y`, so reading it
  // inside the loop stepped each swatch further down than the last and the legend came out running
  // diagonally across the page under its own bar.
  const legendY = top + height + 7;
  const w = CONTENT_W / parts.length;
  withoutAutoBreak(doc, () => parts.forEach((s, i) => {
    const lx = M + i * w;
    const share = `${((s.value / total) * 100).toFixed(1)}%`;
    doc.save().roundedRect(lx, legendY + 1.5, 5, 5, 1).fillColor(s.color).fill().restore();
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.micro);
    doc.text(fit(doc, `${share}  ${s.label}`, w - 13), lx + 9, legendY, { width: w - 13, lineBreak: false });
    if (s.detail) {
      doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro);
      doc.text(fit(doc, s.detail, w - 13), lx + 9, legendY + 8.5, { width: w - 13, lineBreak: false });
    }
  }));
  doc.x = M;
  doc.y = legendY + LEGEND_H + gap(doc, 6);
}

// ── ranked bars ─────────────────────────────────────────────────────────────────────────────────

export interface Rank {
  key: string;
  value: number;
  detail: string;
}

/**
 * A ranked list where the bar IS the ranking: label, proportional bar, value.
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────────────────────────
 * Two rankings — worst sites and worst trucks — used to be interleaved into one seven-column table
 * with a spacer column between them, so that row three read "— — — — Unit 111 $29" whenever there were
 * more trucks than sites. Every one of those em-dashes is `table` rendering an empty cell as a missing
 * VALUE, which is right for a missing value and wrong for a gutter, and the result read as data the
 * report had failed to collect. Two independent lists are two lists; drawing them as one table was
 * always a layout convenience pretending to be a relationship.
 */
/**
 * The height `rankedBars` will occupy. A caller drawing two of them side by side must `ensure` the
 * TALLER one — this is the measurement that stopped the list walking off the foot of the page one
 * fragment at a time.
 */
export function rankedBarsHeight(rows: number): number {
  // 27 per row, not 17: the key sets at `cy`, the bar at `cy + 10`, the detail under that, and the next
  // row starts at `barY + 17`. Measuring the last hop instead of the whole one put a five-row ranking
  // 50pt past the bottom of the page, straight through the footer, once `withoutAutoBreak` stopped
  // pdfkit from papering over it with a new page.
  return rows === 0 ? 23 : 11 + rows * ROW_PITCH;
}

export function rankedBars(
  doc: PDFKit.PDFDocument,
  title: string,
  rows: readonly Rank[],
  x: number, y: number, w: number,
  color: string,
  fmt: (n: number) => string,
): number {
  return withoutAutoBreak(doc, () => drawRanked(doc, title, rows, x, y, w, color, fmt));
}

function drawRanked(
  doc: PDFKit.PDFDocument,
  title: string,
  rows: readonly Rank[],
  x: number, y: number, w: number,
  color: string,
  fmt: (n: number) => string,
): number {
  label(doc, title, x, y, w, C.inkMuted);
  let cy = y + 11;
  if (rows.length === 0) {
    doc.fillColor(C.inkSubtle).font("Helvetica-Oblique").fontSize(T.small)
      .text("None in this window.", x, cy, { width: w, lineBreak: false });
    return cy + 12;
  }
  const widest = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const valueW = 46;
  const trackW = w - valueW - 8;

  for (const r of rows) {
    doc.fillColor(C.ink).font("Helvetica").fontSize(T.small);
    doc.text(fit(doc, r.key, trackW - 4), x, cy, { width: trackW, lineBreak: false });
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(T.small)
      .text(winAnsi(fmt(r.value)), x + w - valueW, cy, { width: valueW, align: "right", lineBreak: false });
    const barY = cy + 10;
    doc.save().rect(x, barY, trackW, 3).fillColor(C.hairline).fill().restore();
    doc.save().rect(x, barY, Math.max(1, (Math.abs(r.value) / widest) * trackW), 3).fillColor(color).opacity(0.9).fill().restore();
    doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro)
      .text(winAnsi(r.detail), x, barY + 5.5, { width: w, lineBreak: false });
    cy = barY + (ROW_PITCH - 10);
  }
  doc.x = M;
  return cy;
}
