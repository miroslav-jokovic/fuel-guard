import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * That a SHORT window reaches the reader (D-PREC2).
 *
 * ── WHY THIS IS A COMPONENT TEST AND NOT A UNIT ONE ─────────────────────────────────────────────
 * `fleetMpgWindow.test.ts` proves the rule and `fleetMpg.test.ts` proves it reaches both database
 * reads. Neither can prove the one thing the outage actually turned on: whether a person looking at
 * the card can tell that the figure stops short of the dates above it. For a week in September 2026
 * the endpoint was correct about everything it was asked and the dashboard still said 8.61 MPG,
 * because nothing on the page carried the fact that five of the window's thirty days had no fuel in
 * them. A term that no surface renders is a term that does not exist, and D-MPG1 says as much about
 * `milesSource` — "part of the answer, not metadata a surface may drop".
 *
 * ⚠ So this asserts RENDERED TEXT, not a prop. Passing `partial` into the card and never drawing it
 * is exactly the failure being guarded against, and a prop assertion would be green for it.
 */

const period = (over: Record<string, unknown> = {}) => ({
  mpg: 6.91,
  measuredShare: 0.97,
  reason: null,
  from: "2026-08-22",
  to: "2026-09-21",
  requestedTo: "2026-09-21",
  partial: false,
  fuelThrough: "2026-09-21",
  ...over,
});

const series = ref<{ total: ReturnType<typeof period>; periods: unknown[] }>({
  total: period(),
  periods: [],
});

vi.mock("@/composables/useFleetMpg", () => ({
  useFleetMpgSeries: () => ({ data: computed(() => series.value) }),
}));
vi.mock("../useDashboard", () => ({
  useDashboard: () => ({ data: computed(() => null), isLoading: ref(false), isFetching: ref(false) }),
}));
// `useFleetWidgetData` reads the session for the money gate; this card shows no money, so the gate
// is irrelevant here and a stub keeps Pinia out of a test about one sentence of copy.
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ canView: () => true, can: () => true, readOnly: false, role: "admin", sections: null }),
}));
// The chart itself is canvas and says nothing in the DOM; this file is about the words beside it.
vi.mock("@/components/BaseChart.vue", () => ({ default: { template: "<div data-test='chart' />" } }));

const render = async () => {
  const MpgTrendWidget = (await import("./MpgTrendWidget.vue")).default;
  return mount(MpgTrendWidget, { props: { range: { from: "2026-08-22", to: "2026-09-21" } } });
};

describe("the Fleet MPG card says when its window stops short", () => {
  it("names both days when the roll-up has not reached the end of the period", async () => {
    series.value = {
      total: period({ partial: true, to: "2026-09-15", requestedTo: "2026-09-21", fuelThrough: "2026-09-15" }),
      periods: [],
    };
    const text = (await render()).text();
    expect(text).toMatch(/2026-09-15/);
    expect(text).toMatch(/2026-09-21/);
    expect(text).toMatch(/roll-up/i);
  });

  it("says nothing of the sort when the window is whole", async () => {
    series.value = { total: period(), periods: [] };
    const text = (await render()).text();
    // ⚠ The negative matters as much as the positive: a permanent caption is a caption nobody reads,
    // which is how `measuredShare` came to be printed on every card and noticed on none.
    expect(text).not.toMatch(/roll-up/i);
  });

  it("shows the refusal's own sentence when there is no figure at all", async () => {
    series.value = {
      total: period({
        mpg: null,
        partial: false,
        reason: "The daily fuel roll-up stops on 2026-08-20, before this period even opens.",
      }),
      periods: [],
    };
    const text = (await render()).text();
    expect(text).toMatch(/stops on 2026-08-20/);
    expect(text).toMatch(/—/); // the readout is a dash, never a zero
  });
});
