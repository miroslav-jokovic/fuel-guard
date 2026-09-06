import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetHeadlines from "./FleetHeadlines.vue";
import type { FleetReportResponse } from "./useFleetReport";
import type { FleetTrendResponse } from "./useFleetTrend";
import { periodForMonth, periodForQuarter, type ReportPeriod } from "@/lib/reportPeriod";

/**
 * The four headlines, mounted (R3, D-FRUI3). July 2026's measured figures against June's, so a
 * broken comparison breaks against the two months the owner has printed statements for. What is
 * pinned: kept leads with its change and the year to date; a rise in spending is red and a rise
 * in earnings green; a period with no predecessor says so; a quarter offers no month-on-month
 * change; a null rate is a dash with its reason and never $0.00; every tile draws a sparkline.
 */
const column = (o: Partial<FleetReportResponse["total"]> = {}): FleetReportResponse["total"] => ({
  trucks: 172, miles: 1_552_337, revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86,
  revenuePerMile: 3.11, costPerMile: 2.61, netPerMile: 0.5, ...o,
});
const report = (o: Partial<FleetReportResponse> = {}): FleetReportResponse => ({
  period: { from: "2026-07-01", to: "2026-07-31" },
  total: column(), company: column(), ownerOperator: column(),
  ownerOperatorBasis: { trucks: [], settlements: 0, pay: 0, loadRevenue: 0, deductionIncome: 0, unruledDeductions: 0 },
  billedMiles: 1_389_814, emptyMiles: 162_523, emptyPct: 10.5, revenuePerBilledMile: 3.47, mileageReason: null,
  statement: { sections: [], revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, toDateRevenue: 28_687_090.14, toDateExpenses: 25_126_042.28, toDateNet: 3_561_047.86, unrecognisedNet: 0 },
  tieOut: { revenue: 0, expenses: 0 }, monthsCovered: ["2026-07"], monthsMissing: [], monthsPartial: [], ledgerReason: null,
  families: { revenue: [], expense: [], tieOut: { revenue: 0, expenses: 0 } },
  sweptAt: "2026-08-28T21:02:56.551Z", trucks: [], ownerOperators: [], toDateFrom: "2026-01-01", ...o,
});
const point = (month: string, revenue: number, expenses: number, miles: number | null) => ({
  month, revenue, expenses, net: revenue - expenses, miles, trucks: miles ? 170 : null,
  revenuePerMile: miles ? revenue / miles : null, costPerMile: miles ? expenses / miles : null,
  netPerMile: miles ? (revenue - expenses) / miles : null, reason: miles ? null : "no coverage",
});
const trend = (): FleetTrendResponse => ({
  points: [point("2026-05", 4_390_379.55, 3_979_134.98, 1_563_003), point("2026-06", 5_107_789.04, 3_634_060.11, 1_574_109), point("2026-07", 4_828_189.24, 4_058_143.38, 1_552_337)],
  missing: [], rated: 3, monthsRequested: ["2026-05", "2026-06", "2026-07"], monthsPartial: [],
});

const mountIt = (period: ReportPeriod = periodForMonth("2026-07"), r = report(), t: FleetTrendResponse | null = trend()) =>
  mount(FleetHeadlines, { props: { report: r, trend: t, period } });

describe("FleetHeadlines", () => {
  it("leads with kept, its change against June and the year to date", () => {
    const w = mountIt();
    const first = w.findAll(".grid > *")[0]!;
    expect(first.text()).toContain("Kept");
    expect(first.text()).toContain("$770,046");
    expect(first.text()).toContain("−47.7% vs June $1,473,729");
    expect(first.text()).toContain("$3,561,048 year to date");
  });

  it("colours a rise in spending red and a fall in earnings red — direction, not sign", () => {
    const w = mountIt();
    const html = w.html();
    // Spent rose 11.7% against June: bad.
    expect(html).toMatch(/text-danger-700[^<]*>\s*\+11\.7% vs June/);
    // Earned fell 5.5%: also bad.
    expect(html).toMatch(/text-danger-700[^<]*>\s*−5\.5% vs June/);
  });

  it("says when there is no previous month, rather than printing nothing", () => {
    const w = mountIt(periodForMonth("2026-05"), report(), { ...trend(), points: [trend().points[0]!] });
    expect(w.text()).toContain("no previous month to compare");
  });

  it("offers no month-on-month change for a quarter, and says so", () => {
    const w = mountIt(periodForQuarter("2026-07"));
    expect(w.text()).toContain("quarter — no month-on-month change");
    expect(w.text()).not.toContain("vs June");
    expect(w.text()).toContain("$3,561,048 year to date");
  });

  it("prints a dash and the reason for kept per mile when the period has no rate, never $0.00", () => {
    const r = report({ total: column({ miles: null, revenuePerMile: null, costPerMile: null, netPerMile: null }), mileageReason: "February 2026: 16 trucks are missing from the miles" });
    const w = mountIt(periodForMonth("2026-07"), r);
    const last = w.findAll(".grid > *")[3]!;
    expect(last.text()).toContain("—");
    expect(last.text()).toContain("16 trucks are missing");
    expect(last.text()).not.toContain("$0.00");
  });

  it("states the change in kept per mile as dollars, not a percentage of a rate", () => {
    const w = mountIt();
    const last = w.findAll(".grid > *")[3]!;
    expect(last.text()).toContain("−$0.44 vs June $0.94");
  });

  it("draws a sparkline on every tile from the months up to the period", () => {
    const w = mountIt();
    expect(w.findAll("svg").length).toBe(4);
  });
});
