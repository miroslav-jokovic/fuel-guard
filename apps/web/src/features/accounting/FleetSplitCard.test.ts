import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetSplitCard from "./FleetSplitCard.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The company / contractor split, mounted (R4, moved from the Overview at D-FRUI6). Pinned, as
 * before the move: contractors sit in their own column beside the company's, the split's own
 * arithmetic is printed so it can be checked, and a period with no rate prints a dash and never a
 * number.
 */
const column = (o: Partial<FleetReportResponse["total"]> = {}): FleetReportResponse["total"] => ({
  trucks: 172, miles: 1_552_337, revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86,
  revenuePerMile: 3.11, costPerMile: 2.61, netPerMile: 0.5, ...o,
});
const report = (o: Partial<FleetReportResponse> = {}): FleetReportResponse => ({
  period: { from: "2026-07-01", to: "2026-07-31" },
  total: column(),
  company: column({ trucks: 163, miles: 1_480_417, revenue: 4_590_612.95, expenses: 3_845_651.29, net: 744_961.66, revenuePerMile: 3.1, costPerMile: 2.6, netPerMile: 0.51 }),
  ownerOperator: column({ trucks: 9, miles: 71_920, revenue: 237_576.29, expenses: 212_492.09, net: 25_084.2, revenuePerMile: 3.3, costPerMile: 2.95, netPerMile: 0.35 }),
  ownerOperatorBasis: { trucks: ["601", "602"], settlements: 69, pay: 212_492.09, loadRevenue: 203_192.01, deductionIncome: 34_384.28, unruledDeductions: 0 },
  billedMiles: 1_389_814, emptyMiles: 162_523, emptyPct: 10.5, revenuePerBilledMile: 3.47, mileageReason: null,
  statement: { sections: [], revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, toDateRevenue: null, toDateExpenses: null, toDateNet: null, unrecognisedNet: 0 },
  tieOut: { revenue: 0, expenses: 0 }, monthsCovered: ["2026-07"], monthsMissing: [], monthsPartial: [], ledgerReason: null,
  families: { revenue: [], expense: [], tieOut: { revenue: 0, expenses: 0 } },
  sweptAt: "2026-08-28T21:02:56.551Z", trucks: [], ownerOperators: [], toDateFrom: "2026-01-01", ...o,
});
const text = (o: Partial<FleetReportResponse> = {}) => mount(FleetSplitCard, { props: { report: report(o) } }).text();

describe("FleetSplitCard", () => {
  it("shows contractors in their own column beside the company's", () => {
    const t = text();
    expect(t).toContain("Our trucks");
    expect(t).toContain("Contractors");
    expect(t).toContain("$4,590,613");
    expect(t).toContain("$237,576");
    expect(t).toContain("$4,828,189");
    expect(t).toContain("$0.51");
    expect(t).toContain("$0.35");
  });

  it("prints the contractor split's own arithmetic so a reader can check it", () => {
    const t = text();
    expect(t).toContain("2 contractor trucks");
    expect(t).toContain("$203,192");
    expect(t).toContain("$212,492");
  });

  it("prints a dash, never a number, when the period's mileage cannot support a rate", () => {
    const none = { miles: null, trucks: null, revenuePerMile: null, costPerMile: null, netPerMile: null };
    const t = text({ total: column(none), company: column(none), ownerOperator: column(none) });
    expect(t).toContain("—");
    expect(t).not.toContain("$3.11");
    expect(t).not.toContain("$0.00");
    expect(t).toContain("$4,828,189");
  });
});
