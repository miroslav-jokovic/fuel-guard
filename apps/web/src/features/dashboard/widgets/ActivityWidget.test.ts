import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * The activity strip (D-FO7) — and the one assertion that survived from the operating-metrics
 * strip it replaced: D-PREC5. `fuel_range_totals` filters a CALENDAR column, so the strip hands it
 * the picked days untouched. The code that once built a browser-midnight instant here read 104
 * fills for a day that had 45, beside tiles that were right.
 */
const rangeTotalsArgs: { from?: string; to?: string }[] = [];
vi.mock("@/composables/useFuelLog", () => ({
  useFuelRangeTotals: (filters: { value: { from?: string; to?: string } }) => {
    rangeTotalsArgs.push(filters.value);
    return { data: computed(() => ({ fillUps: 210, totalMiles: 251_000 })), isLoading: ref(false) };
  },
}));
vi.mock("../useDashboard", () => ({
  useDashboard: () => ({
    data: computed(() => ({ totalGallons: 34_100, coveragePct: 95, allTimeCoveragePct: 23 })),
    isLoading: ref(false), isFetching: ref(false),
  }),
}));
vi.mock("../useDashboardComparison", () => ({
  useDashboardComparison: () => ({
    previousRange: computed(() => ({ from: "2026-07-25", to: "2026-08-08" })),
    previous: computed(() => ({ totalGallons: 33_000 })), mpgPrevious: computed(() => undefined),
    mpgPreviousWeeks: computed(() => []), fuelPrevious: computed(() => ({ fillUps: 200, totalMiles: 240_000 })), isLoading: ref(false),
  }),
}));
vi.mock("@/composables/useFleetMpg", () => ({
  useFleetMpgSeries: () => ({ data: computed(() => ({ total: { mpg: 7.4 }, periods: [] })) }),
}));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

const RouterLink = { props: ["to"], template: "<a><slot /></a>" };

const render = async (range: { from: string; to: string }) => {
  const ActivityWidget = (await import("./ActivityWidget.vue")).default;
  return mount(ActivityWidget, { props: { range }, global: { stubs: { RouterLink } } });
};

describe("ActivityWidget", () => {
  it("passes the picked calendar days through, undecorated", async () => {
    rangeTotalsArgs.length = 0;
    await render({ from: "2026-08-09", to: "2026-08-23" });
    // The CURRENT window's call (the comparison composable is mocked, so this is the only one).
    expect(rangeTotalsArgs).toContainEqual({ from: "2026-08-09", to: "2026-08-23" });
    for (const a of rangeTotalsArgs) {
      expect(a.from).not.toMatch(/T|Z/);
      expect(a.to).not.toMatch(/T|Z/);
    }
  });

  it("draws the four figures with a pill on the three that have a previous window, and none on coverage", async () => {
    const w = await render({ from: "2026-08-09", to: "2026-08-23" });
    const labels = w.findAll("dt").map((d) => d.text());
    expect(labels).toEqual(["Fill-ups", "Gallons", "Miles driven", "Telematics coverage"]);
    const pills = w.findAll("[data-direction]");
    expect(pills).toHaveLength(3);
    // Fill-ups 200 → 210 is up and good; gallons 33,000 → 34,100 is up and bad.
    expect(pills[0]!.attributes("data-direction")).toBe("up");
    expect(pills[0]!.classes().join(" ")).toContain("success");
    expect(pills[1]!.classes().join(" ")).toContain("danger");
    expect(w.text()).toContain("23% all time");
  });
});
