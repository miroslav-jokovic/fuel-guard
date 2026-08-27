/**
 * The cost story: the answer, the headline metrics, the bridge that explains the move, and the
 * period table underneath it. The policy sections are in `fuelSpendReportPolicy`.
 *
 * Split from `fuelSpendReport` when that file reached the 500-line budget, along the seam it already
 * had: this decides what a section says and how it looks; the other decides what data a section gets.
 * Every function here takes finished figures and draws them, so none of them can compute anything and
 * quietly disagree with the page.
 */
import { operatingBridge, type SpendGrain, type SpendPeriod } from "@silvicom/shared";
import { C, CONTENT_W, GEOM, T } from "./fuelSpendReportTheme.js";
import { METRIC_STRIP_HEIGHT, metricStrip, money, waterfall, waterfallHeight, type Metric } from "./fuelSpendReportCharts.js";
import { figureTable, tableHeadHeight, totalRow, type Column, type Row } from "./fuelSpendReportTable.js";
import { lead, note, startSection, verdictBand, withheld } from "./fuelSpendReportDraw.js";
import { ensure } from "./fuelSpendReportFlow.js";
import { change, num, plural, rangeLabel, usd, usd2, usd3, usdCompact } from "./fuelSpendReportFormat.js";
import { winAnsi } from "../../services/dqBinder/pdfDraw.js";

export type Comparison = { prior: SpendPeriod; current: SpendPeriod } | null;

/** One grain, in the words a sentence needs it in. */
const GRAIN_WORD: Record<SpendGrain, string> = { day: "day", week: "week", month: "month" };

/**
 * The one sentence somebody reads, and the one line of support under it.
 *
 * ── WHY THE REPORT LEADS WITH A CONCLUSION IT COULD LEAVE THE READER TO DRAW ────────────────────
 * Because they will not draw it. The old document's equivalent sentence was the third paragraph of
 * "Why spend moved", set in the same grey as the coverage caveats around it, and it said what the two
 * totals were without saying which component moved them. Naming the dominant term is not editorialising
 * — `operatingBridge` already decided it, and the decomposition is asserted to sum exactly. Printing the
 * largest one is reading the reader their own arithmetic.
 */
export function drawVerdict(
  doc: PDFKit.PDFDocument,
  overall: SpendPeriod,
  cmp: Comparison,
  grain: SpendGrain,
  support: string,
): void {
  const window = `${usd(overall.spend)} of tractor fuel over ${plural(overall.days, "day")}, ${num(overall.gallons)} gallons at ${usd3(overall.pricePerGal)}.`;
  if (!cmp) {
    verdictBand(doc, window, `${support} Two complete ${GRAIN_WORD[grain]}s are needed before a change can be explained against anything, so this window is reported without a comparison.`);
    return;
  }

  const b = operatingBridge(cmp.prior, cmp.current);
  const biggest = [...b.terms].sort((x, y) => Math.abs(y.dollars) - Math.abs(x.dollars))[0];
  const dir = b.deltaSpend >= 0 ? "rose" : "fell";
  // A component can exceed the net change it belongs to — the terms are signed and they offset, so a
  // week where gallons fell $1,558 and price added $15 attributes 101% of a $1,544 fall to gallons.
  // That is arithmetically right and reads as a typo, so past 100% the sentence names the driver
  // without quoting a share at it.
  const share = biggest && b.deltaSpend !== 0 ? Math.abs(Math.round((biggest.dollars / b.deltaSpend) * 100)) : null;
  const driver = biggest == null || share == null
    ? ""
    : share > 100
      ? ` ${biggest.label} accounts for all of it, offset by the other terms.`
      : ` ${share}% of that was ${biggest.label.toLowerCase()}.`;
  verdictBand(
    doc,
    `${window} In the ${GRAIN_WORD[grain]} to ${rangeLabel(cmp.current.to, cmp.current.to)} it ${dir} ${money(b.deltaSpend).replace(/^[+-]/, "")} against the ${GRAIN_WORD[grain]} before.${driver}`,
    support,
  );
}

/**
 * The headline cards.
 *
 * ── THE FIX THAT MATTERS MOST IN THIS REDESIGN ──────────────────────────────────────────────────
 * These are WINDOW totals. The old row printed the last complete bucket's figures under bare labels,
 * so a twelve-week report opened with one week's spend and nothing on the page said so. Each card now
 * states its own scope, and the change belongs to the sparkline strip at the foot of the card rather
 * than to the value above it — because it is a change between the last two periods, not a change in
 * the window total, and those are different claims that must not share a line.
 */
export function drawHeadline(
  doc: PDFKit.PDFDocument,
  overall: SpendPeriod,
  series: readonly SpendPeriod[],
  cmp: Comparison,
  grain: SpendGrain,
): void {
  // Partial buckets are excluded from every trend for the same reason `comparablePeriods` excludes
  // them from the comparison: the newest bucket is normally still filling, and a one-day week plotted
  // beside twelve full ones draws a collapse that never happened.
  const full = series.filter((p) => !p.partial);
  const p = cmp?.prior;
  const c = cmp?.current;
  const scope = `${plural(overall.days, "day")} to ${rangeLabel(overall.to, overall.to)}`;

  const metrics: Metric[] = [
    { label: "Fuel spend", value: usdCompact(overall.spend), scope, trend: full.map((x) => x.spend), ...change(p?.spend, c?.spend, true) },
    { label: "Gallons", value: num(overall.gallons), scope: "tractor diesel", trend: full.map((x) => x.gallons), ...change(p?.gallons, c?.gallons, true) },
    { label: "Paid / gal", value: usd3(overall.pricePerGal), scope: "weighted average", trend: full.map((x) => x.pricePerGal), ...change(p?.pricePerGal, c?.pricePerGal, true) },
    { label: "Cost / mile", value: usd2(overall.costPerMile), scope: "fuel only", trend: full.map((x) => x.costPerMile), ...change(p?.costPerMile, c?.costPerMile, true) },
    { label: "Fleet MPG", value: overall.mpg?.toFixed(2) ?? "-", scope: "measured miles", trend: full.map((x) => x.mpg), ...change(p?.mpg, c?.mpg, false) },
  ];
  ensure(doc, METRIC_STRIP_HEIGHT + 14);
  metricStrip(doc, metrics);

  doc.fillColor(C.inkSubtle).font("Helvetica").fontSize(T.micro).text(
    winAnsi(
      `Each value covers the whole window. The line and the percentage under it are the last ${full.length} complete ${GRAIN_WORD[grain]}${full.length === 1 ? "" : "s"} and the change across the final two of them` +
        `${cmp ? ` (${rangeLabel(cmp.prior.from, cmp.prior.to)} to ${rangeLabel(cmp.current.from, cmp.current.to)})` : ""}.`,
    ),
    GEOM.margin, doc.y - 8, { width: CONTENT_W },
  );
  doc.y += 12;
}

export function drawBridge(doc: PDFKit.PDFDocument, cmp: Comparison, grain: SpendGrain, n: number): void {
  if (!cmp) {
    startSection(doc, n, "Why spend moved", undefined, 30);
    note(doc, `Two complete ${GRAIN_WORD[grain]}s are needed before a change can be explained against anything.`);
    return;
  }
  const b = operatingBridge(cmp.prior, cmp.current);

  // Two lines of the lead sentence plus the whole waterfall, which cannot be split across a page.
  startSection(doc, n, "Why spend moved", undefined, 28 + waterfallHeight(b.terms.length));

  lead(
    doc,
    `Tractor fuel went ${usd(cmp.prior.spend)} to ${usd(cmp.current.spend)}, a change of ${money(b.deltaSpend)}. ` +
      (b.volumeSplit
        ? `The fleet covered ${num(cmp.current.miles)} miles against ${num(cmp.prior.miles)}, at ${usd3(cmp.current.pricePerGal)} a gallon against ${usd3(cmp.prior.pricePerGal)}.`
        : ""),
  );

  waterfall(doc, b.terms.map((t) => ({ label: t.label, dollars: t.dollars, detail: t.detail })), b.deltaSpend);

  if (b.volumeSplit) {
    const m = b.volumeSplit.milesFrom;
    note(
      doc,
      `Distance splits into ${num(m.trucks)} miles from running ${cmp.current.activeTrucks} trucks against ${cmp.prior.activeTrucks}, ` +
        `and ${num(m.perTruck)} miles from each covering ${num(cmp.current.milesPerTruck)} against ${num(cmp.prior.milesPerTruck)}. ` +
        `Components sum to the change exactly${b.tiesOut ? "" : " - RESIDUAL PRESENT, the decomposition is wrong"}.`,
      b.tiesOut ? C.inkMuted : C.bad,
    );
  }
  if (b.withheld) withheld(doc, b.withheld);
}

const SERIES_COLUMNS: Column[] = [
  { width: 74, header: "Period" },
  { width: 46, header: "Trucks", align: "right" },
  { width: 56, header: "Gallons", align: "right" },
  // `barBaseline` is filled in per render from the window average — see `drawSeries`.
  { width: 76, header: "Fuel spend", align: "right", bar: true },
  { width: 52, header: "Paid / gal", align: "right" },
  { width: 50, header: "Miles", align: "right" },
  { width: 38, header: "MPG", align: "right" },
  { width: 50, header: "$ / mile", align: "right" },
  { width: 44, header: "Idle", align: "right" },
];

/** Exported for `fuelSpendReport.widths.test.ts`, which pins the arithmetic these depend on. */
export const seriesColumnWidths = SERIES_COLUMNS.map((c) => c.width);

export function drawSeries(
  doc: PDFKit.PDFDocument,
  series: readonly SpendPeriod[],
  overall: SpendPeriod,
  grain: SpendGrain,
  n: number,
): void {
  const word = GRAIN_WORD[grain];
  const average = series.length > 0 ? series.reduce((a, p) => a + p.spend, 0) / series.length : 0;
  const columns = SERIES_COLUMNS.map((c) => (c.bar ? { ...c, barBaseline: average } : c));
  startSection(
    doc, n,
    grain === "day" ? "Day by day" : grain === "month" ? "Month by month" : "Week by week",
    `The mark under each spend figure is that ${word} against the ${usd(average)} ${word}ly average - right of the tick is a heavier ${word} than usual, left is a lighter one.`,
    tableHeadHeight(),
  );

  // Newest first, and a period still filling is kept but LABELLED. Dropping it hides the most recent
  // days from a reader looking for them; leaving it unmarked invites the comparison the bridge
  // deliberately refuses to make, which is how a one-day week reads as a collapse in spend.
  const rows: Row[] = [...series].reverse().map((p, i) => ({
    emphasis: i === 0,
    cells: [
      { text: rangeLabel(p.from, p.to), sub: p.partial ? "in progress" : undefined },
      { text: String(p.activeTrucks) },
      { text: num(p.gallons) },
      { text: usd(p.spend), value: p.spend, bold: true },
      { text: usd3(p.pricePerGal) },
      { text: num(p.miles) },
      { text: p.mpg?.toFixed(2) ?? "-" },
      { text: usd2(p.costPerMile) },
      // The SHARE, not a cost: how much of this truck-time was stationary is a fact; what it was worth
      // in blame is not this report's to say.
      { text: p.idleShare == null ? "-" : `${(p.idleShare * 100).toFixed(0)}%` },
    ],
  }));

  figureTable(doc, columns, rows);
  totalRow(doc, columns, [
    { text: `${plural(series.length, GRAIN_WORD[grain])}`, color: C.inkMuted },
    { text: String(overall.activeTrucks) },
    { text: num(overall.gallons) },
    { text: usd(overall.spend) },
    { text: usd3(overall.pricePerGal) },
    { text: num(overall.miles) },
    { text: overall.mpg?.toFixed(2) ?? "-" },
    { text: usd2(overall.costPerMile) },
    { text: overall.idleShare == null ? "-" : `${(overall.idleShare * 100).toFixed(0)}%` },
  ]);
}
