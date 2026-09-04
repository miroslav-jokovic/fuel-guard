import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import IncomeStatementTab from "./IncomeStatementTab.vue";
import type { IncomeStatementResponse, StatementCompare } from "./useIncomeStatement";
import { periodForMonth, periodForQuarter } from "@/lib/reportPeriod";

/**
 * The income statement tab, mounted (R6). Pinned: the comparative column is labelled by what the
 * RESPONSE says it holds, not by what was asked for (the deploy window can answer a `previous`
 * request with the year to date); choosing a comparison emits it; a search narrows the rows and
 * says how many remain; no comparison hides the column; the previous period is named for the grain.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const line = (glid: string, descr: string, amount: number) => ({
  glid, descr, amount, pctOfRevenue: 10, toDateAmount: amount * 0.9, toDatePctOfRevenue: 9, modules: [{ post_module: "FUEL", amount, lines: 10 }],
});
const statement = (o: Partial<IncomeStatementResponse> = {}): IncomeStatementResponse => ({
  sections: [
    { typeId: "R", label: "Revenue", isRevenue: true, isUnrecognised: false, total: 4_828_189.24, toDateTotal: 4_000_000, lines: [line("10010000", "Gross Trucking Income", 4_828_189.24)] },
    { typeId: "OE", label: "Operating Expenses", isRevenue: false, isUnrecognised: false, total: 972_820.53, toDateTotal: 900_000, lines: [line("40050000", "Fuel for Hired Vehicles", 972_820.53), line("30100000", "Driver Wages", 1_012_400)] },
  ],
  revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86,
  toDateRevenue: 4_000_000, toDateExpenses: 3_500_000, toDateNet: 500_000, unrecognisedNet: 0,
  monthsCovered: ["2026-07"], monthsMissing: [], monthsPartial: [], ledgerReason: null, toDateFrom: "2026-06-01",
  comparison: { kind: "previous", from: "2026-06-01", to: "2026-07-01", monthsCovered: ["2026-06"], monthsMissing: [] },
  ...o,
});

const mountIt = (s: IncomeStatementResponse | null = statement(), compare: StatementCompare = "previous", period = periodForMonth("2026-07")) =>
  mount(IncomeStatementTab, {
    props: { statement: s, statementLoading: false, statementError: false, fleet: null, fleetLoading: false, period, compare },
  });

describe("IncomeStatementTab", () => {
  it("labels the comparative column by what the response holds — the previous month here", () => {
    const w = mountIt();
    expect(w.text()).toContain("June 2026");
    expect(w.text()).toContain("$4,000,000.00 June 2026");
    expect(w.text()).not.toContain("Year to date runs from");
  });

  it("labels the column year to date when the API answered so, whatever was asked", () => {
    const w = mountIt(statement({ comparison: { kind: "ytd", from: "2026-01-01", to: "2026-08-01", monthsCovered: ["2026-07"], monthsMissing: [] }, toDateFrom: "2026-01-01" }), "previous");
    expect(w.text()).toContain("Year to date runs from 2026-01-01");
    const w2 = mountIt(statement({ comparison: undefined, toDateFrom: "2026-01-01" }), "previous");
    expect(w2.text()).toContain("Year to date runs from 2026-01-01");
  });

  it("emits the comparison the reader chooses", async () => {
    const w = mountIt();
    const ytd = w.findAll('[role="radio"]').find((r) => r.text() === "Year to date")!;
    await ytd.trigger("click");
    expect(w.emitted("update:compare")?.at(-1)?.[0]).toBe("ytd");
  });

  it("hides the comparative column and its sentence when there is no comparison", () => {
    const w = mountIt(statement({ comparison: { kind: "none", from: null, to: null, monthsCovered: [], monthsMissing: [] }, toDateRevenue: null, toDateExpenses: null, toDateNet: null }), "none");
    // The control still offers the year to date; the column and its sentence are gone.
    expect(w.text()).not.toContain("Year to date runs from");
    expect(w.text()).not.toContain("The comparison column is");
    const headers = w.findAll("th").map((t) => t.text());
    expect(headers).not.toContain("June 2026");
    expect(headers).not.toContain("Year to date");
  });

  it("names the previous quarter for a quarter period", () => {
    const w = mountIt(statement(), "previous", periodForQuarter("2026-07"));
    expect(w.text()).toContain("Compare to Q2 2026");
  });

  it("finds an account by name or code and says how many remain", async () => {
    const w = mountIt();
    const input = w.find("input");
    await input.setValue("fuel");
    await new Promise((r) => setTimeout(r, 300));
    expect(w.text()).toContain("Fuel for Hired Vehicles");
    expect(w.text()).not.toContain("Driver Wages");
    expect(w.text()).not.toContain("Gross Trucking Income");
    expect(w.text()).toContain("1 of 3 accounts");
    await input.setValue("3010");
    await new Promise((r) => setTimeout(r, 300));
    expect(w.text()).toContain("Driver Wages");
    expect(w.text()).toContain("1 of 3 accounts");
  });

  it("names the comparison months the sweep has not reached", () => {
    const w = mountIt(statement({ comparison: { kind: "previous", from: "2026-04-01", to: "2026-06-01", monthsCovered: ["2026-05"], monthsMissing: ["2026-04"] } }));
    expect(w.text()).toContain("has not reached 2026-04 in the comparison");
  });
});
