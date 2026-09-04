import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ActivityTable from "./ActivityTable.vue";
import type { BillingActivityResponse } from "./useBillingActivity";

/**
 * The week-by-week tab (W2). What is pinned is what a reader would be misled by: a rate that could
 * not be computed must not print as $0.00, a load excluded from the figures must be counted out
 * loud, and the tab must say why there is no cost on it — a weekly table with no cost column and no
 * explanation reads as an unfinished page rather than a deliberate one.
 */

const query = vi.hoisted(() => ({
  data: { value: null as BillingActivityResponse | null },
  isLoading: { value: false },
  isError: { value: false },
}));

vi.mock("./useBillingActivity", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue");
  return {
    useBillingActivityQuery: () => ({
      data: ref(query.data.value),
      isLoading: ref(query.isLoading.value),
      isError: ref(query.isError.value),
    }),
  };
});

const period = (from: string, to: string, o: Partial<BillingActivityResponse["periods"][number]> = {}) => ({
  from,
  to,
  loads: 62,
  revenue: 482_000,
  billedMiles: 148_041,
  revenuePerBilledMile: 3.26,
  loadsWithoutDistance: 0,
  ...o,
});

const respond = (o: Partial<BillingActivityResponse> = {}) => {
  query.data.value = {
    periods: [period("2026-07-06", "2026-07-12"), period("2026-07-13", "2026-07-19")],
    grain: "week",
    window: { from: "2026-07-01", to: "2026-08-01" },
    unpostedBills: 0,
    ...o,
  };
};

const render = () => mount(ActivityTable, { props: { from: "2026-07-01", to: "2026-07-31" } });

beforeEach(() => {
  query.isLoading.value = false;
  query.isError.value = false;
  respond();
});

describe("ActivityTable", () => {
  it("shows each period's loads, revenue, billed miles and the rate between them", () => {
    const t = render().text();
    expect(t).toContain("Jul 6 – Jul 12");
    expect(t).toContain("62");
    expect(t).toContain("$482,000");
    expect(t).toContain("148,041");
    expect(t).toContain("$3.26");
  });

  /**
   * An activity table is read for what just happened, so the newest week leads. Asserted by ORDER in
   * the rendered text rather than by row index: under jsdom `DataTable` renders its stacked layout
   * and a `tbody tr` query finds nothing, which quietly made the first version of this test pass
   * whichever way the rows were sorted.
   */
  it("puts the newest period first", () => {
    const t = render().text();
    expect(t.indexOf("Jul 13")).toBeGreaterThan(-1);
    expect(t.indexOf("Jul 13")).toBeLessThan(t.indexOf("Jul 6 –"));
  });

  it("prints a dash, never $0.00, when a period's bills carried no distance", () => {
    respond({
      periods: [period("2026-07-06", "2026-07-12", { billedMiles: 0, revenuePerBilledMile: null, loadsWithoutDistance: 62 })],
    });
    const t = render().text();
    expect(t).toContain("—");
    expect(t).not.toContain("$0.00");
  });

  it("counts the loads whose bill carried no distance, so the rate's reach is visible", () => {
    respond({ periods: [period("2026-07-06", "2026-07-12", { loadsWithoutDistance: 3 })] });
    expect(render().text()).toContain("3 loads carry no billed distance");
  });

  it("names the bills the ledger has not booked rather than dropping them silently", () => {
    respond({ unpostedBills: 4 });
    expect(render().text()).toContain("4 bills have not been booked");
  });

  /**
   * A weekly table with no cost column and no explanation reads as an unfinished page. D-FLEET10
   * says a weekly view names what it does not contain, so the reason is on the tab, not in a plan.
   */
  it("says why there is no cost on a weekly view", () => {
    const t = render().text();
    expect(t).toContain("no cost here");
    expect(t).toContain("month-end entries");
  });

  it("says weeks start on Monday and count the delivery, not the invoice", () => {
    const t = render().text();
    expect(t).toContain("Weeks start on Monday");
    expect(t).toContain("DELIVERED");
  });

  it("says so when the view could not be loaded rather than showing an empty table", () => {
    query.isError.value = true;
    const w = render();
    expect(w.text()).toContain("could not be loaded");
    expect(w.text()).not.toContain("Weeks start on Monday");
  });
});
