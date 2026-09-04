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
  monthsPartial: [],
  ledgerReason: null,
  families: { revenue: [], expense: [], tieOut: { revenue: 0, expenses: 0 } },
  sweptAt: "2026-08-28T21:02:56.551Z",
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

  /**
   * The state the page was actually in on the morning of 2026-09-03. Its default window is the last
   * full calendar month — August — whose ledger held eleven lines swept four days before the month
   * ended. Rendered as figures, that reads "$0 earned, $8,430 spent, −$8,430 kept": every number
   * correct over the rows that were there, and none of them a fact about August (G11).
   */
  it("prints no money at all when every month of the period was withheld", () => {
    const w = mount(FleetOverview, {
      props: {
        report: report({
          total: column({ trucks: null, miles: null, revenue: 0, expenses: 8430, net: -8430, revenuePerMile: null, costPerMile: null, netPerMile: null }),
          monthsCovered: [],
          monthsPartial: [
            { month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-08-28 21:02:56.551+00", complete: false, shortfall: "partial" },
          ],
          ledgerReason:
            "2026-08 (swept 2026-08-28) was swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.",
        }),
      },
    });
    expect(w.text()).toContain("no figures for this period yet");
    expect(w.text()).toContain("2026-08-28");
    // Not the zeros, and not the partial expense either.
    expect(w.text()).not.toContain("$8,430");
    expect(w.text()).not.toContain("$0");
  });

  it("still prints the figures when the period has a finished month", () => {
    const w = mount(FleetOverview, { props: { report: report() } });
    expect(w.text()).not.toContain("no figures for this period yet");
    expect(w.text()).toContain("$4,828,189");
  });

  /**
   * A two-month window where only the newer month is unfinished still HAS an answer — July's. The
   * withheld state is for a period with no reportable month at all, not for any period that touches
   * one, or a reader asking for "July and August so far" would be shown nothing.
   */
  it("still prints the figures when one month of the window is finished and another is not", () => {
    const w = mount(FleetOverview, {
      props: {
        report: report({
          monthsCovered: ["2026-07"],
          monthsPartial: [
            { month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-08-28 21:02:56.551+00", complete: false, shortfall: "partial" },
          ],
          ledgerReason: "2026-08 (swept 2026-08-28) was swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.",
        }),
      },
    });
    expect(w.text()).toContain("$4,828,189");
    expect(w.text()).not.toContain("no figures for this period yet");
    // The reason still travels with the figures, so nobody reads July's total as July-and-August.
    expect(w.text()).toContain("swept before the month ended");
  });
});
