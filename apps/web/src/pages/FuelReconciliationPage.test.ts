import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import type { SpendLine } from "@silvicom/shared";

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

/** What the freshness strip is told. Mutable so a test can make the window stale. */
const FRESHNESS = { value: { builtAt: "2026-08-24T05:00:00Z", ageDays: 1, stale: false, lead: "Figures rebuilt 1 day ago.", short: "1 day ago" } as Record<string, unknown> | null };

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
// A6 / FUEL-T5. Mocked like every other composable this page reads — an unmocked one reaches for a
// real query client the harness does not provide, and takes the whole page down. Its own query is
// asserted in `useSpendFreshness.test.ts`; what matters here is that the page renders the sentence.
vi.mock("@/features/reconcile/useSpendFreshness", () => ({
  useSpendFreshnessQuery: () => asQuery(FRESHNESS.value),
}));

// The two heaviest tabs carry their own queries and their own test files; here they only need to be
// reachable, so they are stubbed to a marker the tab assertions can look for.
vi.mock("@/features/reconcile/SpendTrendTab.vue", () => ({
  default: { name: "SpendTrendTab", template: "<div>SPEND TREND TAB</div>" },
}));
vi.mock("@/features/reconcile/ReconcileTab.vue", () => ({
  default: { name: "ReconcileTab", template: "<div>RECONCILE TAB</div>" },
}));

// ⚠ `analyzePolicyExceptions` used to be spied here, because the page called it for its three policy
// tabs. FUEL-C5 removed those tabs and moved the call — with the titles, the blurbs and the
// buy-minimum note — to `features/reconcile/policyReports.ts`, kept in the tree unmounted until C6
// files their findings. Every assertion that depended on the spy moved with it to
// `policyReports.test.ts`; deleting them here without moving them is how "kept in the tree" would
// have quietly become "kept and never checked again".

import FuelReconciliationPage from "./FuelReconciliationPage.vue";

beforeEach(() => {
  seen.spendLineFilters = null;
  seen.statementWindow = null;
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
  // The export button reads the toast store, so the page needs a Pinia even to render.
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelReconciliationPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router };
}

/**
 * Three, down from eight (FUEL-C5, D-FUI4). The five that went: `reconcile` is a drawer on
 * Statements, `discount` is a KPI on Spend & trend, and the three policy reports become finding kinds
 * in C6 with their bodies kept in the tree. Every one of those five values still resolves — a link
 * sent last week must land somewhere — which is what `falls back` below asserts.
 */
const TABS = ["spend", "buy_discipline", "statements"];
const RETIRED_TABS = ["reconcile", "discount", "avoid_brand", "california", "off_network"];

describe("FuelReconciliationPage", () => {
  it("is three tabs, and names them", async () => {
    const labels = (await mountPage()).w.findAll('[role="tab"]').map((b) => b.text().trim());
    expect(labels).toEqual(["Spend & trend", "Buy discipline", "Statements"]);
  });

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

  it("no longer heads a tab with a policy list, whatever the org configured", async () => {
    // The strip used to change shape per carrier: two of the eight only existed when
    // `route_fuel_settings` named a brand or a state. Those reports are not gone — see
    // `policyReports.test.ts`, which owns every assertion about what they SAY — but the tab strip is
    // fixed now, because every carrier has a fuel bill, a fill sequence and a vendor.
    policy.value = { avoidStates: ["OR", "WA"], avoidBrands: ["pride"], preferredBrands: ["loves"], alwaysFillFull: true };
    const labels = (await mountPage()).w.findAll('[role="tab"]').map((b) => b.text().trim());
    expect(labels).toEqual(["Spend & trend", "Buy discipline", "Statements"]);
  });

  // ── the URL is the page's state, because the page exists to be sent to somebody ────────────────
  /**
   * ⚠ Five `?tab=` values stopped existing in one step, and every one of them is in somebody's
   * bookmark or somebody's ticket. A link that opens on nothing is worse than one that opens on the
   * wrong thing, so they all resolve to the trend — the same fallback the unknown-tab case has always
   * taken, now doing considerably more work.
   */
  it("lands every retired tab value on the trend rather than on nothing", async () => {
    for (const tab of RETIRED_TABS) {
      const t = (await mountPage(`?tab=${tab}`)).w.text();
      expect(t, `?tab=${tab} rendered nothing`).toContain("SPEND TREND TAB");
    }
    // An unknown tab is a hand-edited or stale link, not an error state.
    expect((await mountPage("?tab=not_a_tab")).w.text()).toContain("SPEND TREND TAB");
  });

  it("writes the tab back to the URL so the view can be linked", async () => {
    const { w, router } = await mountPage("?tab=buy_discipline");
    expect(w.text()).toContain("Fuel carried out of dearer states");
    await router.replace({ query: { tab: "statements" } });
    await flushPromises();
    expect(w.text()).toContain("statement");
  });

  it("says so when it corrected the window in a link it was sent", async () => {
    // `normalizeWindow` reports what it fixed rather than fixing silently, and its own header says the
    // page can therefore say so — and nothing rendered it, so a forwarded link with a backwards range
    // opened on a period the recipient had not asked for and was not told about.
    const t = (await mountPage("?from=2026-09-30&to=2026-09-01")).w.text();
    expect(t).toMatch(/round|order|swap|corrected|adjust/i);
  });

  /**
   * C5's done-when, in one test: "the page has three tabs and the coverage line still renders above
   * all of them."
   *
   * It used to render above only some. The file reader was excepted from the filter bar, the
   * rollup-freshness line AND the coverage line — three `tab !== 'reconcile'` guards for one tab —
   * because a period control means nothing while you are reading a file. That tab is a drawer now,
   * so every remaining view reads the same window and every one of them says so.
   */
  it("puts the window's coverage and freshness above ALL THREE tabs", async () => {
    for (const tab of TABS) {
      const t = (await mountPage(`?tab=${tab}`)).w.text();
      expect(t, `${tab} lost the coverage line`).toContain("of tractor fuel");
      expect(t, `${tab} lost the freshness line`).toContain("Figures rebuilt");
      expect(t, `${tab} lost the export`).toContain("Export report");
    }
  });
});

/**
 * FUEL-C5 — the two capabilities that stopped being tabs without stopping being capabilities.
 */
describe("FuelReconciliationPage — reconcile is a drawer, discount is a KPI", () => {
  it("offers the file reader from Statements, where its absence is felt", async () => {
    const { w } = await mountPage("?tab=statements");
    const open = w.findAll("button").find((b) => b.text().trim() === "Reconcile a file");
    expect(open, "no Reconcile action on the Statements tab").toBeTruthy();

    // The empty state above it points at the button by name, so the one sentence that says this view
    // needs a statement also says how to supply one.
    expect(w.text()).toContain("Use Reconcile a file above");

    // ⚠ Asserted on the drawer COMPONENT rather than on `w.text()`: Headless UI's `Dialog` teleports
    // its panel to `document.body`, so the open drawer's markup is outside the wrapper's subtree
    // entirely and a text assertion would report "closed" for a drawer that is plainly open.
    const drawer = w.findComponent({ name: "ReconcileDrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("open")).toBe(false);
    await open!.trigger("click");
    await flushPromises();
    expect(w.findComponent({ name: "ReconcileDrawer" }).props("open")).toBe(true);
    // …and it holds the reader itself, not an empty panel.
    expect(document.body.textContent).toContain("RECONCILE TAB");
  });

  it("does not offer it from the other two tabs — it belongs to the statement, not to the page", async () => {
    for (const tab of ["spend", "buy_discipline"]) {
      const { w } = await mountPage(`?tab=${tab}`);
      expect(w.findAll("button").find((b) => b.text().trim() === "Reconcile a file"), tab).toBeFalsy();
    }
  });

  /**
   * The KPI states its own scope, which is the whole reason it is not in `SpendTrendTab`'s tile row:
   * that row is captioned "these describe the last complete week" and this figure covers the window.
   */
  it("puts discount capture on Spend & trend as a KPI that says what it measured over", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("Billed against contract");
    expect(t).toMatch(/of this window's fuel priced/);
  });

  it("keeps the fills behind the KPI until they are asked for", async () => {
    const { w } = await mountPage();
    // `Quoted / gal` is a column of the exceptions table — the report itself, not the tile.
    expect(w.text()).not.toContain("Quoted / gal");
    const tile = w.findAll("button").find((b) => b.text().includes("Billed against contract"));
    expect(tile, "the KPI tile is not pressable").toBeTruthy();
    // The disclosure state is the primitive's own, announced rather than implied (D-UI5).
    expect(tile!.attributes("aria-pressed")).toBe("false");
    await tile!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Quoted / gal");
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

/**
 * A6 / D-FUI18 — the page says when its figures were derived, above the figures.
 *
 * The rollup rebuilds only the trailing 14 days, so a window reaching further back shows numbers
 * derived once and never re-derived through any correction since. The reader cannot infer that from
 * anything else on screen: a stale figure is not a smaller number, it is an older one.
 */
describe("FuelReconciliationPage — how current the figures are", () => {
  it("prints the build age above the figures it qualifies", async () => {
    FRESHNESS.value = { builtAt: "2026-08-24T05:00:00Z", ageDays: 1, stale: false, lead: "Figures rebuilt 1 day ago.", short: "1 day ago" };
    const { w } = await mountPage();
    expect(w.text()).toContain("Figures rebuilt 1 day ago.");
  });

  it("gives a stale window the caution treatment, and a fresh one no treatment at all", async () => {
    FRESHNESS.value = { builtAt: "2026-07-01T00:00:00Z", ageDays: 40, stale: true, lead: "Some figures here were last rebuilt 40 days ago.", short: "40 days ago — older than the 14-day rebuild" };
    const { w: stale } = await mountPage();
    expect(stale.html()).toContain("bg-caution-50");

    FRESHNESS.value = { builtAt: "2026-08-24T05:00:00Z", ageDays: 1, stale: false, lead: "Figures rebuilt 1 day ago.", short: "1 day ago" };
    const { w: fresh } = await mountPage();
    // A rebuild that happened yesterday is context, not an alert. Toning every freshness line the same
    // way is how a caution colour stops meaning anything.
    expect(fresh.text()).toContain("Figures rebuilt 1 day ago.");
    expect(fresh.html()).not.toContain("bg-caution-50");
  });

  it("renders nothing when the window holds no rows — there is no age to report", async () => {
    FRESHNESS.value = { builtAt: null, ageDays: null, stale: false, lead: null, short: null };
    const { w } = await mountPage();
    expect(w.text()).not.toContain("Figures rebuilt");
  });
});
