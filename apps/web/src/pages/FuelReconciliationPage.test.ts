import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import type { SpendLine } from "@fuelguard/shared";

/**
 * The fuel-spend page, mounted.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
 * Four defects were found on this page in the 2026-08-25 audit and every one of them lived in a file
 * no test mounted. The suite was 152 shared + 25 web tests, all green, throughout. Two of the four
 * were invisible to typecheck as well, because they are not type errors:
 *
 *   • a `scope` selector declared in `<script setup>` that no template ever rendered, so it was pinned
 *     to its initial value forever and the two branches behind it were unreachable;
 *   • a filter bar whose date range, truck picker and count reached nothing on four of the six tabs it
 *     rendered on.
 *
 * Both are the same shape — a control that reaches nothing — and neither is detectable by testing the
 * pure analytics, which is what the page's own predecessor test file said should be done instead
 * ("the dashboard itself is data-driven ... exercised via the pure tests"). That reasoning is how this
 * page went unpinned; the assertions below are deliberately about WIRING rather than arithmetic.
 *
 * A third of the same family is already pinned elsewhere and is not repeated here: `FilterBar` has no
 * default slot, so controls placed as plain children are silently dropped and the bar renders empty
 * (commit 92b0e8c). What IS asserted here is that the controls reach the queries.
 */

// ── the data layer, replaced by fixtures ────────────────────────────────────────────────────────
// The page's job is to route filters into these and render what comes back. Mocking at this seam is
// what makes the wiring the subject: a query that never receives the window fails loudly below.

const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: "Amarillo", unit: "701", driver: "A DRIVER",
  product: "diesel", tank: "tractor", retailAmount: null, contractAmount: null,
  quoteStaleDays: 0, miscAmount: null, salesTax: null, ...o,
});

/** A fleet with one ONE9 fill, one California fill and one ordinary Pilot fill — enough for every tab. */
const FEED: SpendLine[] = [
  fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 500, retailAmount: 560, contractAmount: 500 }),
  fill({ tranDate: "2026-08-18", gallons: 90, netAmount: 470, brand: "one9", site: "z1", unit: "754" }),
  fill({ tranDate: "2026-08-19", gallons: 80, netAmount: 520, state: "CA", site: "c1", unit: "812" }),
];

/** What each mocked query was handed, so a test can assert the page actually passed the window. */
const seen = {
  spendLineFilters: null as Ref<{ from: string; to: string; vehicleIds: string[] }> | null,
  statementWindow: null as Ref<{ from: string; to: string }> | null,
  policyArgs: [] as unknown[][],
  buyWindow: null as Ref<{ from: string; to: string }> | null,
};

/** One California→Arizona leg: enough for the tab to render a finding. */
const BUY_FILLS = [
  {
    vehicleId: "v1", unit: "701", fueledAt: "2026-08-17T12:00:00Z", tranDate: "2026-08-17", inWindow: true,
    state: "CA", gallons: 150, netAmount: 150 * 6.6, milesSinceLast: null, baselineMpg: 7,
    levelBeforePct: 50, tankCapacityGal: 240,
  },
  {
    vehicleId: "v1", unit: "701", fueledAt: "2026-08-18T12:00:00Z", tranDate: "2026-08-18", inWindow: true,
    state: "AZ", gallons: 100, netAmount: 100 * 5.2, milesSinceLast: 350, baselineMpg: 7,
    levelBeforePct: 50, tankCapacityGal: 240,
  },
];

const asQuery = <T,>(data: T) => ({
  data: computed(() => data), isLoading: ref(false), isError: ref(false),
  error: ref(null), refetch: vi.fn(),
});

vi.mock("@/features/reconcile/useSpendLines", () => ({
  useSpendLinesQuery: (filters: Ref<{ from: string; to: string; vehicleIds: string[] }>) => {
    seen.spendLineFilters = filters;
    return asQuery(FEED);
  },
}));
vi.mock("@/features/reconcile/useStatements", () => ({
  useStatementsQuery: (window: Ref<{ from: string; to: string }>) => {
    seen.statementWindow = window;
    return asQuery([]);
  },
  useStatementLinesQuery: () => asQuery([]),
  statementSourceUrl: vi.fn(),
}));
// The org's policy, swappable per test — F3 made the two compliance tabs read `route_fuel_settings`
// instead of a constant, so what the page is even ABLE to show now depends on this.
const policy = ref<{ avoidStates: string[]; avoidBrands: string[]; preferredBrands: string[]; alwaysFillFull: boolean }>({
  avoidStates: ["CA"], avoidBrands: ["one9"], preferredBrands: ["pilot", "flying_j"], alwaysFillFull: true,
});
vi.mock("@/composables/useRouteFuelSettings", () => ({
  useFuelPolicy: () => computed(() => policy.value),
  useRouteFuelSettings: () => asQuery(null),
  useSaveRouteFuelSettings: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
// Discount capture now carries the price-coverage strip, which reads `fuel_price_coverage` from
// PostgREST. The strip has its own tests; here it only needs to render.
vi.mock("@/features/reconcile/usePriceCoverage", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/usePriceCoverage")>();
  return {
    ...actual,
    usePriceCoverageQuery: () => asQuery({
      days: [], covered: 0, carried: 0, uncovered: 0, firstPricedDay: null, lastPricedDay: null,
    }),
  };
});
// Buy discipline reads its own function (`fuel_buy_fills`, 0254) rather than the spend lines, because
// the sequence needs an instant, a vehicle id and the tank. Captured so a test can assert the page
// hands it the SAME window as everything else — the B1/X8 family, in a new tab.
vi.mock("@/features/reconcile/useBuyFills", () => ({
  useBuyFillsQuery: (window: Ref<{ from: string; to: string }>) => {
    seen.buyWindow = window;
    return asQuery(BUY_FILLS);
  },
  inWindowOnly: (r: Ref<unknown[]>) => computed(() => r.value ?? []),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => asQuery([{ id: "v1", unit_number: "701" }, { id: "v2", unit_number: "754" }]),
}));

// The two heaviest tabs carry their own queries and their own test files; here they only need to be
// reachable, so they are stubbed to a marker the tab assertions can look for.
vi.mock("@/features/reconcile/SpendTrendTab.vue", () => ({
  default: { name: "SpendTrendTab", template: "<div>SPEND TREND TAB</div>" },
}));
vi.mock("@/features/reconcile/ReconcileTab.vue", () => ({
  default: { name: "ReconcileTab", template: "<div>RECONCILE TAB</div>" },
}));

// `analyzePolicyExceptions` is spied rather than replaced: the tabs below render its real output, and
// what is being pinned is that the page passes a policy at all (B4a) — the argument F3 replaces with
// the org's own `route_fuel_settings`.
vi.mock("@fuelguard/shared", async (orig) => {
  const actual = await orig<typeof import("@fuelguard/shared")>();
  return {
    ...actual,
    analyzePolicyExceptions: (...args: unknown[]) => {
      seen.policyArgs.push(args);
      return (actual.analyzePolicyExceptions as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import FuelReconciliationPage from "./FuelReconciliationPage.vue";

beforeEach(() => {
  seen.spendLineFilters = null;
  seen.statementWindow = null;
  seen.policyArgs = [];
  seen.buyWindow = null;
  policy.value = { avoidStates: ["CA"], avoidBrands: ["one9"], preferredBrands: ["pilot", "flying_j"], alwaysFillFull: true };
  // DataTable branches on matchMedia; jsdom has none.
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

async function mountPage(query = "") {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-spend", name: "fuel-reconciliation", component: { template: "<div/>" }, meta: { title: "Fuel Reconciliation" } }],
  });
  await router.push(`/fuel-spend${query}`);
  await router.isReady();
  // Vue Test Utils does not unmount between tests, so a component from an earlier `it` is still alive
  // and still reactive: changing `policy` re-runs ITS computeds too, and those calls land in `seen`
  // before this mount's do. Clearing here makes every assertion about the page being mounted now.
  seen.policyArgs = [];
  // The export button reads the toast store, so the page needs a Pinia even to render.
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelReconciliationPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router };
}

const TABS = ["spend", "avoid_brand", "california", "off_network", "buy_discipline", "discount", "reconcile", "statements"];

describe("FuelReconciliationPage", () => {
  it("renders every tab without throwing or printing NaN", async () => {
    for (const tab of TABS) {
      const { w } = await mountPage(`?tab=${tab}`);
      const t = w.text();
      expect(t, `tab ${tab} rendered nothing`).not.toBe("");
      expect(t, `tab ${tab} printed NaN`).not.toContain("NaN");
      expect(t, `tab ${tab} printed undefined`).not.toContain("undefined");
    }
  });

  // ── the wiring, which is what actually broke ──────────────────────────────────────────────────
  it("hands the page window to the fills query", async () => {
    await mountPage("?from=2026-06-01&to=2026-06-30");
    expect(seen.spendLineFilters?.value).toMatchObject({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("hands the page window to the statements query too", async () => {
    // The statements tab used to read EVERY statement ever kept, while the filter bar above it
    // advertised a date range that reached nothing. There was a `scope` selector for this and no
    // template rendered it, so it sat on "all" and its other two branches could not be reached.
    await mountPage("?tab=statements&from=2026-06-01&to=2026-06-30");
    expect(seen.statementWindow, "statements query got no window at all").not.toBeNull();
    expect(seen.statementWindow?.value).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("moves the window on both queries together when the range changes", async () => {
    const { router } = await mountPage("?tab=statements&from=2026-06-01&to=2026-06-30");
    await router.replace({ query: { tab: "statements", from: "2026-07-01", to: "2026-07-31" } });
    await flushPromises();
    expect(seen.spendLineFilters?.value.from).toBe("2026-07-01");
    expect(seen.statementWindow?.value.from).toBe("2026-07-01");
  });

  it("narrows the fills query to the trucks the filter selected", async () => {
    await mountPage("?trucks=v1,v2");
    expect(seen.spendLineFilters?.value.vehicleIds).toEqual(["v1", "v2"]);
  });

  it("measures the org's own policy rather than the analyzer's default", async () => {
    // The report and the route planner read the same three `route_fuel_settings` columns; until F3
    // only the planner did, so a carrier who added a state got a planner that avoided it and a
    // compliance report that said the policy held.
    policy.value = { avoidStates: ["OR", "WA"], avoidBrands: ["pride"], preferredBrands: ["loves"], alwaysFillFull: true };
    await mountPage();
    expect(seen.policyArgs.length).toBeGreaterThan(0);
    expect(seen.policyArgs[0]![1]).toMatchObject({ avoidStates: ["OR", "WA"], avoidBrands: ["pride"] });
  });

  it("names the avoided-state tab after the states the org actually listed", async () => {
    policy.value = { ...policy.value, avoidStates: ["CA", "OR"] };
    const t = (await mountPage("?tab=california")).w.text();
    expect(t).toContain("California and Oregon");
    expect(t).toContain("bought in California, Oregon"); // the blurb lists them in full
  });

  it("names the avoided-brand tab after the brands the org actually listed", async () => {
    policy.value = { ...policy.value, avoidBrands: ["pride"] };
    const t = (await mountPage("?tab=avoid_brand")).w.text();
    expect(t).toContain("Pride and other off-brand sites");
    expect(t).not.toContain("ONE9");
  });

  it("hides a policy tab the org has deliberately emptied, rather than heading a report they did not ask for", async () => {
    policy.value = { ...policy.value, avoidStates: [] };
    const { w } = await mountPage();
    expect(w.text()).not.toContain("California");
  });

  it("falls back rather than blanking when a link points at a tab the policy no longer has", async () => {
    policy.value = { ...policy.value, avoidStates: [] };
    // A link sent last month, to a tab this org has since stopped having.
    expect((await mountPage("?tab=california")).w.text()).toContain("SPEND TREND TAB");
  });

  // ── the URL is the page's state, because the page exists to be sent to somebody ────────────────
  it("opens on the tab the link names, and falls back rather than blanking on one it does not know", async () => {
    expect((await mountPage("?tab=discount")).w.text()).toContain("Billed against contract");
    // An unknown tab is a hand-edited or stale link, not an error state.
    expect((await mountPage("?tab=not_a_tab")).w.text()).toContain("SPEND TREND TAB");
  });

  it("writes the tab back to the URL so the view can be linked", async () => {
    const { w, router } = await mountPage("?tab=california");
    expect(w.text()).toContain("California");
    await router.replace({ query: { tab: "off_network" } });
    await flushPromises();
    expect(w.text()).toContain("Off the preferred network");
  });

  // ── the figures the tabs introduce themselves with ────────────────────────────────────────────
  it("quotes per-gallon prices in cents, not rounded to the dollar", async () => {
    // This read "they cost $4 a gallon against $4 for the rest of the fleet" — the sentence
    // introducing the tab refuting the tab, because `usd()` sets maximumFractionDigits to 0.
    const t = (await mountPage("?tab=avoid_brand")).w.text();
    expect(t).toMatch(/\$\d+\.\d{3} a gallon against \$\d+\.\d{3}/);
  });

  it("says so when it corrected the window in a link it was sent", async () => {
    // `normalizeWindow` reports what it fixed rather than fixing silently, and its own header says the
    // page can therefore say so — and nothing rendered it, so a forwarded link with a backwards range
    // opened on a period the recipient had not asked for and was not told about.
    const t = (await mountPage("?from=2026-09-30&to=2026-09-01")).w.text();
    expect(t).toMatch(/round|order|swap|corrected|adjust/i);
  });

  it("shows the filter bar on every tab that reads data, and not on the upload tab", async () => {
    // "Clear filters" only appears once a filter is active, so the count label is the stable marker.
    expect((await mountPage("?tab=off_network")).w.text()).toContain("fills");
    expect((await mountPage("?tab=reconcile")).w.text()).not.toContain("Export report");
  });
});

// ── F13b: buy discipline ────────────────────────────────────────────────────────────────────────
// The tab has its own source and its own test file. What is only testable HERE is the wiring: that it
// is reachable, and that it is handed the page's own window rather than a second one. A tab with its
// own query is exactly where the B1 defect came from — one page, two disagreeing period controls.
describe("buy discipline", () => {
  it("is reachable and renders its finding", async () => {
    const t = (await mountPage("?tab=buy_discipline")).w.text();
    expect(t).toContain("Fuel carried out of dearer states");
    expect(t).toContain("CA → AZ");
    expect(t).not.toContain("NaN");
  });

  it("is handed the page's window, not a window of its own", async () => {
    await mountPage("?tab=buy_discipline&from=2026-06-01&to=2026-06-30");
    expect(seen.buyWindow?.value).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("counts what THIS tab is showing in the filter bar, not the feed's fills", async () => {
    // X8's rule: a number in a filter bar reads as "this is what you are looking at". The feed has
    // three fills and the sequence has two, so a bar reading three here would be describing the
    // wrong tab.
    const t = (await mountPage("?tab=buy_discipline")).w.text();
    expect(t).toContain("fills in sequence");
  });
});
