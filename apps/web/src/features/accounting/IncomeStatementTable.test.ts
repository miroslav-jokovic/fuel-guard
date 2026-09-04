import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IncomeStatementTable from "./IncomeStatementTable.vue";
import type { StatementSection } from "./useIncomeStatement";

/**
 * The income statement section, mounted (G3).
 *
 * What is pinned here is the handful of things a reader would be misled by if they broke, and every
 * one of them is a real property of this carrier's ledger rather than a hypothetical:
 *
 *  · Two accounts genuinely share a name — McLeod truncates `descr` to 28 characters at source, so
 *    three revenue accounts all read "Gross Trucking Income". Without the code on the row a boss
 *    sees the same line repeated and cannot act on either.
 *  · A refund is a negative and must print as one. July's Business Licenses account is −3,193.93.
 *  · A share of revenue with no revenue to divide by is a dash, never 0.0% (D-FIN10).
 *  · An account group the report cannot classify says so, out loud, on the card.
 */

const section = (o: Partial<StatementSection> = {}): StatementSection => ({
  typeId: "Operating Expenses",
  label: "Operating Expenses",
  isRevenue: false,
  isUnrecognised: false,
  total: 968_626.69,
  toDateTotal: 5_000_000,
  lines: [
    {
      glid: "40050000",
      descr: "Fuel for Hired Vehicles",
      amount: 971_820.62,
      pctOfRevenue: 20.7,
      toDateAmount: 5_000_000,
      toDatePctOfRevenue: 19.4,
      modules: [{ post_module: "FUEL", amount: 971_820.62, lines: 5777 }],
    },
    {
      glid: "40200000",
      descr: "Business Licenses and Permit",
      amount: -3_193.93,
      pctOfRevenue: -0.1,
      toDateAmount: 0,
      toDatePctOfRevenue: 0,
      modules: [{ post_module: "AP", amount: -3_193.93, lines: 4 }],
    },
  ],
  ...o,
});

const mountSection = (s: StatementSection, showToDate = true) =>
  mount(IncomeStatementTable, { props: { section: s, showToDate } });

describe("IncomeStatementTable", () => {
  it("prints the account code beside every name, because names are not unique", () => {
    const t = mountSection(section()).text();
    expect(t).toContain("40050000");
    expect(t).toContain("40200000");
    expect(t).toContain("Fuel for Hired Vehicles");
  });

  it("tells two accounts that share a truncated description apart", () => {
    const twins = section({
      typeId: "Revenue",
      label: "Revenue",
      isRevenue: true,
      total: 4_705_926.93,
      lines: [
        { glid: "30000001", descr: "Gross Trucking Income", amount: 4_491_402.5, pctOfRevenue: 95.4, toDateAmount: null, toDatePctOfRevenue: null, modules: [] },
        { glid: "30000002", descr: "Gross Trucking Income", amount: 214_524.43, pctOfRevenue: 4.6, toDateAmount: null, toDatePctOfRevenue: null, modules: [] },
      ],
    });
    const t = mountSection(twins).text();
    expect(t).toContain("30000001");
    expect(t).toContain("30000002");
  });

  it("shows a refund as a negative rather than as an amount spent", () => {
    const t = mountSection(section()).text();
    expect(t).toMatch(/-\$3,193\.93/);
  });

  it("prints a dash, not 0.0%, when the period booked no revenue to divide by", () => {
    const noBase = section({
      lines: [
        { glid: "40050000", descr: "Fuel for Hired Vehicles", amount: 971_820.62, pctOfRevenue: null, toDateAmount: null, toDatePctOfRevenue: null, modules: [] },
      ],
    });
    const t = mountSection(noBase).text();
    expect(t).toContain("—");
    expect(t).not.toContain("0.0%");
  });

  it("says on the card when a group is one the report cannot classify", () => {
    const t = mountSection(section({ typeId: "Suspense", label: "Suspense", isUnrecognised: true })).text();
    expect(t).toContain("not one the report knows how to classify");
  });

  it("hides the year-to-date columns entirely when there is no comparative period", () => {
    const t = mountSection(section({ toDateTotal: null }), false).text();
    expect(t).not.toContain("Year to date");
    expect(t).not.toContain("year to date");
  });

  it("opens a row to show which parts of McLeod posted it", async () => {
    const w = mountSection(section());
    expect(w.text()).not.toContain("5,777 lines");
    await w.findAll("button")[0]!.trigger("click");
    expect(w.text()).toContain("Where this came from in McLeod");
    expect(w.text()).toContain("FUEL");
    expect(w.text()).toContain("5,777 lines");
  });

  it("shows an empty section as empty rather than as a broken table", () => {
    const t = mountSection(section({ lines: [], total: 0 })).text();
    expect(t).toContain("No accounts posted in this period.");
  });
});
