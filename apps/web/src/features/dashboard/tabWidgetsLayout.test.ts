import { describe, it, expect, vi } from "vitest";
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

vi.mock("@/composables/useModules", () => ({
  useModulesQuery: () => ({ data: computed(() => new Set(["dispatch", "navigation"])) }),
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
  LiveMapPanel: true,
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
  return { cards: cards(wrapper.html()), html: wrapper.html() };
}

describe("TabWidgets applies the caller's own layout", () => {
  it("renders every fleet card in catalogue order when there is no row", async () => {
    role.value = "admin";
    layout.value = null;
    // The order the tab rendered before LM10 existed, named rather than derived — a test that
    // compared the render to itself would pass on any implementation at all.
    expect((await renderTab("fleet")).cards).toEqual([
      "fleet.feed-freshness",
      "fleet.kpi-hero",
      "fleet.operating-metrics",
      "fleet.spend-trend",
      "fleet.mpg-trend",
      "fleet.cost-composition",
      "fleet.severity",
      "fleet.top-vehicles",
      "fleet.top-drivers",
    ]);
  });

  it("puts the kept cards in the stored order, ahead of the ones nobody ruled on", async () => {
    role.value = "admin";
    // Last and first in the catalogue, named in the opposite order. Catalogue order cannot produce
    // this, so the assertion cannot pass on an implementation that ignored the stored list.
    layout.value = { widgetKeys: ["fleet.top-drivers", "fleet.feed-freshness"], hiddenKeys: [] };
    const { cards: out } = await renderTab("fleet");
    expect(out.slice(0, 2)).toEqual(["fleet.top-drivers", "fleet.feed-freshness"]);
    // …and the seven they said nothing about follow, still in catalogue order.
    expect(out.slice(2)).toEqual([
      "fleet.kpi-hero",
      "fleet.operating-metrics",
      "fleet.spend-trend",
      "fleet.mpg-trend",
      "fleet.cost-composition",
      "fleet.severity",
      "fleet.top-vehicles",
    ]);
  });

  it("drops a hidden card and keeps every card nobody ruled on", async () => {
    role.value = "admin";
    layout.value = { widgetKeys: [], hiddenKeys: ["fleet.top-drivers"] };
    const { cards: out } = await renderTab("fleet");
    expect(out).not.toContain("fleet.top-drivers");
    // ⚠ The Done-when: the eight they did NOT rule on are all still here, on their own default.
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("fleet.feed-freshness");
  });

  it("shows the empty state, not a blank tab, when everything on it is hidden", async () => {
    role.value = "admin";
    layout.value = null;
    const all = (await renderTab("fleet")).cards;

    // Hide the lot. `widget_keys: []` with a row is D-DW3's "show me nothing".
    layout.value = {
      widgetKeys: [],
      hiddenKeys: [
        "fleet.feed-freshness",
        "fleet.kpi-hero",
        "fleet.operating-metrics",
        "fleet.spend-trend",
        "fleet.mpg-trend",
        "fleet.cost-composition",
        "fleet.severity",
        "fleet.top-vehicles",
        "fleet.top-drivers",
      ],
    };
    const { cards: out, html } = await renderTab("fleet");
    expect(all).toHaveLength(9);
    expect(out).toEqual([]);
    expect(isEmptyState(html)).toBe(true);
    expect(html).toContain("Customize");
  });

  /**
   * D-DW2's consequence, and the reason the editor had to ship in the same merge as this rendering:
   * `dispatch.live-map` defaults to `dispatcher` alone, so an admin's Dispatch tab is empty until
   * they ask for the map. Empty with a way out — never empty with none.
   */
  it("gives a dispatcher the map by default and an admin the way to ask for it", async () => {
    layout.value = null;

    role.value = "dispatcher";
    expect((await renderTab("dispatch")).cards).toEqual(["dispatch.live-map"]);

    role.value = "admin";
    const asAdmin = await renderTab("dispatch");
    expect(asAdmin.cards).toEqual([]);
    expect(isEmptyState(asAdmin.html)).toBe(true);
    expect(asAdmin.html).toContain("Customize");

    // …and asking for it is one stored key.
    layout.value = { widgetKeys: ["dispatch.live-map"], hiddenKeys: [] };
    expect((await renderTab("dispatch")).cards).toEqual(["dispatch.live-map"]);
  });

  /**
   * The property that makes a layout safe to store at all: it narrows what the gates admitted and can
   * never widen it. A `fleet_manager` holds `accounting: none`, so the two money cards are not theirs
   * — naming them in a layout must change nothing.
   */
  it("cannot show a card the caller's gates refused, however the layout names it", async () => {
    role.value = "fleet_manager";
    layout.value = null;
    const withoutMoney = (await renderTab("fleet")).cards;
    expect(withoutMoney).not.toContain("fleet.spend-trend");
    expect(withoutMoney).not.toContain("fleet.cost-composition");

    layout.value = {
      widgetKeys: ["fleet.spend-trend", "fleet.cost-composition"],
      hiddenKeys: [],
    };
    const { cards: out, html } = await renderTab("fleet");
    expect(out).toEqual(withoutMoney);
    expect(html).not.toMatch(/\$\s?\d/);
  });
});
