import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FamilySummaryTable from "./FamilySummaryTable.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { FamilyRow, FamilySummaryResponse } from "./useFleetReport";

/**
 * The summary, mounted (G6). The fixture is the fiscal year to date the owner signed the map
 * against: fuel and fluids 6,399,386.60 at 22.3% of revenue and $0.64 a mile, driver pay
 * 7,346,088.87 at 25.6%.
 *
 * What is pinned is what a reader would be misled by: a rate that could not be computed must print
 * as a dash rather than as $0.00, an account the map has not been told about must be visible rather
 * than folded into a family, and a summary that does not add up to the statement beneath it must
 * say so instead of looking like an answer.
 */

const row = (o: Partial<FamilyRow> & { label: string; amount: number }): FamilyRow => ({
  key: o.label.toLowerCase().replace(/\W+/g, "_"),
  isRevenue: false,
  isUnassigned: false,
  toDateAmount: null,
  pctOfRevenue: null,
  toDatePctOfRevenue: null,
  perMile: null,
  accounts: 1,
  ...o,
});

const families = (o: Partial<FamilySummaryResponse> = {}): FamilySummaryResponse => ({
  expense: [
    row({ label: "Company driver pay", amount: 7_346_088.87, pctOfRevenue: 25.6, perMile: 0.74, accounts: 5 }),
    row({ label: "Fuel and fluids", amount: 6_399_386.6, pctOfRevenue: 22.3, perMile: 0.64, accounts: 4 }),
  ],
  revenue: [
    row({ label: "Freight and fuel surcharge", amount: 28_505_865.38, isRevenue: true, pctOfRevenue: 99.4, perMile: 2.86, accounts: 5 }),
  ],
  tieOut: { revenue: 0, expenses: 0 },
  ...o,
});

const render = (o: Partial<FamilySummaryResponse> = {}, showToDate = false) =>
  mount(FamilySummaryTable, { props: { families: families(o), showToDate } });

describe("FamilySummaryTable", () => {
  it("prints each family with its share of revenue and its cost per mile", () => {
    const t = render().text();
    expect(t).toContain("Fuel and fluids");
    expect(t).toContain("$6,399,387");
    expect(t).toContain("22.3%");
    expect(t).toContain("$0.64");
  });

  it("keeps income and expense in separate tables", () => {
    const w = render();
    // Two tables, not one list with a sign convention to work out: what came in and what went out
    // are different questions, and the per-mile column means a different thing in each.
    expect(w.findAllComponents(DataTable)).toHaveLength(2);
    expect(w.text()).toContain("Freight and fuel surcharge");
    expect(w.text()).toContain("Fuel and fluids");
  });

  it("shows no income table at all rather than an empty one", () => {
    const w = render({ revenue: [] });
    expect(w.findAllComponents(DataTable)).toHaveLength(1);
    expect(w.text()).not.toContain("Freight and fuel surcharge");
  });

  /**
   * A period whose mileage could not cover the fleet has no rate for any family. The dollars are
   * still right, and $0.00 a mile would be a plausible wrong number for every row at once (D-FIN10).
   */
  it("prints a dash, never $0.00, where a rate could not be computed", () => {
    const w = render({
      expense: [row({ label: "Fuel and fluids", amount: 6_399_386.6, pctOfRevenue: 22.3, perMile: null })],
    });
    expect(w.text()).toContain("$6,399,387");
    expect(w.text()).toContain("—");
    expect(w.text()).not.toContain("$0.00");
  });

  /** The bookkeeper's next account. It is on the page, in its own row, marked — never absorbed. */
  it("shows an account the signed map has not been told about", () => {
    const w = render({
      expense: [
        row({ label: "Fuel and fluids", amount: 6_399_386.6 }),
        row({ label: "Not yet grouped", amount: 5_000, isUnassigned: true }),
      ],
    });
    expect(w.text()).toContain("Not yet grouped");
    expect(w.text()).toContain("$5,000");
    expect(w.find(".text-warning-700").exists()).toBe(true);
  });

  /**
   * The summary's whole claim is that it is the statement above it, regrouped. When that stops
   * being true the page says which figure to trust rather than showing two that disagree.
   */
  it("says so when the families no longer add up to the statement", () => {
    const w = render({ tieOut: { revenue: 0, expenses: 1_200 } });
    expect(w.text()).toContain("do not add up to the statement");
    expect(w.text()).toContain("The statement is right");
    expect(w.text()).not.toContain("Every account is in exactly one family");
  });

  it("hides the year-to-date column when the period has no comparative", () => {
    expect(render().text()).not.toContain("Year to date");
    expect(render({}, true).text()).toContain("Year to date");
  });
});
