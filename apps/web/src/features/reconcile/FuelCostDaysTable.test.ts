import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FuelCostDaysTable from "./FuelCostDaysTable.vue";
import type { CostDayRow } from "./fuelCostView";

/** The report's one table: paging, the MPG column only for a truck question, and a withheld MPG explained. */
const row = (day: string, o: Partial<CostDayRow> = {}): CostDayRow => ({
  id: day, day, fills: 1, gallons: 100, spend: 400, pricePerGal: 4, outOfNetwork: 0, paidVsQuote: null,
  reefer: 0, mpg: 6.5, mpgReason: null, ...o,
});
const days = (n: number, start = 1) => Array.from({ length: n }, (_, i) => row(`2026-09-${String(start + i).padStart(2, "0")}`));

beforeEach(() => {
  setActivePinia(createPinia());
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

const mountTable = (rows: CostDayRow[], withMpg = true) =>
  mount(FuelCostDaysTable, { props: { rows, withMpg, filename: "fuel-costs" } });

describe("FuelCostDaysTable", () => {
  it("pages at 20, and starts again at page one when the rows change", async () => {
    const w = mountTable(days(25));
    expect(w.text()).toContain("Showing 1–20 of 25");
    await w.findAll("button").find((b) => b.text().includes("Next"))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Showing 21–25 of 25");
    await w.setProps({ rows: days(22, 2) });
    await flushPromises();
    expect(w.text()).toContain("Showing 1–20 of 22");
  });

  it("has the MPG column only for a truck question", () => {
    expect(mountTable(days(2)).text()).toContain("MPG — previous 7 days");
    expect(mountTable(days(2), false).text()).not.toContain("MPG — previous 7 days");
  });

  it("explains a withheld MPG on hover rather than leaving a bare dash", () => {
    const w = mountTable([row("2026-09-01", { mpg: null, mpgReason: "The fuel roll-up reaches 2026-08-31…" })]);
    expect(w.find('[title="The fuel roll-up reaches 2026-08-31…"]').exists()).toBe(true);
  });
});
