import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FleetOverview from "./FleetOverview.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The overview, mounted (G5, R4). July 2026's measured figures are the fixture, so a change that
 * breaks the page breaks against the month the owner has a printed statement for.
 *
 * What is pinned is what a reader would be misled by: a period with no reportable month prints no
 * money at all rather than zeros (G11), a finished month prints its figures even beside an
 * unfinished one, and the source sentence never claims an estimate. The split and the headlines
 * have their own tests since R3/R4 (`FleetSplitCard`, `FleetHeadlines`).
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
  ownerOperatorBasis: { trucks: ["601", "602"], settlements: 69, pay: 212_492.09, loadRevenue: 203_192.01, deductionIncome: 34_384.28, unruledDeductions: 0 },
  billedMiles: 1_389_814,
  emptyMiles: 162_523,
  emptyPct: 10.5,
  revenuePerBilledMile: 3.47,
  mileageReason: null,
  statement: { sections: [], revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, toDateRevenue: null, toDateExpenses: null, toDateNet: null, unrecognisedNet: 0 },
  tieOut: { revenue: 0, expenses: 0 },
  monthsCovered: ["2026-07"],
  monthsMissing: [],
  monthsPartial: [],
  ledgerReason: null,
  families: {
    revenue: [],
    expense: [{ key: "fuel", label: "Fuel and fluids", isRevenue: false, isUnassigned: false, amount: 1_010_000, toDateAmount: null, pctOfRevenue: 20.9, toDatePctOfRevenue: null, perMile: 0.65, accounts: 3 }],
    tieOut: { revenue: 0, expenses: 0 },
  },
  sweptAt: "2026-08-28T21:02:56.551Z",
  trucks: [],
  ownerOperators: [],
  toDateFrom: "2026-01-01",
  ...o,
});

const text = (o: Partial<FleetReportResponse> = {}) => mount(FleetOverview, { props: { report: report(o) } }).text();

describe("FleetOverview", () => {
  it("shows where the money went and how far the fleet ran", () => {
    const t = text();
    expect(t).toContain("Where every dollar went");
    expect(t).toContain("Fuel and fluids");
    expect(t).toContain("Miles driven and miles billed");
    expect(t).toContain("10.5%");
  });

  it("names a month the McLeod sweep has not reached", () => {
    expect(text({ monthsMissing: ["2026-08"] })).toContain("has not reached 2026-08");
  });

  it("says where the numbers come from, without claiming anything is estimated", () => {
    const t = text();
    expect(t).toContain("McLeod's ledger");
    expect(t).toContain("Samsara");
    expect(t).toContain("Nothing here is estimated");
  });

  /**
   * The state the page was actually in on the morning of 2026-09-03. Its default window was the
   * last full calendar month — August — whose ledger held eleven lines swept four days before the
   * month ended. Rendered as figures, that reads "$0 earned, $8,430 spent, −$8,430 kept": every
   * number correct over the rows that were there, and none of them a fact about August (G11).
   */
  it("prints no money at all when every month of the period was withheld", () => {
    const t = text({
      total: column({ trucks: null, miles: null, revenue: 0, expenses: 8430, net: -8430, revenuePerMile: null, costPerMile: null, netPerMile: null }),
      monthsCovered: [],
      monthsPartial: [{ month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-08-28 21:02:56.551+00", complete: false, shortfall: "partial" }],
      ledgerReason: "2026-08 (swept 2026-08-28) was swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.",
    });
    expect(t).toContain("no figures for this period yet");
    expect(t).toContain("2026-08-28");
    expect(t).not.toContain("$8,430");
    expect(t).not.toContain("$0");
  });

  it("still prints the figures when the period has a finished month", () => {
    const t = text();
    expect(t).not.toContain("no figures for this period yet");
    expect(t).toContain("$4,828,189");
  });

  /**
   * A two-month window where only the newer month is unfinished still HAS an answer — July's. The
   * withheld state is for a period with no reportable month at all, not for any period that touches
   * one, or a reader asking for "July and August so far" would be shown nothing.
   */
  it("still prints the figures when one month of the window is finished and another is not", () => {
    const t = text({
      monthsCovered: ["2026-07"],
      monthsPartial: [{ month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-08-28 21:02:56.551+00", complete: false, shortfall: "partial" }],
      ledgerReason: "2026-08 (swept 2026-08-28) was swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.",
    });
    expect(t).toContain("$4,828,189");
    expect(t).not.toContain("no figures for this period yet");
    expect(t).toContain("swept before the month ended");
  });
});
