import { describe, it, expect } from "vitest";
import {
  costCards, costDayCells, costDayRows, comparingLine, spendChangeLine, fuelReportTotals, mpgCoverageLine, networkLine, FUEL_REPORT_TRUCK_FIGURES_NOTE,
  type FuelReport, type FuelReportDay,
} from "@silvicom/shared";
import { pdfDrawnLines, pdfPageTexts, pdfText } from "../../testing/pdfText.js";
import { winAnsi } from "../../lib/winAnsi.js";
import type { FuelReportFilterArgs } from "./fuelReport.js";
import { CARD_COLUMNS, COSTS_REPORT_CONTENT_W, composeCostsReport, dayColumns, scopeFields } from "./fuelCostsReport.js";

/**
 * The Fuel Costs document (FS-PDF, Q-FSV14). It has no arithmetic of its own, so what is worth pinning is the
 * promise in its header: every figure and sentence it prints is the one the screen prints for the same
 * report, every filter that narrowed the figures is on its first page, and a long range paginates rather
 * than running off the page. The expected strings below come from the SAME shared functions the web page
 * calls, not from literals, so this is a test of the wiring rather than a second copy of the wording.
 */
const day = (d: string, o: Partial<FuelReportDay> = {}): FuelReportDay => ({
  day: d, network: "in", tank: "tractor", fills: 2, gallons: 210, spend: 850, retailFills: 2, retailGallons: 210, retailSpend: 900,
  retail: 900, contractFills: 2, contractGallons: 210, contractSpend: 850, contract: 842, ...o,
});

/** `n` consecutive days ending 2026-09-30, so the report's range and its rows agree. */
const daysEndingSep30 = (n: number) => {
  const end = Date.UTC(2026, 8, 30);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
};

function report(o: { days?: number; station?: boolean } = {}): FuelReport {
  const n = o.days ?? 30;
  const range = daysEndingSep30(n);
  const cur: FuelReportDay[] = range.map((d, i) => day(d, i % 4 === 0 ? { network: "out", spend: 600, gallons: 150 } : {}));
  const prev = [day("2026-08-01", { spend: 700 })];
  const eff = (m: number) => ({
    mpg: {
      mpg: m, ratio: m, milesSource: "measured" as const, miles: 9000, gallons: 1400, gallonsWithMiles: 1400, measuredShare: 0.92,
      truckCoverage: 1, trucksMeasured: 4, trucksUnmeasured: 0, reason: null, from: "2026-09-01", to: "2026-09-30",
      requestedTo: "2026-09-30", partial: false, fuelThrough: "2026-09-30", timezone: "America/Chicago", trucksFuelled: 4,
      unattributedGallons: 0, readings: 40,
    },
    costPerMile: 0.6,
  });
  return {
    current: { from: range[0]!, to: "2026-09-30", days: cur, totals: fuelReportTotals(cur), efficiency: o.station ? null : eff(6.5) },
    previous: { from: "2026-08-01", to: "2026-08-31", days: prev, totals: fuelReportTotals(prev), efficiency: o.station ? null : eff(6.4) },
    trailingMpg: o.station ? null : cur.map((d) => ({ day: d.day, mpg: 6.5, measuredShare: 1, reason: null })),
    inNetworkBrands: ["pilot", "flying_j"],
    sites: [],
  } as FuelReport;
}

const NO_FILTERS: FuelReportFilterArgs = { vehicleIds: [], states: [], siteIds: [], networks: [] };
const render = (r: FuelReport, filters = NO_FILTERS) => composeCostsReport(r, { carrier: "Acme Freight", filters, generatedAt: "2026-10-03T12:00:00Z" });
/**
 * Compare as the document prints it: through `winAnsi` (the fold the PDF fonts need; `−` and `–` become `-`) and
 * with whitespace collapsed, since pdfjs splits a cell into runs. The EXPECTED side is the screen's string run
 * through the same fold, so a wording change on the screen is a failure here and a font fold is not.
 */
const flat = (s: string) => winAnsi(s).replace(/\s+/g, "");

describe("the Fuel Costs document", () => {
  it("prints the cards, sentences and day rows the screen prints for the same report", async () => {
    const r = report();
    const { pdf } = await render(r);
    const text = flat(await pdfText(pdf));
    for (const c of costCards(r)) {
      expect(text, c.label).toContain(flat(c.label));
      expect(text, `${c.label} value`).toContain(flat(c.value));
      expect(text, `${c.label} change`).toContain(flat(c.sub));
    }
    expect(text).toContain(flat(comparingLine(r)));
    expect(text).toContain(flat(spendChangeLine(r)));
    expect(text).toContain(flat(mpgCoverageLine(r)!));
    expect(text).toContain(flat(networkLine(r)!));
    // A day row: the newest day, cell by cell, from the function the table uses.
    const dayTable = text.slice(text.indexOf(flat("By day")));
    expect(dayTable).toContain(flat(costDayCells(costDayRows(r)[0]!).join("")));
  });

  it("puts every filter that narrowed the figures on the first page", async () => {
    const filters: FuelReportFilterArgs = { vehicleIds: ["a", "b"], states: ["TX", "CA"], siteIds: ["s1"], networks: ["out"] };
    const [first] = await pdfPageTexts((await render(report(), filters)).pdf);
    const t = flat(first!);
    expect(t).toContain(flat("2 trucks"));
    expect(t).toContain(flat("Texas, California"));
    expect(t).toContain(flat("1 location"));
    expect(t).toContain(flat("Out of network"));
    expect(flat(await pdfText((await render(report())).pdf))).toContain(flat("All stations"));
  });

  it("grows the scope strip to a long station filter, so it never runs into the spend band below", async () => {
    // Every station filter at once wraps the Stations value to several lines (seen rasterised 2026-10-03:
    // four lines in a one-line strip, the last on top of "Fuel spend").
    const filters: FuelReportFilterArgs = { vehicleIds: ["a"], states: ["TX", "CA", "NM", "OK", "AZ"], siteIds: ["s1", "s2", "s3"], networks: ["in", "out", "unknown"] };
    const lines = (await pdfDrawnLines((await render(report({ station: true }), filters)).pdf)).filter((l) => l.page === 0);
    const band = lines.find((l) => l.text.startsWith("Fuel spend $"))!;
    expect(band, "the spend band").toBeTruthy();
    const scope = lines.filter((l) => l.y < band.y && /Station not identified|identified|network/.test(l.text));
    expect(scope.length, "the wrapped Stations value").toBeGreaterThan(0);
    // `verdictBand` draws its title 11pt below its top edge; 14 asks for 3pt of air under the last scope line.
    for (const l of scope) expect(band.y - 14 - (l.y + l.size), l.text).toBeGreaterThan(0);
  });

  it("says why miles, MPG and cost per mile are absent under a station filter, as the screen does", async () => {
    const r = report({ station: true });
    const text = flat(await pdfText((await render(r, { ...NO_FILTERS, states: ["TX"] })).pdf));
    expect(text).toContain(flat(FUEL_REPORT_TRUCK_FIGURES_NOTE));
    expect(text).not.toContain(flat("MPG — previous 7 days"));
    expect(costCards(r).map((c) => c.key)).not.toContain("mpg");
  });

  it("paginates a long range instead of drawing past the page, and keeps every day", async () => {
    const r = report({ days: 90 });
    const { pdf, pages } = await render(r);
    const texts = await pdfPageTexts(pdf);
    expect(pages).toBeGreaterThan(1);
    expect(texts).toHaveLength(pages);
    const all = flat(texts.join(" "));
    for (const row of costDayRows(r)) expect(all).toContain(flat(costDayCells(row)[0]!));
  });

  it("scopeFields names trucks, states, locations and networks, and 'All' when nothing narrowed", () => {
    expect(scopeFields(NO_FILTERS)).toEqual([{ label: "Trucks", value: "All trucks" }, { label: "Stations", value: "All stations" }]);
    expect(scopeFields({ vehicleIds: ["a"], states: [], siteIds: [], networks: ["in", "unknown"] })).toEqual([
      { label: "Trucks", value: "1 truck" }, { label: "Stations", value: "In network, Station not identified" },
    ]);
  });

  // Like `fuelSpendReport.widths.test.ts` for the older document: a column wider than the page is drawn
  // past the right margin and cut in half, and no text assertion above would notice.
  it("keeps every table inside the content width", () => {
    for (const cols of [CARD_COLUMNS, dayColumns(true), dayColumns(false)]) {
      expect(cols.reduce((a, c) => a + c.width, 0)).toBeLessThanOrEqual(COSTS_REPORT_CONTENT_W);
    }
    expect(dayColumns(true)).toHaveLength(9);
    expect(dayColumns(false)).toHaveLength(8);
  });
});
