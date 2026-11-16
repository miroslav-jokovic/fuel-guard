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
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

const stubs = { RouterLink: { props: ["to"], template: "<a><slot /></a>" }, BaseChart: { template: "<div />" } };
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
