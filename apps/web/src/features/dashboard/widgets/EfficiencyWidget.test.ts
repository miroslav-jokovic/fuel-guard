import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref, type Ref } from "vue";

/**
 * Fleet MPG's plot (SMALL-SCREENS-PLAN.md D-SM11). A read that answered with no measured week used to
 * draw 200 px of empty gridlines; it now says so in the plot's place — and a read that has NOT
 * answered must not, because "no data" over a loading card is a wrong answer drawn confidently.
 */
type Week = { from: string; mpg: number | null };
const state: { total: Ref<{ mpg: number | null; partial: boolean; to: string; requestedTo: string } | null>; weeks: Ref<Week[]> } = {
  total: ref(null),
  weeks: ref([]),
};
vi.mock("../fleetWidgetData", () => ({
  useFleetWidgetData: () => ({
    mpgWeeks: computed(() => state.weeks.value),
    mpgTotal: computed(() => state.total.value),
    mpgSub: computed(() => ""),
    mpgPrevious: computed(() => undefined),
    mpgPreviousWeeks: computed(() => []),
    deltas: computed(() => ({ mpg: null })),
    previousLabel: computed(() => ""),
    previousPhrase: computed(() => ""),
  }),
}));

vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

const stubs = { RouterLink: { props: ["to"], template: "<a><slot /></a>" }, BaseChart: { template: '<div data-test="plot" />' } };
const render = async () => {
  const EfficiencyWidget = (await import("./EfficiencyWidget.vue")).default;
  return mount(EfficiencyWidget, { props: { range: { from: "2026-10-15", to: "2026-11-14" } }, global: { stubs } });
};
const ANSWERED = { mpg: null, partial: false, to: "2026-11-14", requestedTo: "2026-11-14" };

describe("EfficiencyWidget's plot", () => {
  it("says no week was measured, in the plot's place, once the read has answered so", async () => {
    state.total.value = ANSWERED;
    state.weeks.value = [{ from: "2026-10-15", mpg: null }, { from: "2026-10-22", mpg: null }];
    const w = await render();
    expect(w.find('[data-test="mpg-nothing-measured"]').text()).toContain("No week in these dates");
    expect(w.find('[data-test="plot"]').exists()).toBe(false);
  });

  it("draws the plot when any week has an MPG", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.4 };
    state.weeks.value = [{ from: "2026-10-15", mpg: null }, { from: "2026-10-22", mpg: 6.4 }];
    const w = await render();
    expect(w.find('[data-test="plot"]').exists()).toBe(true);
    expect(w.find('[data-test="mpg-nothing-measured"]').exists()).toBe(false);
  });

  it("does not claim there is nothing while the read has not answered", async () => {
    state.total.value = null;
    state.weeks.value = [];
    const w = await render();
    expect(w.find('[data-test="mpg-nothing-measured"]').exists()).toBe(false);
  });

  it("keeps the screen reader's table out of the layout by clipping its wrapper, not the table", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.4 };
    state.weeks.value = [{ from: "2026-10-22", mpg: 6.4 }];
    const table = (await render()).get("table");
    expect(table.classes()).not.toContain("sr-only");
    expect(table.element.parentElement!.className).toBe("sr-only");
  });
});
