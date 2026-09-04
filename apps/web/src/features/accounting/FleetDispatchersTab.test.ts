import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import FleetDispatchersTab from "./FleetDispatchersTab.vue";
import type { MileageCoverageResponse } from "./useMileageCoverage";

/**
 * Per dispatcher on the fleet report, mounted (R7, plan §2 Tab 3). Pinned, as the Billing page
 * pinned before the move (D-FIN15): rank, billed miles and rate per mile print; a dispatcher whose
 * loads carried no distance reads a dash, never $0.00; a failed fetch is shown in the table. New:
 * the fleet's rate per billed mile is the reference, a dot above it wears the good hue and below it
 * the spend hue, and a dispatcher without a rate has no dot.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});
const state = vi.hoisted(() => ({ error: null as string | null }));
vi.mock("@/composables/useDispatcherEarnings", () => ({
  useDispatcherEarningsQuery: () => ({
    data: ref(
      state.error
        ? []
        : [
            { dispatcherUserId: "pete", dispatcherName: "pete", loads: 159, linehaul: 461_199, accessorial: 29_438, revenue: 490_637.33, unpostedLoads: 1, miles: 128_036, loadsWithoutMiles: 0, ratePerMile: 3.83 },
            { dispatcherUserId: "kane", dispatcherName: "kane", loads: 128, linehaul: 470_767, accessorial: 30_049, revenue: 500_815.54, unpostedLoads: 0, miles: 136_431, loadsWithoutMiles: 2, ratePerMile: 3.67 },
            { dispatcherUserId: "chris", dispatcherName: "Chris", loads: 1, linehaul: 800, accessorial: 0, revenue: 800, unpostedLoads: 1, miles: 0, loadsWithoutMiles: 1, ratePerMile: null },
          ],
    ),
    isLoading: ref(false),
    isFetching: ref(false),
    isError: ref(state.error != null),
    error: ref(state.error ? new Error(state.error) : null),
    refetch: vi.fn(),
  }),
}));

const coverage: MileageCoverageResponse = { months: [], miles: 1_552_337, trucks: 172, reason: null, billedMiles: 1_326_922, loads: 1_415, billedRevenue: 4_994_450.85 };
const mountIt = (c: MileageCoverageResponse | null = coverage) =>
  mount(FleetDispatchersTab, { props: { from: "2026-07-01", to: "2026-07-31", report: null, coverage: c } });

describe("FleetDispatchersTab", () => {
  it("prints rank, billed miles and rate per mile; a dispatcher without distances reads a dash", () => {
    const w = mountIt();
    const t = w.text();
    expect(t).toContain("Rate / mile");
    expect(t).toContain("$3.83");
    expect(t).toContain("128,036");
    const rows = w.findAll("tbody tr");
    const chris = rows.find((r) => r.text().includes("Chris"))!;
    expect(chris.findAll("td")[4]!.text()).toBe("—");
    expect(chris.text()).not.toContain("$0.00");
    expect(rows[0]!.text().startsWith("1")).toBe(true);
    expect(rows[1]!.text().startsWith("2")).toBe(true);
  });

  it("sets every dispatcher against the fleet's rate per billed mile", () => {
    const w = mountIt();
    expect(w.text()).toContain("$3.76");
    const html = w.html();
    // pete (3.83) is above the fleet's 3.76; kane (3.67) below.
    expect(html).toContain("bg-success-500/85");
    expect(html).toContain("bg-caution-500/85");
    // Chris has no rate and therefore no dot: two dots for three rows.
    expect(w.findAll(".rounded-full").length).toBe(2);
  });

  it("says so when the fleet's billed miles are not available, rather than drawing a line at zero", () => {
    const w = mountIt(null);
    expect(w.text()).toContain("billed miles not available");
    expect(w.findAll(".bg-ink-tertiary").length).toBe(0);
  });

  it("a failed fetch is shown in the table, not swallowed into an empty state", () => {
    state.error = "dispatcher earnings unavailable";
    try {
      const w = mountIt();
      expect(w.text()).toContain("dispatcher earnings unavailable");
      expect(w.text()).not.toContain("No dispatcher earnings for this period");
    } finally {
      state.error = null;
    }
  });
});
