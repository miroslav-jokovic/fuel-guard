/**
 * The three sections that judge rather than describe: what the contract should have cost, where the
 * fuel policy was not followed, and what idling was worth. The cost story is in
 * `fuelSpendReportSections`.
 *
 * Every function here takes finished figures and draws them. None of them computes a verdict — the
 * verdicts are `analyzeContractCapture`, `analyzePolicyExceptions` and `computeIdleBreakdown`, all in
 * `packages/shared` and all tested there, so a figure in this document and the same figure on the page
 * cannot come out different.
 */
import type { analyzePolicyExceptions, ContractCapture, FleetIdleVerdict, SpendGrain, SpendLine, SpendPeriod } from "@fuelguard/shared";
import { C, CONTENT_W, GEOM } from "./fuelSpendReportTheme.js";
import { proportionBar, rankedBars, type Segment } from "./fuelSpendReportCharts.js";
import { figureTable, type Column, type Row } from "./fuelSpendReportTable.js";
import { keepTogether, lead, note, sectionHead } from "./fuelSpendReportDraw.js";
import { num, plural, shortDay, usd, usd3 } from "./fuelSpendReportFormat.js";
import { winAnsi } from "./dqBinder/pdfDraw.js";

const M = GEOM.margin;

const OVERCHARGE_COLUMNS: Column[] = [
  { width: 66, header: "Date" },
  { width: 150, header: "Site" },
  { width: 44, header: "Unit" },
  { width: 52, header: "Gallons", align: "right" },
  { width: 62, header: "Quoted", align: "right" },
  { width: 62, header: "Billed", align: "right" },
  { width: 68, header: "Over", align: "right" },
];

const EXCEPTION_COLUMNS: Column[] = [
  { width: 196, header: "Exception" },
  { width: 46, header: "Fills", align: "right" },
  { width: 62, header: "Gallons", align: "right" },
  { width: 50, header: "Share", align: "right" },
  { width: 72, header: "Spend", align: "right" },
  // Red, because in this table the encoded quantity IS the finding. The period table's bar is grey for
  // the opposite reason: weekly fuel spend is a magnitude, not a verdict.
  { width: 78, header: "Excess", align: "right", bar: true, barColor: C.bad },
];

/** Exported for `fuelSpendReport.widths.test.ts`, which pins the arithmetic these depend on. */
export const overchargeColumnWidths = OVERCHARGE_COLUMNS.map((c) => c.width);
export const exceptionColumnWidths = EXCEPTION_COLUMNS.map((c) => c.width);

/**
 * Contract capture — what the contract took off the posted price, and where it took off least.
 *
 * ── WHY THE COVERAGE BAR IS NOT OPTIONAL ────────────────────────────────────────────────────────
 * Only fills matched to a posted price for that station on that day can be measured, and the price
 * reports only go back as far as somebody uploaded them. A reader shown "$26,736 captured" without
 * being told it describes 89% of the fills — or 21%, on a window reaching before the reports start —
 * will read a partial measurement as a complete one. The old section said so in a paragraph placed
 * third, after two paragraphs of figures the caveat applies to. It is now the first thing under the
 * lead sentence, and it is a bar, because a proportion stated in prose is a proportion the reader has
 * to assemble from two numbers in different sentences.
 */
export function drawDiscount(doc: PDFKit.PDFDocument, capture: ContractCapture, lines: readonly SpendLine[], n: number): void {
  keepTogether(doc, 170);
  sectionHead(doc, n, "Contracted price", "What Pilot quoted against what Pilot billed, fill by fill.");

  const tractor = lines.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0);
  if (capture.measuredLines === 0) {
    note(
      doc,
      "No fill in this period could be matched to a Pilot quote, so what these fills should have cost is " +
        "unknown. Quotes come from the daily price report; upload the days this period covers to fill it in.",
    );
    return;
  }

  // The headline is a comparison of two rates, not a single derived number, because the whole claim is
  // that they should be the SAME rate and any gap is the vendor's to explain.
  lead(
    doc,
    `Across ${num(capture.measuredGallons)} measurable gallons the contract quoted ` +
      `${usd3(capture.contractPerGal)} a gallon and we were billed ${usd3(capture.paidPerGal)} - ` +
      `${capture.netVariance >= 0 ? "over" : "under"} contract by ${usd(Math.abs(capture.netVariance))}. ` +
      `Against the posted retail those fills captured ${usd(capture.captured)}, ${usd3(capture.capturedPerGal)} a gallon.`,
  );

  const segments: Segment[] = [
    { label: "billed at contract", value: capture.honouredLines, color: C.good, detail: plural(capture.honouredLines, "fill") },
    { label: "above contract", value: capture.overLines, color: C.bad, detail: usd(capture.overDollars) },
    { label: "below contract", value: capture.underLines, color: C.neutral, detail: usd(Math.abs(capture.underDollars)) },
    // Unmeasured is its own segment rather than folded into a coverage percentage, because a fill
    // nobody could price and a fill billed correctly are the two things this report must not merge.
    { label: "no quote in range", value: capture.unmeasuredLines, color: C.inkSubtle, detail: `${num(capture.unmeasuredGallons)} gal, ${usd(capture.unmeasuredPaid)}` },
  ];
  proportionBar(doc, segments);

  if (capture.unmeasuredLines > 0) {
    note(
      doc,
      `${capture.unmeasuredLines.toLocaleString()} of ${tractor.length.toLocaleString()} fills had no quote in range - an ` +
        "off-network site, or a station absent from that day's report. They are left out of every figure above " +
        "rather than counted as having been billed correctly.",
    );
  }
  if (capture.carriedForwardLines > 0) {
    note(
      doc,
      `${capture.carriedForwardLines.toLocaleString()} fill(s) were measured against the previous day's quote, the ` +
        "report having not been issued that day - the daily report is not sent on a Sunday. Measured against " +
        "production, carrying a quote forward produced no overcharge at all: all 19 fills over contract in that " +
        "window were scored against a same-day quote.",
    );
  }

  const worst = capture.exceptions.filter((c) => c.variance > 0).slice(0, 8);
  if (worst.length === 0) {
    note(doc, "No fill was billed above its contracted price by more than a cent a gallon.");
    return;
  }
  keepTogether(doc, 120);
  note(
    doc,
    `${capture.overLines} fill(s) were billed above contract, ${usd(capture.overDollars)} in total` +
      (capture.underLines > 0 ? `, and ${capture.underLines} below it by ${usd(Math.abs(capture.underDollars))}.` : ".") +
      " The largest overcharges, each traceable to a station, a truck and a date:",
  );
  figureTable(
    doc,
    OVERCHARGE_COLUMNS,
    worst.map<Row>((c) => ({
      cells: [
        { text: c.line.tranDate ? shortDay(c.line.tranDate) : "-" },
        { text: siteLabel(c.line) },
        { text: c.line.unit ?? "-" },
        { text: num(c.gallons) },
        { text: usd3(c.contractPerGal) },
        { text: usd3(c.paidPerGal) },
        { text: usd(c.variance), bold: true, color: C.bad },
      ],
    })),
  );
}

/**
 * Where the fuel policy was not followed — how much, and then WHERE.
 *
 * ── THE SHARE COLUMN, AND WHY IT NO LONGER DIVIDES ACROSS TWO SOURCES ───────────────────────────
 * It used to be each exception's gallons over `periodTotals(...).gallons` — a numerator from
 * `fuel_spend_lines` and a denominator from the `fuel_spend_days` rollup. Those are two derivations of
 * the same fills and they agree in production most of the time, which is the worst property a ratio can
 * have: it is right until a backfill lands between them and then it silently prints a share above 100%.
 * `ExceptionReport.gallonShare` is computed inside `analyzePolicyExceptions` from the same lines the
 * numerator came from, so it cannot exceed 1 by construction. It was always there and this report was
 * dividing by hand instead.
 */
export function drawExceptions(
  doc: PDFKit.PDFDocument,
  ex: ReturnType<typeof analyzePolicyExceptions>,
  n: number,
): void {
  keepTogether(doc, 160);
  sectionHead(doc, n, "Where the fuel policy was not followed");

  const reports = [
    { name: "Avoided brands (ONE9, off-brand)", r: ex.avoidedBrands },
    { name: "California", r: ex.avoidedStates },
    { name: "Off the preferred network", r: ex.offNetwork },
  ];
  if (reports.every((x) => x.r.lines === 0)) {
    note(doc, "No fills outside the fuel policy in this window.");
    return;
  }

  figureTable(
    doc,
    EXCEPTION_COLUMNS,
    reports.map<Row>((x) => ({
      cells: [
        { text: x.name, sub: x.r.netPerGal != null ? `${usd3(x.r.netPerGal)}/gal against ${usd3(x.r.baselinePerGal)} elsewhere` : undefined },
        { text: String(x.r.lines) },
        { text: num(x.r.gallons) },
        { text: x.r.gallonShare == null ? "-" : `${(x.r.gallonShare * 100).toFixed(1)}%` },
        { text: usd(x.r.spend) },
        { text: usd(x.r.excess), value: x.r.excess, bold: true, color: x.r.excess > 0 ? C.bad : C.ink },
      ],
    })),
  );
  note(
    doc,
    "Excess is what these gallons cost above what the rest of the fleet paid over the same period - not against a fixed price, which in a moving market invents a finding every time diesel rises. The three rows overlap: a ONE9 fill in California is counted in all of them.",
  );

  // The summary above says how much; this says WHERE, which is the only part anybody can act on. The
  // page lists every fill — a document cannot, so it ranks the sites and the trucks the money is at.
  for (const x of reports) {
    const sites = x.r.bySite.filter((g) => g.excess > 0).slice(0, 5);
    const units = x.r.byUnit.filter((g) => g.excess > 0).slice(0, 5);
    if (sites.length === 0 && units.length === 0) continue;
    keepTogether(doc, 130);
    doc.moveDown(0.3);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(9.5)
      .text(winAnsi(x.name), M, doc.y, { width: CONTENT_W });
    doc.moveDown(0.35);

    // Two independent rankings drawn as two lists, side by side. Interleaving them into one table is
    // what produced the row of em-dashes `rankedBars` was written to kill.
    const colW = (CONTENT_W - 26) / 2;
    const top = doc.y;
    const a = rankedBars(doc, "Worst sites", sites.map((g) => ({ key: g.key, value: g.excess, detail: `${plural(g.lines, "fill")}, ${num(g.gallons)} gal` })), M, top, colW, C.bad, usd);
    const b = rankedBars(doc, "Worst trucks", units.map((g) => ({ key: `Unit ${g.key}`, value: g.excess, detail: `${plural(g.lines, "fill")}, ${num(g.gallons)} gal` })), M + colW + 26, top, colW, C.bad, usd);
    doc.x = M;
    doc.y = Math.max(a, b) + 4;
  }
}

/**
 * Idling, with the verdict rather than a total charged as waste.
 *
 * ── WHAT THIS SECTION USED TO GET WRONG, TWICE ──────────────────────────────────────────────────
 * First it multiplied idle seconds by a burn rate and printed the whole thing in red — the
 * every-truck-is-avoidable over-count `docs/plans/IDLE-AVOIDABLE-HOS.md` exists to prevent. Then it
 * dropped the money entirely, which was honest but told a boss to go and look somewhere else.
 *
 * It now reports what `computeAvoidable` decided, and the three quantities stay apart because they mean
 * different things: idle hours are a fact about running trucks, AVOIDABLE is the only figure that is
 * anyone's fault, and REDUCIBLE is a capex case for equipping the trucks that had no alternative. Only
 * a truck with an admin-confirmed APU or Optimized Idle can contribute to the middle one.
 *
 * ── AND WHY IT IS NOW A BAR ─────────────────────────────────────────────────────────────────────
 * Those three quantities are parts of one total, and three paragraphs cannot show that. A reader who
 * wanted to know how much of the fleet's idling anybody could have done something about had to hold
 * three hour-figures from three sentences in their head and divide. The bar is the division.
 */
export function drawIdle(
  doc: PDFKit.PDFDocument,
  series: readonly SpendPeriod[],
  grain: SpendGrain,
  idle: FleetIdleVerdict | null,
  n: number,
): void {
  keepTogether(doc, 150);
  sectionHead(doc, n, "Idling", "Engine time the trucks spent stationary, and how much of it anybody could have prevented.");
  const gaps = series.filter((p) => !p.idleUsable && p.idleCoverage != null);
  if (!idle || idle.idleH === 0) {
    note(doc, "No idle measured in this range with enough engine-feed coverage to judge.");
    return;
  }

  lead(
    doc,
    `The fleet idled ${num(idle.idleH)} hours - ${idle.idlePct.toFixed(1)}% of every hour an engine was running - ` +
      `across ${plural(idle.totalTrucks, "truck")} over ${plural(idle.rangeDays, "day")}.`,
  );

  // The remainder is idle on trucks with no confirmed alternative and no capex case attached to it: it
  // is neither anybody's fault nor a purchase order, and it has to appear or the bar's parts would not
  // sum to the hours the sentence above just claimed.
  const unattributed = Math.max(0, idle.idleH - idle.avoidableH - idle.reducibleH);
  proportionBar(doc, [
    { label: "avoidable", value: idle.avoidableH, color: C.bad, detail: `${num(idle.avoidableH)} h, ${usd(idle.avoidableUsd)}` },
    { label: "reducible with equipment", value: idle.reducibleH, color: C.warn, detail: `${num(idle.reducibleH)} h, ${usd(idle.reducibleUsd)}` },
    { label: "no alternative, no case", value: unattributed, color: C.neutral, detail: `${num(unattributed)} h` },
  ]);

  note(
    doc,
    `AVOIDABLE is idle on the ${plural(idle.confidentTrucks, "truck")} that had a confirmed APU or Optimized Idle and ` +
      `could have rested without running the main engine - ${usd(idle.avoidableUsd)}, and the only part of this that is ` +
      `anyone's fault. REDUCIBLE is what the same rest idle would be worth if the ${plural(idle.reducibleTrucks, "truck")} ` +
      `that lack the equipment had it: ${usd(idle.reducibleUsd)}, which is a case for buying APUs rather than a ` +
      "performance figure. Those drivers had no alternative and are not being blamed for it.",
  );
  note(
    doc,
    `Judged across ${plural(idle.totalTrucks, "truck")}, of which ${idle.confidentTrucks} had enough engine-feed coverage ` +
      "to score. Avoidability comes only from admin-confirmed equipment - a diesel APU is invisible to telematics, so " +
      "behaviour learned from the truck is never allowed to make idle somebody's fault.",
  );
  if (gaps.length > 0) {
    note(
      doc,
      `${gaps.length} ${grain}(s) of the period table are marked "-" for idle share: the engine feed covered too ` +
        "little of those days to measure against. Their fuel is counted everywhere else in this report.",
    );
  }
}

/** "Pilot #442, Amarillo TX" — and never a stray comma when the station arrived without a city. */
function siteLabel(l: SpendLine): string {
  const place = [l.city, l.state].filter(Boolean).join(" ");
  return [l.site ?? "Unidentified site", place].filter(Boolean).join(", ");
}
