import { beforeEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { buyingHabitsTable } from "@silvicom/shared";
import BuyingHabitsTable from "./BuyingHabitsTable.vue";

/**
 * The buying-habits table on Fuel Costs (chunk 9a). The sums are shared's (`buyingHabits.test.ts`); here,
 * what only a mount shows: a truck-month per row with its drivers, the three kinds in their own columns,
 * the total said once above the table, and a failed read that never reads as "nothing paid".
 */
const table = buyingHabitsTable([
  { kind: "avoided_state_premium", occurred_on: "2026-09-01", unit_number: "809", amount: "114.72", evidence: { drivers: ["YOUNESS ALAM"] } },
  { kind: "off_network_premium", occurred_on: "2026-09-01", unit_number: "809", amount: "58.04", evidence: { drivers: [] } },
  { kind: "avoided_brand_premium", occurred_on: "2026-08-01", unit_number: "646", amount: "0.10", evidence: { drivers: [] } },
]);
const mountTable = (p: Partial<{ table: typeof table | undefined; loading: boolean; error: boolean }> = {}) =>
  mount(BuyingHabitsTable, { props: { table, loading: false, error: false, ...p } });

// DataTable draws its desktop table only when the wide-screen query matches.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (q: string) => ({
      matches: true, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

describe("the buying-habits table", () => {
  it("lists one row per truck and month, with its drivers and each kind apart", () => {
    const rows = mountTable().findAll("tbody tr").map((tr) => tr.findAll("td").map((td) => td.text()));
    expect(rows).toEqual([
      ["09/2026", "809", "YOUNESS ALAM", "$114.72", "$58.04", "—", "$172.76"],
      ["08/2026", "646", "Not on the fills", "—", "—", "$0.10", "$0.10"],
    ]);
  });

  it("states the total once, above the table", () => {
    expect(mountTable().get("[data-testid='buying-habits-total']").text()).toBe("$172.86");
  });

  it("says the read failed rather than showing an empty table or a zero", () => {
    const w = mountTable({ table: undefined, error: true });
    expect(w.text()).toContain("Couldn't load the buying habits");
    expect(w.find("table").exists()).toBe(false);
    expect(w.find("[data-testid='buying-habits-total']").exists()).toBe(false);
  });
});
