import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * The equivalence harness for LM9's widget-catalogue refactor
 * (`docs/plans/livemap/LIVE-MAP-PLAN.md` LM9, D-DW1).
 *
 * ── WHY IT IS WRITTEN BEFORE THE REFACTOR AND NOT AFTER ──────────────────────────────────────────
 * LM9 turns `DashboardPage` from a fixed template into a render over `DASHBOARD_WIDGETS`, and its
 * Done-when is that **this changes no behaviour for any existing role**. A claim like that is worth
 * nothing asserted after the fact: the only evidence is a snapshot captured against the PRE-CHANGE
 * tree that still passes afterwards. `routeTable.test.ts` made exactly this argument for the route
 * split and `navEquivalence.test.ts` for the sidebar catalogue — this is the third time, and the
 * shape is deliberately the same one.
 *
 * ⚠ It snapshots the ELEMENTS a role sees, in document order, and not the markup. A DOM diff would
 * fail on every wrapper `div` the refactor inevitably moves, which is the failure mode that gets an
 * equivalence test deleted rather than read. What must not change is *which tiles, headings and
 * charts a caller gets, in what order* — so that is what is pinned.
 *
 * ⚠⚠ AND IT IS PARAMETERISED ON `accounting`, because that is the one grant that changes this
 * screen's contents today (LM-F / Q-LM-F1). `fleet_manager` holds `accounting: none` and lost the
 * spend figures when #803 shipped; if LM9 quietly gave them back, every assertion about tile COUNT
 * would still pass and only this one would notice.
 */

// ── Fixtures: a summary shaped like the real one, with every field the tab reads ─────────────────
const SUMMARY = {
  totalSpend: 128_400.5,
  totalGallons: 34_100,
  idleCostUsd: 8_210.55,
  idleHours: 412,
  reeferSpend: 9_100,
  movingSpend: 111_000,
  declinedCount: 3,
  openAnomalies: 7,
  coveragePct: 95,
  allTimeCoveragePct: 23,
  anomaliesBySeverity: { low: 2, medium: 3, high: 4, critical: 1 },
  spendTrend: [{ date: "2026-09-01", value: 4200 }, { date: "2026-09-02", value: 3900 }],
  topVehiclesByRisk: [{ id: "v1", label: "Unit 1207", score: 88 }],
  topDriversByRisk: [{ id: "d1", label: "Ana Ruiz", score: 74 }],
};

const MPG_SERIES = {
  grain: "week" as const,
  total: { mpg: 7.4, measuredShare: 0.82, reason: null, milesSource: "odometer" },
  periods: [{ from: "2026-09-01", to: "2026-09-07", mpg: 7.4 }],
};

vi.mock("./useDashboard", () => ({
  useDashboard: () => ({ data: computed(() => SUMMARY), isLoading: ref(false), isFetching: ref(false) }),
}));
vi.mock("@/composables/useFuelLog", () => ({
  useFuelRangeTotals: () => ({ data: computed(() => ({ fillUps: 210, totalMiles: 251_000 })), isLoading: ref(false) }),
}));
vi.mock("@/composables/useFleetMpg", () => ({
  useFleetMpgSeries: () => ({ data: computed(() => MPG_SERIES) }),
}));
vi.mock("@/composables/useFindingsSummary", async (importOriginal) => ({
  // `ledgerTiles` is PURE and stays real: it owns the rule that a null hides a tile and a zero
  // renders one, which is part of what this harness is pinning.
  ...(await importOriginal<object>()),
  useFindingsSummaryQuery: () => ({
    data: computed(() => ({ open: 4, recoveredThisQuarter: 12_500, quarterFrom: "2026-07-01" })),
  }),
}));

const canView = ref<(section: string) => boolean>(() => true);
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    canView: (s: string) => canView.value(s),
    can: () => true,
    readOnly: false,
    role: "admin" as const,
  }),
}));

/**
 * Stubbed because they reach outside the component under test, not to simplify it: `BaseChart`
 * needs a real canvas, and `SamsaraFeedLine` runs its own query. Everything that decides WHICH
 * elements appear stays real.
 */
const STUBS = {
  BaseChart: true,
  SamsaraFeedLine: true,
  RouterLink: { template: "<a><slot /></a>" },
  /**
   * ⚠ `StatCard` is stubbed to a `dt` ON PURPOSE, and this is the fix for a harness that silently
   * covered half the screen. The real card renders its label in a `<p>`, so the first draft of this
   * file captured the operating-metrics strip and the charts and MISSED all four hero tiles — a
   * baseline that would have passed while LM9 deleted the most prominent thing on the page.
   *
   * `value` and `sub` are emitted with the label because that is where the money gate's fallback
   * shows: without `accounting`, "Idle waste" keeps its tile, swaps `$8.2k` for `412`, and keeps the
   * hours in its sub-label. A label-only capture cannot tell that from the money version — and a
   * label-and-sub capture reads "Idle waste — idle hrs" either way, which is how the second draft of
   * this stub nearly shipped blind to the one substitution LM-F exists to make.
   */
  StatCard: {
    props: ["label", "value", "sub"],
    template: "<dt>{{ label }} = {{ value }}{{ sub ? ' — ' + sub : '' }}</dt>",
  },
};

/** Every tile label, VALUE, section heading and chart title this render produced, in document order. */
function elements(html: string): string[] {
  const out: string[] = [];
  /**
   * `dt`/`dd` are the operating-metrics strip's label and value, `h2`/`h3` the section headings and
   * chart-card titles.
   *
   * ⚠ `dd` is included for the money gate's sake. The strip renders its value in a `dd`, so a
   * label-only capture shows "Recovered" identically whether it reads `$12.5k` or nothing — and
   * "which tiles still carry a dollar sign for a caller without `accounting`" is precisely the
   * question LM-F exists to answer and this harness has to be able to fail on.
   */
  for (const m of html.matchAll(/<(dt|dd|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = m[2]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push(`${m[1]}: ${text}`);
  }
  return out;
}

async function renderFleetTab() {
  const { default: FleetOverviewTab } = await import("./FleetOverviewTab.vue");
  const wrapper = mount(FleetOverviewTab, {
    props: { range: { from: "2026-09-01", to: "2026-09-15" } },
    global: { stubs: STUBS },
  });
  return elements(wrapper.html());
}

describe("the Dashboard renders the same elements before and after the widget catalogue (LM9)", () => {
  it("fleet overview · a caller who may see money", async () => {
    canView.value = () => true;
    expect(await renderFleetTab()).toMatchSnapshot();
  });

  /**
   * The `fleet_manager` case, and the one LM-F actually changed. Every money tile either falls back
   * to its operational twin ("Idle waste" keeps the hours) or disappears; a refactor that restored
   * the dollars here would pass every other assertion in this file.
   */
  it("fleet overview · a caller who may not see money", async () => {
    canView.value = (s) => s !== "accounting";
    expect(await renderFleetTab()).toMatchSnapshot();
  });

  /**
   * ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT LM-F'S LEAKS, and the reason it is not a snapshot.
   *
   * A snapshot records whatever the code does; run with `-u` it will happily record a regression.
   * This states the RULE — a caller without `accounting` sees no currency figure on this tab at all
   * — so a new money tile or a new money chart fails it on the day it is added rather than on the
   * day somebody reads a diff carefully.
   *
   * It is what the three leaks found on 2026-09-15 had in common: "Recovered · $12,500" survived
   * because `LedgerTile` had no `money` flag, and the spend line and the cost donut survived because
   * nothing gated them. Each was individually invisible; all three were one `$` away from obvious.
   */
  it("shows a caller without accounting no currency figure anywhere on the tab", async () => {
    canView.value = (s) => s !== "accounting";
    const { default: FleetOverviewTab } = await import("./FleetOverviewTab.vue");
    const wrapper = mount(FleetOverviewTab, {
      props: { range: { from: "2026-09-01", to: "2026-09-15" } },
      global: { stubs: STUBS },
    });
    // The whole rendered text, not just the elements the snapshot extracts — a hover title or an
    // aria-label carrying a dollar figure is the same leak somewhere harder to see.
    expect(wrapper.html()).not.toMatch(/\$/);
  });

  it("dispatch tab", async () => {
    const { default: DispatchTab } = await import("./DispatchTab.vue");
    const wrapper = mount(DispatchTab, { global: { stubs: STUBS } });
    expect(elements(wrapper.html())).toMatchSnapshot();
  });
});
