import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref, type Ref } from "vue";

/**
 * Fleet MPG's plot (SMALL-SCREENS-PLAN.md D-SM11, D-SM13). A read that answered with no measured week
 * used to draw 200 px of empty gridlines; it now says so in the plot's place — and a read that has NOT
 * answered must not, because "no data" over a loading card is a wrong answer drawn confidently.
 */
type Week = { from: string; to: string; mpg: number | null; partial: boolean };
type Total = { mpg: number | null; partial: boolean; to: string; requestedTo: string; reason?: string | null };
const state: { total: Ref<Total | null>; weeks: Ref<Week[]>; previousWeeks: Ref<Week[]>; previous: Ref<{ mpg: number } | undefined> } = {
  total: ref(null),
  weeks: ref([]),
  previousWeeks: ref([]),
  previous: ref(undefined),
};
vi.mock("../fleetWidgetData", () => ({
  useFleetWidgetData: () => ({
    mpgWeeks: computed(() => state.weeks.value),
    mpgTotal: computed(() => state.total.value),
    mpgSub: computed(() => (state.total.value?.partial ? "measured to 11/15" : "")),
    mpgPrevious: computed(() => state.previous.value),
    mpgPreviousWeeks: computed(() => state.previousWeeks.value),
    deltas: computed(() => ({ mpg: null })),
    previousLabel: computed(() => ""),
    previousPhrase: computed(() => "the previous 31 days"),
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
  return mount(EfficiencyWidget, { props: { range: { from: "2026-10-17", to: "2026-11-16" } }, global: { stubs } });
};
const ANSWERED: Total = { mpg: null, partial: false, to: "2026-11-15", requestedTo: "2026-11-15" };
const wk = (from: string, to: string, mpg: number | null, partial = false): Week => ({ from, to, mpg, partial });

describe("EfficiencyWidget's plot", () => {
  it("says no week was measured once, in the plot's place, once the read has answered so", async () => {
    state.total.value = ANSWERED;
    state.weeks.value = [wk("2026-10-19", "2026-10-25", null), wk("2026-10-26", "2026-11-01", null)];
    const w = await render();
    expect(w.find('[data-test="mpg-nothing-measured"]').text()).toContain("No week in these dates");
    expect(w.find('[data-test="plot"]').exists()).toBe(false);
    // Until 2026-11-16 the readout row printed a dash above the same sentence.
    expect(w.text()).not.toContain("—");
  });

  it("draws the plot when any week has an MPG", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.4 };
    state.weeks.value = [wk("2026-10-19", "2026-10-25", null), wk("2026-10-26", "2026-11-01", 6.4)];
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

  it("prints the window's MPG and last period's with one decimal, as the pill does", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.62 };
    state.previous.value = { mpg: 6.94 };
    state.weeks.value = [wk("2026-10-19", "2026-10-25", 6.62)];
    const text = (await render()).text();
    expect(text).toContain("6.6 MPG");
    expect(text).toContain("vs 6.9 the previous 31 days");
    expect(text).not.toContain("6.62");
    state.previous.value = undefined;
  });

  it("names the part-weeks under the plot and leaves them out of last period's band", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.9 };
    state.weeks.value = [wk("2026-10-17", "2026-10-18", 6.3), wk("2026-10-19", "2026-10-25", 6.96)];
    state.previousWeeks.value = [wk("2026-09-16", "2026-09-20", 5.1), wk("2026-09-21", "2026-09-27", 7.74), wk("2026-09-28", "2026-10-04", 7.34)];
    const w = await render();
    expect(w.get('[data-test="mpg-part-weeks"]').text()).toContain("10/17 – 10/18 (2 days)");
    expect(w.get('[data-test="mpg-band"]').text()).toContain("7.3 – 7.7");
    state.previousWeeks.value = [];
  });

  it("says nothing about part-weeks when every week is a full one", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.9 };
    state.weeks.value = [wk("2026-10-19", "2026-10-25", 6.96), wk("2026-10-26", "2026-11-01", 7.17)];
    expect((await render()).find('[data-test="mpg-part-weeks"]').exists()).toBe(false);
  });

  it("says how far the roll-up reached once, in the sentence, not again in the caption", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.9, partial: true, to: "2026-11-15", requestedTo: "2026-11-16" };
    state.weeks.value = [wk("2026-10-19", "2026-10-25", 6.96)];
    const text = (await render()).text();
    expect(text).toContain("Measured to 11/15/2026, not 11/16/2026");
    expect(text).not.toContain("measured to 11/15");
  });

  it("keeps the screen reader's table out of the layout by clipping its wrapper, not the table", async () => {
    state.total.value = { ...ANSWERED, mpg: 6.4 };
    state.weeks.value = [wk("2026-10-19", "2026-10-25", 6.4)];
    const table = (await render()).get("table");
    // The class on the table alone does not clip it — the wrapper's is the one that holds.
    expect(table.element.parentElement!.className).toBe("sr-only");
  });
});
