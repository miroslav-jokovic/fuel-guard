/**
 * The report's SECTIONS — everything that puts marks on a page.
 *
 * Split from `fuelSpendReport` when that file reached the 500-line budget, along the seam it already
 * had: this decides what a section says and how it looks; the other decides what data a section gets.
 * Every function here takes finished figures and draws them, so none of them can compute anything and
 * quietly disagree with the page.
 */
import {
  analyzePolicyExceptions,
  operatingBridge,
  type DiscountCapture,
  type FleetIdleVerdict,
  type SpendGrain,
  type SpendLine,
  type SpendPeriod,
} from "@fuelguard/shared";
import { CONTENT_WIDTH, INK, MUTED, body, heading, muted, table, winAnsi } from "./dqBinder/pdfDraw.js";
import { keepTogether, kpiRow, money, waterfall, type Kpi } from "./fuelSpendReportDraw.js";
import { num, usd, usd2, usd3, change } from "./fuelSpendReportFormat.js";

// ── sections ────────────────────────────────────────────────────────────────────────────────────

export function drawHeadline(
  doc: PDFKit.PDFDocument,
  overall: SpendPeriod,
  cmp: { prior: SpendPeriod; current: SpendPeriod } | null,
): void {
  const c = cmp?.current;
  const p = cmp?.prior;
  const kpis: Kpi[] = [
    { label: "Fuel spend", value: usd(c?.spend ?? overall.spend), ...change(p?.spend, c?.spend, true) },
    { label: "Gallons", value: num(c?.gallons ?? overall.gallons), ...change(p?.gallons, c?.gallons, true) },
    { label: "Paid / gal", value: usd3(c?.pricePerGal ?? overall.pricePerGal), ...change(p?.pricePerGal, c?.pricePerGal, true) },
    { label: "Cost / mile", value: usd2(c?.costPerMile ?? overall.costPerMile), ...change(p?.costPerMile, c?.costPerMile, true) },
    { label: "Fleet MPG", value: c?.mpg?.toFixed(2) ?? overall.mpg?.toFixed(2) ?? "-", ...change(p?.mpg, c?.mpg, false) },
  ];
  kpiRow(doc, kpis);
}

export function drawBridge(doc: PDFKit.PDFDocument, cmp: { prior: SpendPeriod; current: SpendPeriod } | null): void {
  heading(doc, "Why spend moved");
  if (!cmp) {
    muted(doc, "Two complete periods are needed before a change can be explained against anything.");
    return;
  }
  const b = operatingBridge(cmp.prior, cmp.current);

  // The plain-English answer first. Somebody reads one sentence of a report and this is it.
  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(
    winAnsi(
      `Tractor fuel went ${usd(cmp.prior.spend)} to ${usd(cmp.current.spend)}, a change of ${money(b.deltaSpend)}. ` +
        (b.volumeSplit
          ? `The fleet covered ${num(cmp.current.miles)} miles against ${num(cmp.prior.miles)}, at ${usd3(cmp.current.pricePerGal)} a gallon against ${usd3(cmp.prior.pricePerGal)}.`
          : ""),
    ),
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.6);

  waterfall(doc, b.terms.map((t) => ({ label: t.label, dollars: t.dollars, detail: t.detail })), b.deltaSpend);

  if (b.volumeSplit) {
    const m = b.volumeSplit.milesFrom;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
      winAnsi(
        `Distance splits into ${num(m.trucks)} miles from running ${cmp.current.activeTrucks} trucks against ${cmp.prior.activeTrucks}, ` +
          `and ${num(m.perTruck)} miles from each covering ${num(cmp.current.milesPerTruck)} against ${num(cmp.prior.milesPerTruck)}. ` +
          `Components sum to the change exactly${b.tiesOut ? "" : " — RESIDUAL PRESENT, the decomposition is wrong"}.`,
      ),
      { width: CONTENT_WIDTH },
    );
  }
  if (b.withheld) {
    doc.moveDown(0.3);
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text(winAnsi(b.withheld), { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.4);
}

/**
 * Idling, with the verdict rather than a total charged as waste.
 *
 * ── WHAT THIS SECTION USED TO GET WRONG, TWICE ──────────────────────────────────────────────────
 * First it multiplied idle seconds by a burn rate and printed the whole thing in red — the
 * every-truck-is-avoidable over-count `docs/plans/IDLE-AVOIDABLE-HOS.md` exists to prevent. Then it
 * dropped the money entirely, which was honest but told a boss to go and look somewhere else.
 *
 * It now reports what `computeAvoidable` decided, and the three numbers stay apart because they mean
 * different things: idle hours are a fact about running trucks, AVOIDABLE is the only figure that is
 * anyone's fault, and REDUCIBLE is a capex case for equipping the trucks that had no alternative.
 * Only a truck with an admin-confirmed APU or Optimized Idle can contribute to the middle one.
 */
export function drawIdle(
  doc: PDFKit.PDFDocument,
  series: SpendPeriod[],
  grain: SpendGrain,
  idle: FleetIdleVerdict | null,
): void {
  keepTogether(doc, 110);
  heading(doc, "Idling");
  const withheld = series.filter((p) => !p.idleUsable && p.idleCoverage != null);
  if (!idle || idle.idleH === 0) {
    muted(doc, "No idle measured in this range with enough engine-feed coverage to judge.");
    return;
  }

  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(
    winAnsi(
      `The fleet idled ${num(idle.idleH)} hours — ${idle.idlePct.toFixed(1)}% of every hour an engine was running. ` +
        `Of that, ${num(idle.avoidableH)} hours worth ${usd(idle.avoidableUsd)} were avoidable: idle on the ` +
        `${idle.confidentTrucks} truck(s) that had a confirmed APU or Optimized Idle and could have rested without ` +
        `running the main engine.`,
    ),
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.4);
  body(
    doc,
    `A further ${usd(idle.reducibleUsd)} (${num(idle.reducibleH)} hours) is REDUCIBLE across ${idle.reducibleTrucks} ` +
      `truck(s) — what the same rest idle would be worth if the trucks that lack the equipment had it. That is a case ` +
      `for buying APUs, not a performance figure: those drivers had no alternative and are not being blamed for it.`,
    MUTED,
  );
  doc.moveDown(0.25);
  body(
    doc,
    `Judged over ${idle.rangeDays} day(s) across ${idle.totalTrucks} truck(s), of which ${idle.confidentTrucks} had ` +
      "enough engine-feed coverage to score. Avoidability comes only from admin-confirmed equipment — a diesel APU is " +
      "invisible to telematics, so behaviour learned from the truck is never allowed to make idle somebody's fault.",
    MUTED,
  );
  if (withheld.length > 0) {
    doc.moveDown(0.2);
    body(
      doc,
      `${withheld.length} ${grain}(s) of the fuel table are marked "-" for idle share: the engine feed covered too ` +
        "little of those days to measure against. Their fuel is counted everywhere else in this report.",
      MUTED,
    );
  }
  doc.moveDown(0.3);
}

export function drawSeries(doc: PDFKit.PDFDocument, series: SpendPeriod[], grain: SpendGrain): void {
  keepTogether(doc, 120);
  heading(doc, grain === "day" ? "Day by day" : grain === "month" ? "Month by month" : "Week by week");
  // Widths must sum to CONTENT_WIDTH (504pt) or less — `table` does not wrap or shrink them, it draws
  // past the right margin, which is how the idle column arrived clipped in half on the first render.
  const cols = [
    { width: 92, header: "Period" },
    { width: 40, header: "Trucks", align: "right" as const },
    { width: 56, header: "Gallons", align: "right" as const },
    { width: 68, header: "Fuel spend", align: "right" as const },
    { width: 52, header: "Paid / gal", align: "right" as const },
    { width: 58, header: "Miles", align: "right" as const },
    { width: 36, header: "MPG", align: "right" as const },
    { width: 52, header: "$ / mile", align: "right" as const },
    { width: 50, header: "Idle", align: "right" as const },
  ];
  // Newest first, and a period still filling is kept but LABELLED. Dropping it hides the most recent
  // days from a reader looking for them; leaving it unmarked invites the comparison the bridge
  // deliberately refuses to make, which is how a one-day week reads as a collapse in spend.
  const rows = [...series].reverse().map((p) => [
    { text: periodLabel(p, grain), sub: p.partial ? "in progress" : undefined },
    { text: String(p.activeTrucks) },
    { text: num(p.gallons) },
    { text: usd(p.spend), bold: true },
    { text: usd3(p.pricePerGal) },
    { text: num(p.miles) },
    { text: p.mpg?.toFixed(2) ?? "—" },
    { text: usd2(p.costPerMile) },
    // The SHARE, not a cost: how much of this truck-time was stationary is a fact; what it was worth
    // in blame is not this report's to say.
    { text: p.idleShare == null ? "-" : `${(p.idleShare * 100).toFixed(0)}%` },
  ]);
  table(doc, cols, rows);
}

/**
 * Discount capture — what the contract took off the posted price, and where it took off least.
 *
 * ── WHY THE COVERAGE LINE IS NOT OPTIONAL ───────────────────────────────────────────────────────
 * Only fills matched to a posted price for that station on that day can be measured, and the price
 * reports only go back as far as somebody uploaded them. A reader shown "$80,036 captured" without
 * being told it describes 83% of the gallons — or 21%, on a window reaching before the reports start —
 * will read a partial measurement as a complete one. The shortfall in the section is a shortfall
 * against the fills we can see, not against the fuel bill.
 */
export function drawDiscount(doc: PDFKit.PDFDocument, capture: DiscountCapture, lines: SpendLine[]): void {
  keepTogether(doc, 120);
  heading(doc, "Discount capture");

  const tractor = lines.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0);
  const priced = tractor.filter((l) => l.retailAmount != null);
  if (priced.length === 0) {
    muted(
      doc,
      "No fill in this period could be matched to a posted price, so the discount cannot be measured. " +
        "Posted prices come from the daily price report; upload the days this period covers to fill it in.",
    );
    return;
  }
  const gal = priced.reduce((a, l) => a + l.gallons, 0);
  const paid = priced.reduce((a, l) => a + (l.netAmount ?? 0), 0);
  const retail = priced.reduce((a, l) => a + (l.retailAmount ?? 0), 0);
  const coverageGal = tractor.reduce((a, l) => a + l.gallons, 0);

  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(
    winAnsi(
      `Across ${num(gal)} measurable gallons the posted price was ${usd3(retail / gal)} a gallon and we paid ` +
        `${usd3(paid / gal)} — a captured discount of ${usd(retail - paid)}, ${usd3((retail - paid) / gal)} a gallon.`,
    ),
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.35);
  body(
    doc,
    `Measured on ${priced.length.toLocaleString()} of ${tractor.length.toLocaleString()} fills — ` +
      `${((gal / (coverageGal || 1)) * 100).toFixed(0)}% of the gallons. The rest were bought where no price report ` +
      "covers that day, so what they should have cost is unknown; they are left out rather than counted as having " +
      "captured nothing.",
    MUTED,
  );
  doc.moveDown(0.35);

  const worst = capture.bySite.filter((r) => r.shortfall > 0).slice(0, 8);
  if (worst.length > 0) {
    body(
      doc,
      `Benchmarked against ${usd3(capture.benchmarkPerGal)} a gallon — this period's own median capture, so a moving ` +
        "market cannot invent a gap. The sites furthest below it:",
      MUTED,
    );
    doc.moveDown(0.2);
    table(
      doc,
      [
        // Header text must FIT its column: `table` does not shrink or wrap a header, it lets it run
        // into the next one, and "Captured / gal" beside "Below benchmark" came out as two collided
        // lines of grey.
        { width: 186, header: "Site" },
        { width: 44, header: "Fills", align: "right" },
        { width: 62, header: "Gallons", align: "right" },
        { width: 72, header: "Spend", align: "right" },
        { width: 68, header: "Capt/gal", align: "right" },
        { width: 72, header: "Shortfall", align: "right" },
      ],
      worst.map((r) => [
        { text: r.key },
        { text: String(r.lines) },
        { text: num(r.gallons) },
        { text: usd(r.spend) },
        { text: usd3(r.discountPerGal) },
        { text: usd(r.shortfall), bold: true },
      ]),
    );
  }
  if (capture.zeroDiscount.length > 0) {
    body(
      doc,
      `${capture.zeroDiscount.length} fill(s) captured no discount at all. On every statement examined so far, ` +
        "each one of those was an off-brand site.",
      MUTED,
    );
  }
  doc.moveDown(0.3);
}

export function drawExceptions(doc: PDFKit.PDFDocument, ex: ReturnType<typeof analyzePolicyExceptions>, overall: SpendPeriod): void {
  keepTogether(doc, 130);
  heading(doc, "Where the fuel policy was not followed");
  const share = (g: number) => (overall.gallons > 0 ? `${((g / overall.gallons) * 100).toFixed(1)}%` : "—");
  const reports = [
    { name: "Avoided brands (ONE9 and other off-brand)", r: ex.avoidedBrands },
    { name: "California", r: ex.avoidedStates },
    { name: "Off the preferred network", r: ex.offNetwork },
  ];
  if (reports.every((x) => x.r.lines === 0)) {
    muted(doc, "No fills outside the fuel policy in this window.");
    return;
  }
  table(
    doc,
    [
      { width: 190, header: "Exception" },
      { width: 48, header: "Fills", align: "right" },
      { width: 66, header: "Gallons", align: "right" },
      { width: 52, header: "Share", align: "right" },
      { width: 74, header: "Spend", align: "right" },
      { width: 74, header: "Excess", align: "right" },
    ],
    reports.map((x) => [
      { text: x.name, sub: x.r.netPerGal != null ? `${usd3(x.r.netPerGal)}/gal against ${usd3(x.r.baselinePerGal)} elsewhere` : undefined },
      { text: String(x.r.lines) },
      { text: num(x.r.gallons) },
      { text: share(x.r.gallons) },
      { text: usd(x.r.spend) },
      { text: usd(x.r.excess), bold: true },
    ]),
  );
  body(
    doc,
    "Excess is what these gallons cost above what the rest of the fleet paid over the same period — not against a fixed price, which in a moving market invents a finding every time diesel rises.",
    MUTED,
  );

  // The summary above says how much; this says WHERE, which is the only part anybody can act on. The
  // page lists every fill — a document cannot, so it lists the sites and trucks the money is at.
  for (const x of reports) {
    const sites = x.r.bySite.filter((g) => g.excess > 0).slice(0, 5);
    const units = x.r.byUnit.filter((g) => g.excess > 0).slice(0, 5);
    if (sites.length === 0 && units.length === 0) continue;
    // Heading + column header + two rows, or start the block on the next page.
    keepTogether(doc, 110);
    doc.moveDown(0.35);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(winAnsi(x.name), { width: CONTENT_WIDTH });
    doc.moveDown(0.15);
    table(
      doc,
      [
        // A spacer column between the two rankings. Without it a right-aligned "EXCESS" sits flush
        // against the left-aligned "TRUCK" and the header reads "EXCESSTRUCK".
        { width: 150, header: "Site" },
        { width: 38, header: "Fills", align: "right" },
        { width: 54, header: "Gallons", align: "right" },
        { width: 58, header: "Excess", align: "right" },
        { width: 22, header: "" },
        { width: 100, header: "Truck" },
        { width: 82, header: "Excess", align: "right" },
      ],
      Array.from({ length: Math.max(sites.length, units.length) }, (_, i) => {
        const st = sites[i];
        const un = units[i];
        return [
          { text: st ? st.key : "" },
          { text: st ? String(st.lines) : "" },
          { text: st ? num(st.gallons) : "" },
          { text: st ? usd(st.excess) : "" },
          // A SPACE, not "": `table` renders an empty cell as an em-dash, which is right for a missing
          // value and wrong for a gutter — it came out as "$102 — Unit 569".
          { text: " " },
          { text: un ? `Unit ${un.key}` : "" },
          { text: un ? usd(un.excess) : "" },
        ];
      }),
    );
  }
}

/** "2026-08-17 - 2026-08-23", or just the date when a clamped period covers a single day. */
function periodLabel(p: SpendPeriod, grain: SpendGrain): string {
  if (grain === "day" || p.from === p.to) return p.from;
  return `${p.from} - ${p.to}`;
}
