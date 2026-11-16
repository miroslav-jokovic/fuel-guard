import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * The Fuel card's "where fuel goes" bar is withheld when the idle estimate is larger than the tractor
 * fuel bought (`fuelCostSplit`). Staging, 2026-11-16, drew "Idle 100%, Moving 0" over five sandbox
 * fills and a year of real idle hours.
 */
const summary = ref({ totalSpend: 1928.61, reeferSpend: 372, idleCostUsd: 56669, movingSpend: 0, totalGallons: 498, spendTrend: [] });
const money = ref(true);
vi.mock("../fleetWidgetData", async (orig) => ({
  ...(await orig<object>()),
  useFleetWidgetData: () => ({
    s: computed(() => summary.value),
    previous: computed(() => undefined),
    canSeeMoney: computed(() => money.value),
    deltas: computed(() => ({ spend: null, gallons: null })),
    previousLabel: computed(() => ""),
    previousPhrase: computed(() => "the previous 31 days"),
    rangeLabel: computed(() => ""),
  }),
}));
/** The plot's measured width; jsdom has no layout, so the test hands it in. */
const { plotWidth } = vi.hoisted(() => ({ plotWidth: { value: 904 } }));
vi.mock("@vueuse/core", async (orig) => {
  const { ref: r } = await import("vue");
  const width = r(plotWidth.value);
  return { ...(await orig<object>()), useElementSize: () => { width.value = plotWidth.value; return { width, height: r(200) }; } };
});
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

const stubs = { RouterLink: { props: ["to"], template: "<a><slot /></a>" }, BaseChart: { template: "<div data-test='plot' />" } };
const render = async () => mount((await import("./FuelWidget.vue")).default, { props: { range: { from: "2026-10-17", to: "2026-11-16" } }, global: { stubs } });

describe("the Fuel card's cost split", () => {
  it("says why instead of drawing Idle at 100% when idle is estimated above the fuel bought", async () => {
    summary.value = { ...summary.value, totalSpend: 1928.61, reeferSpend: 372, idleCostUsd: 56669 };
    const w = await render();
    expect(w.get("[data-test='fuel-split-withheld']").text()).toContain("more than the $1,557 of tractor fuel bought");
    // No bar beside the sentence: its legend is the part a reader would quote.
    expect(w.text()).not.toContain("Moving");
  });

  it("keeps dollars out of the sentence for a reader who may not see money", async () => {
    money.value = false;
    const w = await render();
    expect(w.get("[data-test='fuel-split-withheld']").text()).not.toMatch(/\$/);
    money.value = true;
  });

  it("draws the split when idle is a part of what was bought", async () => {
    summary.value = { ...summary.value, totalSpend: 100000, reeferSpend: 1000, idleCostUsd: 6000, movingSpend: 93000 };
    const w = await render();
    expect(w.find("[data-test='fuel-split-withheld']").exists()).toBe(false);
    expect(w.text()).toContain("Moving");
  });
});

/** 31 production-shaped days from Saturday 10/17, as the card read them on 2026-11-16. */
const month = Array.from({ length: 31 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 17 + i));
  return { date: d.toISOString().slice(0, 10), value: 40000 };
});

describe("the Fuel spend plot on a narrow card (D-SM15)", () => {
  it("draws one bar per week on a phone, names the short weeks, and says it is weekly", async () => {
    summary.value = { ...summary.value, totalSpend: 1_240_000, reeferSpend: 9372, idleCostUsd: 80000, movingSpend: 1_150_628, spendTrend: month as never };
    plotWidth.value = 318;
    const w = await render();
    expect(w.find("[data-test='spend-weeks']").exists()).toBe(true);
    expect(w.find("[data-test='spend-days']").exists()).toBe(false);
    expect(w.get("[data-test='spend-part-weeks']").text()).toContain("10/17 – 10/18 (2 days)");
    expect(w.text()).toContain("Weekly total across the fleet");
    expect(w.text()).not.toContain("Previous period, same day");
  });

  it("keeps the days on a wide card", async () => {
    plotWidth.value = 904;
    const w = await render();
    expect(w.find("[data-test='spend-days']").exists()).toBe(true);
    expect(w.find("[data-test='spend-part-weeks']").exists()).toBe(false);
    expect(w.text()).toContain("Daily total across the fleet");
  });

  it("draws nothing until the plot has been measured, rather than the days for a frame", async () => {
    plotWidth.value = 0;
    const w = await render();
    // The card's own markers, not the stub's: a parent's data-test replaces the stub's on the root.
    expect(w.find("[data-test='spend-weeks']").exists()).toBe(false);
    expect(w.find("[data-test='spend-days']").exists()).toBe(false);
    expect(w.find("[data-test='spend-plot']").exists()).toBe(true);
    plotWidth.value = 904;
  });
});
