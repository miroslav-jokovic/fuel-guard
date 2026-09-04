import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetOverview from "./FleetOverview.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The overview, mounted (G5). July 2026's measured figures are the fixture, so a change that breaks
 * the page breaks against the month the owner has a printed statement for.
 *
 * What is pinned is what a reader would be misled by: a rate that is absent must never render as a
 * number, the contractor column must be readable beside the company one, and the empty-mile block
 * must disappear rather than show a nonsense percentage when miles could not be measured.
 */

const column = (o: Partial<FleetReportResponse["total"]> = {}): FleetReportResponse["total"] => ({
  trucks: 172,
  miles: 1_552_337,
  revenue: 4_828_189.24,
  expenses: 4_058_143.38,
  net: 770_045.86,
  revenuePerMile: 3.11,
  costPerMile: 2.61,
  netPerMile: 0.5,
  ...o,
});

const report = (o: Partial<FleetReportResponse> = {}): FleetReportResponse => ({
  period: { from: "2026-07-01", to: "2026-07-31" },
  total: column(),
  company: column({ trucks: 163, miles: 1_480_417, revenue: 4_590_612.95, expenses: 3_845_651.29, net: 744_961.66 }),
  ownerOperator: column({ trucks: 9, miles: 71_920, revenue: 237_576.29, expenses: 212_492.09, net: 25_084.2, revenuePerMile: 3.3, costPerMile: 2.95, netPerMile: 0.35 }),
  ownerOperatorBasis: {
    trucks: ["601", "602"],
    settlements: 69,
    pay: 212_492.09,
    loadRevenue: 203_192.01,
    deductionIncome: 34_384.28,
    unruledDeductions: 0,
  },
  billedMiles: 1_389_814,
  emptyMiles: 162_523,
  emptyPct: 10.5,
  revenuePerBilledMile: 3.47,
  mileageReason: null,
  statement: {
    sections: [],
    revenue: 4_828_189.24,
    expenses: 4_058_143.38,
    net: 770_045.86,
    toDateRevenue: null,
    toDateExpenses: null,
    toDateNet: null,
    unrecognisedNet: 0,
  },
  tieOut: { revenue: 0, expenses: 0 },
  monthsCovered: ["2026-07"],
  monthsMissing: [],
  toDateFrom: "2026-01-01",
  ...o,
});

const text = (o: Partial<FleetReportResponse> = {}) =>
  mount(FleetOverview, { props: { report: report(o) } }).text();

describe("FleetOverview", () => {
  it("leads with earned, spent and kept, each with its per-mile figure", () => {
    const t = text();
    expect(t).toContain("Earned");
    expect(t).toContain("$4,828,189");
    expect(t).toContain("$3.11 per mile driven");
    expect(t).toContain("$2.61 per mile driven");
    expect(t).toContain("$0.50 per mile driven");
  });

  it("shows contractors in their own column beside the company's", () => {
    const t = text();
    expect(t).toContain("Our trucks");
    expect(t).toContain("Contractors");
    expect(t).toContain("$4,590,613");
    expect(t).toContain("$237,576");
  });

  it("prints the contractor split's own arithmetic so a reader can check it", () => {
    const t = text();
    expect(t).toContain("2 contractor trucks");
    expect(t).toContain("$203,192");
    expect(t).toContain("$212,492");
  });

  it("prints a dash, never a number, when the period's mileage cannot support a rate", () => {
    const noRate = {
      total: column({ miles: null, trucks: null, revenuePerMile: null, costPerMile: null, netPerMile: null }),
      company: column({ miles: null, trucks: null, revenuePerMile: null, costPerMile: null, netPerMile: null }),
      ownerOperator: column({ miles: null, trucks: null, revenuePerMile: null, costPerMile: null, netPerMile: null }),
      emptyMiles: null,
      emptyPct: null,
      mileageReason: "Some trucks were not yet sending mileage in 2026-02",
    };
    const t = text(noRate);
    expect(t).toContain("per-mile figure not available");
    expect(t).not.toContain("$3.11");
    expect(t).not.toContain("$0.00");
    // The money still shows in full — it is complete and it ties.
    expect(t).toContain("$4,828,189");
  });

  it("hides the empty-mile block entirely rather than showing a nonsense percentage", () => {
    const t = text({ emptyMiles: null, emptyPct: null });
    expect(t).not.toContain("Miles with no load");
  });

  it("shows what running empty costs when the miles support it", () => {
    const t = text();
    expect(t).toContain("Miles with no load");
    expect(t).toContain("10.5% of everything driven");
    expect(t).toContain("$3.47");
  });

  it("names a month the McLeod sweep has not reached", () => {
    const t = text({ monthsMissing: ["2026-08"] });
    expect(t).toContain("has not reached 2026-08");
  });

  it("says where the numbers come from, without claiming anything is estimated", () => {
    const t = text();
    expect(t).toContain("McLeod's ledger");
    expect(t).toContain("Samsara");
    expect(t).toContain("Nothing here is estimated");
  });
});
