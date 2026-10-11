import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { callerCanView, type AppSection, type StoredDashboardLayout, type UserRole } from "@silvicom/shared";

/**
 * `TabWidgets` under a stored layout (LM10, D-DW3).
 *
 * ── WHY THIS IS NOT IN `dashboardEquivalence.test.ts` ───────────────────────────────────────────
 * That harness proves LM9 changed nothing, and it does so by pinning ONE rendering — the role
 * default — against snapshots captured from the pre-catalogue tree. It therefore has to hold the
 * layout at `null`, and a harness cannot both hold a value fixed and vary it. This file varies it.
 *
 * ── AND WHY IT ASSERTS ORDER, NOT JUST PRESENCE ─────────────────────────────────────────────────
 * Hiding is the easy half and the half a careless implementation gets right. The order is where the
 * resolver's real decisions live — kept-first, untouched-appended — and a test that only counted
 * cards would pass on an implementation that ignored the stored order entirely.
 */

// ── The same shape of fixture the equivalence harness uses, trimmed to what these arms read ──────
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

const modules = ref(new Set(["dispatch", "navigation"]));
const withModules = (next: Set<string>) => { modules.value = next; };
vi.mock("@/composables/useModules", () => ({
  useModulesQuery: () => ({ data: computed(() => modules.value) }),
}));
// DR2b: the comparison composable is its own module so the previous window can be cached harder than
// the live one; mocked EMPTY here, so no delta pill renders and these assertions stay about layout.
vi.mock("./useDashboardComparison", () => ({
  useDashboardComparison: () => ({
    previousRange: computed(() => ({ from: "2026-08-01", to: "2026-08-31" })),
    previous: computed(() => undefined), mpgPrevious: computed(() => undefined),
    mpgPreviousWeeks: computed(() => []), fuelPrevious: computed(() => undefined), isLoading: ref(false),
  }),
}));
// The savings card is the Fuel costs page's strip (D-FO9); its query is vue-query and is answered here.
vi.mock("@/features/reconcile/useFuelOpportunities", () => ({
  useFuelOpportunitiesQuery: () => ({
    data: computed(() => [{ kind: "out_of_network", label: "Out of network", count: 3, amount: 410.5, withAmount: 3, oldest: "2026-09-02" }]),
    isLoading: computed(() => false), isError: computed(() => false),
  }),
}));
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
  ...(await importOriginal<object>()),
  useFindingsSummaryQuery: () => ({
    data: computed(() => ({ open: 4, recoveredThisQuarter: 12_500, quarterFrom: "2026-07-01" })),
    isLoading: ref(false),
  }),
}));

/**
 * ⚠ The ROLE is the single input, and `canView` is DERIVED from it by the real `callerCanView`.
 * There are two paths to "may this caller see money" — the widget gate goes through
 * `canReachSurface`, `applyMoneyGate` reads `session.canView` — and nothing checks they agree. A
 * fixture that stubs one and not the other produces a diff indistinguishable from a real money-gate
 * regression; `dashboardEquivalence.test.ts` paid for that lesson and this file inherits the fix.
 */
const role = ref<UserRole>("admin");
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    canView: (s: string) => callerCanView(role.value, s as AppSection, null),
    can: () => true,
    readOnly: false,
    role: role.value,
    sections: null,
  }),
}));

const layout = ref<StoredDashboardLayout | null>(null);
vi.mock("@/composables/useDashboardLayout", () => ({
  useDashboardLayout: () => ({
    layout: computed(() => layout.value),
    loading: computed(() => false),
    saving: computed(() => false),
    save: async () => {},
    reset: async () => {},
  }),
}));

const STUBS = {
  BaseChart: true,
  SamsaraFeedLine: true,
  DashboardLayoutEditor: true,
  RouterLink: { template: "<a><slot /></a>" },
  StatCard: { props: ["label"], template: "<dt>{{ label }}</dt>" },
  // Needs vue-query and a router of its own, and what is under test is whether it was CHOSEN.
  LiveMapWorkspace: true,
};

/**
 * The WIDGET KEYS this render produced, in document order — the grain a widget is (`Q-LM9a`), and
 * therefore the grain a layout moves.
 *
 * ⚠ Read off `data-test`, not off headings. The first draft of this file matched `h2` and captured
 * ONE card out of nine, because the cards do not agree on how they announce themselves — most carry
 * an `h3` title and the hero strip carries none. It failed loudly, but a variant that captured `h3`
 * would have passed while silently ignoring the two widgets that have no heading at all.
 */
function cards(html: string): string[] {
  return [...html.matchAll(/data-test="widget-([^"]+)"/g)].map((m) => m[1]!);
}

/** The empty state renders instead of the grid, so it has no widget markers of its own. */
const isEmptyState = (html: string) => html.includes("No cards on this tab");

async function renderTab(tab: string) {
  const { default: TabWidgets } = await import("./TabWidgets.vue");
  const wrapper = mount(TabWidgets, {
    props: { tab, range: { from: "2026-09-01", to: "2026-09-15" } },
    global: { stubs: STUBS },
  });
  return {
    cards: cards(wrapper.html()),
    html: wrapper.html(),
    /**
     * ⚠ Whether a CONTROL is offered is a question about buttons, not about the source text.
     * `html.includes("Customize")` looked equivalent and is not: Vue keeps HTML comments in its
     * output, and the comment explaining why there is no Customize button contains the word
     * "Customize". The assertion failed on correct markup — which is the lucky direction. The same
     * mistake inverted would have passed on a page that really did offer the button.
     */
    buttons: wrapper.findAll("button").map((b) => b.text().trim()),
  };
}

beforeEach(() => {
  // ⚠ Reset, or the module arm below leaks into whichever test vitest happens to run after it —
  // the kind of order dependence that reads as a flake rather than as a missing line.
  withModules(new Set(["dispatch", "navigation"]));
});

describe("TabWidgets applies the caller's own layout", () => {
  /** The v3 fleet tab, in catalogue order (D-FO10): six cards, named rather than derived. */
  const FLEET = ["fleet.fuel", "fleet.efficiency", "fleet.attention", "fleet.activity", "fleet.concentration", "fleet.savings"];

  it("renders every fleet card in catalogue order when there is no row", async () => {
    role.value = "admin";
    layout.value = null;
    expect((await renderTab("fleet")).cards).toEqual(FLEET);
  });

  it("puts the kept cards in the stored order, ahead of the ones nobody ruled on", async () => {
    role.value = "admin";
    // Last and first in the catalogue, named in the opposite order. Catalogue order cannot produce
    // this, so the assertion cannot pass on an implementation that ignored the stored list.
    layout.value = { widgetKeys: ["fleet.savings", "fleet.fuel"], hiddenKeys: [] };
    const { cards: out } = await renderTab("fleet");
    expect(out.slice(0, 2)).toEqual(["fleet.savings", "fleet.fuel"]);
    // …and the four they said nothing about follow, still in catalogue order.
    expect(out.slice(2)).toEqual(["fleet.efficiency", "fleet.attention", "fleet.activity", "fleet.concentration"]);
  });

  it("drops a hidden card and keeps every card nobody ruled on", async () => {
    role.value = "admin";
    layout.value = { widgetKeys: [], hiddenKeys: ["fleet.savings"] };
    const { cards: out } = await renderTab("fleet");
    expect(out).not.toContain("fleet.savings");
    // ⚠ The Done-when: the five they did NOT rule on are all still here, on their own default.
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("fleet.fuel");
  });

  it("shows the empty state, not a blank tab, when everything on it is hidden", async () => {
    role.value = "admin";
    layout.value = null;
    const all = (await renderTab("fleet")).cards;

    // Hide the lot. `widget_keys: []` with a row is D-DW3's "show me nothing".
    layout.value = { widgetKeys: [], hiddenKeys: FLEET };
    const { cards: out, html, buttons } = await renderTab("fleet");
    expect(all).toHaveLength(6);
    expect(out).toEqual([]);
    expect(isEmptyState(html)).toBe(true);
    expect(buttons).toContain("Customize");
  });

  /**
   * Q-FO4 (b). Every fleet-tab row saved before 2026-10-06 names only the nine keys v3 retired,
   * and the honest reading of that is "never arranged THIS tab" — the default, and one sentence
   * saying so. A row that still names one living card is an arrangement and gets no note.
   */
  it("says once that a saved arrangement from before the catalogue changed is not being used", async () => {
    role.value = "admin";
    layout.value = { widgetKeys: ["fleet.kpi-hero", "fleet.top-drivers"], hiddenKeys: ["fleet.severity"] };
    const stale = await renderTab("fleet");
    expect(stale.cards).toEqual(FLEET);
    expect(stale.html).toContain('data-test="stale-layout-note"');

    layout.value = { widgetKeys: ["fleet.attention", "fleet.kpi-hero"], hiddenKeys: [] };
    const partly = await renderTab("fleet");
    expect(partly.cards[0]).toBe("fleet.attention");
    expect(partly.html).not.toContain('data-test="stale-layout-note"');

    layout.value = null;
    expect((await renderTab("fleet")).html).not.toContain('data-test="stale-layout-note"');
  });

  it("gives the map to every role that can open the Dispatch tab, and offers nobody a way to hide it", async () => {
    layout.value = null;

    for (const who of ["dispatcher", "admin"] as const) {
      role.value = who;
      const tab = await renderTab("dispatch");
      expect(tab.cards, `${who} should get the map`).toEqual(["dispatch.live-map"]);
      expect(tab.buttons, `${who} should not be offered Customize`).not.toContain("Customize");
    }

    // A stored layout that hides it is ignored rather than obeyed: a workspace tab has no way back.
    layout.value = { widgetKeys: [], hiddenKeys: ["dispatch.live-map"] };
    expect((await renderTab("dispatch")).cards).toEqual(["dispatch.live-map"]);
  });

  it("says so plainly, and offers no Customize, when the org has no cards for this tab at all", async () => {
    role.value = "dispatcher";
    layout.value = null;
    withModules(new Set(["navigation"])); // no `dispatch` module

    const { cards: out, html, buttons } = await renderTab("dispatch");
    expect(out).toEqual([]);
    expect(html).toContain("Nothing to show here");
    expect(buttons).not.toContain("Customize");
    // …and it is not the other empty state, which would imply they had turned something off.
    expect(isEmptyState(html)).toBe(false);
  });

  it("cannot show a card the caller's gates refused, however the layout names it", async () => {
    role.value = "fleet_manager";
    layout.value = null;
    const withoutMoney = (await renderTab("fleet")).cards;
    expect(withoutMoney).not.toContain("fleet.savings");

    layout.value = { widgetKeys: ["fleet.savings", "fleet.fuel"], hiddenKeys: [] };
    const { cards: out, html } = await renderTab("fleet");
    expect(out).toEqual(["fleet.fuel", ...withoutMoney.filter((k) => k !== "fleet.fuel")]);
    expect(html).not.toMatch(/\$\s?\d/);
  });
});
