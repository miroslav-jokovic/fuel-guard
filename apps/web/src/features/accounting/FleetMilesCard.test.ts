import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetMilesCard from "./FleetMilesCard.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The miles card, mounted (R4, G9). Pinned: driven, billed and the empty share print with their
 * sources named; the two rates are labelled by their denominators; a period whose mileage could
 * not cover the fleet prints the reason and no bar, never 0%.
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
  statement: { sections: [], revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, toDateRevenue: null, toDateExpenses: null, toDateNet: null, unrecognisedNet: 0 },
  tieOut: { revenue: 0, expenses: 0 }, monthsCovered: ["2026-07"], monthsMissing: [], monthsPartial: [], ledgerReason: null,
  families: { revenue: [], expense: [], tieOut: { revenue: 0, expenses: 0 } },
  sweptAt: "2026-08-28T21:02:56.551Z", trucks: [], ownerOperators: [], toDateFrom: "2026-01-01", ...o,
});

describe("FleetMilesCard", () => {
  it("prints driven, billed and the empty share, each with its source", () => {
    const w = mount(FleetMilesCard, { props: { report: report() } });
    const t = w.text();
    expect(t).toContain("1,552,337");
    expect(t).toContain("(Samsara)");
    expect(t).toContain("1,389,814");
    expect(t).toContain("(McLeod)");
    expect(t).toContain("162,523 · 10.5%");
    expect(w.find('[aria-hidden="true"] span').attributes("style")).toContain("10.5%");
  });

  it("labels each rate by its denominator", () => {
    const t = mount(FleetMilesCard, { props: { report: report() } }).text();
    expect(t).toContain("Earned per billed mile");
    expect(t).toContain("$3.47");
    expect(t).toContain("Earned per mile driven");
    expect(t).toContain("$3.11");
  });

  it("prints the reason and no bar when the period's mileage cannot support an empty share", () => {
    const w = mount(FleetMilesCard, {
      props: { report: report({ emptyMiles: null, emptyPct: null, mileageReason: "February 2026: 16 trucks that delivered loads are missing from the miles." }) },
    });
    expect(w.text()).toContain("No empty-mile figure for this period");
    expect(w.text()).toContain("16 trucks");
    expect(w.text()).not.toContain("0.0%");
    expect(w.find('[aria-hidden="true"]').exists()).toBe(false);
  });
});
