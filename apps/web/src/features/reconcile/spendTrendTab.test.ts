import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { computed, ref, type Ref } from "vue";
import type { SpendDay } from "@fuelguard/shared";

/**
 * The trend tab — the page's default view, and the one a boss opens it for.
 *
 * ── THE FAILURES THIS IS AIMED AT ────────────────────────────────────────────────────────────────
 * Two of them have already happened in this feature and neither was a type error:
 *
 *   • A comparison against a period still in progress. The first render of the server-side report
 *     announced spend down 88% and a $271,841 saving that never happened, because a one-day week was
 *     compared against a finished one. `comparablePeriods` fixed it in the pure layer; nothing checks
 *     that the TAB still asks for the complete periods rather than the raw series.
 *   • An edge bucket labelled past the window — a report ending on the 24th printing a row reading
 *     "2026-08-24 → 2026-08-30" (commit 37ec5f6).
 *
 * The third is open (L13): the headline tiles show the last COMPLETE period, and never say which one.
 * On the default 90-day week-grain view that is the week ending about ten days ago, sitting above a
 * table of every week and beside a fill count spanning all ninety days. F7 fixes it; the assertion
 * below records today's behaviour so the fix is visible when it lands rather than silent.
 */

const day = (d: string, o: Partial<SpendDay> = {}): SpendDay => ({
  day: d, vehicleId: "v1", fills: 1,
  gallonsTractor: 120, gallonsReefer: 0, gallonsDef: 0,
  spendTractor: 600, spendReefer: 0, spendDef: 0,
  miles: 720, mpgGallons: 120, milesRejected: 0,
  driveSec: 28800, idleSec: 3600, offSec: 3600, coverageSec: 36000, ...o,
});

/** Three complete Monday-start weeks, plus two days of a fourth that is still running. */
function threeWeeksAndABit(): SpendDay[] {
  const out: SpendDay[] = [];
  for (const start of ["2026-08-03", "2026-08-10", "2026-08-17"]) {
    const base = new Date(`${start}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(day(d.toISOString().slice(0, 10)));
    }
  }
  out.push(day("2026-08-24"), day("2026-08-25"));
  return out;
}

const DAYS = threeWeeksAndABit();
const seen = { daysFilters: null as Ref<{ from: string; to: string; vehicleIds: string[] }> | null };

const asQuery = <T,>(data: T) => ({
  data: computed(() => data), isLoading: ref(false), isError: ref(false), error: ref(null),
});

vi.mock("./useSpendDays", () => ({
  useSpendDaysQuery: (filters: Ref<{ from: string; to: string; vehicleIds: string[] }>) => {
    seen.daysFilters = filters;
    return asQuery(DAYS);
  },
}));
vi.mock("@/composables/useIdleCostBasis", () => ({
  useIdleCostBasis: () => computed(() => ({ idleGalPerHour: 0.8, fuelPricePerGal: 5, priceSource: "settings" as const })),
}));
// The idle card is fleet-wide and has its own pipeline (`useIdleBreakdown`, shared with the Idling
// page). It is stubbed here so this file tests the trend, not the idle verdict.
vi.mock("./IdleCostCard.vue", () => ({
  default: { name: "IdleCostCard", props: ["from", "to"], template: "<div>IDLE CARD</div>" },
}));

import SpendTrendTab from "./SpendTrendTab.vue";

const FILTERS = { from: "2026-08-03", to: "2026-08-25", vehicleIds: [] };

beforeEach(() => {
  setActivePinia(createPinia());
  seen.daysFilters = null;
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

const render = (props: Partial<{ filters: typeof FILTERS; grain: string; query: string }> = {}) =>
  mount(SpendTrendTab, {
    props: { filters: FILTERS, grain: "week", query: "from=2026-08-03&to=2026-08-25", ...props } as never,
    global: { plugins: [createPinia(), VueQueryPlugin] },
  });

describe("SpendTrendTab", () => {
  it("renders the tiles, the bridge and the period table together", () => {
    const t = render().text();
    expect(t).toContain("Fuel spend");
    expect(t).toContain("Cost per mile");
    expect(t).toContain("Fleet MPG");
    expect(t).toContain("Week by week");
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("undefined");
  });

  it("takes its window from the page rather than holding one of its own", () => {
    render();
    expect(seen.daysFilters?.value).toMatchObject({ from: "2026-08-03", to: "2026-08-25" });
  });

  it("marks the period still running rather than comparing against it", () => {
    // The 24th–25th is two days of a seven-day week. Reported as a finished week beside a real one it
    // manufactures a collapse in spend; the table must say it is partial.
    expect(render().text()).toContain("in progress");
  });

  it("never labels a period past the end of the window", () => {
    // A report ending on the 25th printed a row reading "2026-08-24 → 2026-08-30".
    const t = render().text();
    const beyond = t.match(/2026-08-(2[6-9]|3[01])/);
    expect(beyond, `a period ran past the window: ${beyond?.[0]}`).toBeNull();
  });

  it("says so instead of drawing a bridge when there is nothing to compare", () => {
    const t = mount(SpendTrendTab, {
      props: { filters: { from: "2026-08-03", to: "2026-08-09", vehicleIds: [] }, grain: "month", query: "" } as never,
      global: { plugins: [createPinia(), VueQueryPlugin] },
    }).text();
    expect(t).toContain("before spend can be explained");
    expect(t).not.toContain("NaN");
  });

  it("regroups when the page changes the grain, rather than keeping its own", () => {
    expect(render({ grain: "day" }).text()).toContain("Day by day");
    expect(render({ grain: "month" }).text()).toContain("Month by month");
  });

  // ── L13, open ─────────────────────────────────────────────────────────────────────────────────
  // Records today's behaviour so F7's fix is visible rather than silent: the headline tiles describe
  // the last COMPLETE period and name no period at all, while the table below spans every week.
  it("shows a headline for the last complete period, and does not yet name which one (L13)", () => {
    const t = render().text();
    expect(t).toContain("vs prior week");
    // When this starts failing, F7 has landed and the assertion should become the positive one.
    expect(t).not.toMatch(/Fuel spend[^]{0,40}week of 2026-08-17/);
  });
});
