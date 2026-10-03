import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import { fuelReportTotals, FUEL_REPORT_TRUCK_FIGURES_NOTE, type FuelReport, type FuelReportDay } from "@silvicom/shared";
import type { FuelReportParams } from "@/features/reconcile/useFuelReport";

/**
 * Fuel Costs, mounted (FS2). The figures are `fuelCostView.test.ts`'s; what is only testable here is
 * WIRING — the defect family this page has the longest history of (a scope selector no template
 * rendered, a filter bar whose controls reached nothing on four of six tabs). So: every filter in the
 * URL reaches the one query, the page is one report with no tabs, a station filter swaps the truck
 * figures for the sentence, and old links still open it.
 */

const day = (d: string, o: Partial<FuelReportDay> = {}): FuelReportDay => ({
  day: d, network: "in", tank: "tractor", fills: 2, gallons: 200, spend: 800,
  retailFills: 0, retailGallons: 0, retailSpend: 0, retail: 0,
  contractFills: 0, contractGallons: 0, contractSpend: 0, contract: 0, ...o,
});

function fixture(params: FuelReportParams): FuelReport {
  const station = params.states.length + params.siteIds.length + params.networks.length > 0;
  // The last day nets 30 cents UNDER Pilot's quote, which rounds to nothing and once printed "-$0".
  const cur = [day(params.from), day(params.from, { network: "out", spend: 120, gallons: 30 }),
    day(params.to, { contractFills: 1, contractGallons: 10, contractSpend: 40, contract: 40.3 })];
  const prev = [day("2026-08-01", { spend: 700 })];
  const eff = (m: number) => ({
    mpg: {
      mpg: m, ratio: m, milesSource: "measured" as const, miles: 1300, gallons: 200, gallonsWithMiles: 200, measuredShare: 0.92,
      truckCoverage: 1, trucksMeasured: 4, trucksUnmeasured: 0, reason: null, from: params.from, to: params.to,
      requestedTo: params.to, partial: false, fuelThrough: params.to, timezone: "America/Chicago", trucksFuelled: 4,
      unattributedGallons: 0, readings: 40,
    },
    costPerMile: 0.6,
  });
  return {
    current: { from: params.from, to: params.to, days: cur, totals: fuelReportTotals(cur), efficiency: station ? null : eff(6.5) },
    previous: { from: "2026-08-01", to: "2026-08-31", days: prev, totals: fuelReportTotals(prev), efficiency: station ? null : eff(6.4) },
    // The LAST day, so its row is on the table's first page (newest first).
    trailingMpg: station ? null : [{ day: params.to, mpg: 6.51, measuredShare: 1, reason: null }],
    inNetworkBrands: ["pilot", "flying_j"],
    sites: [
      { stationId: "s-1", brand: "pilot", site: "436", city: "Amarillo", state: "TX", fills: 3, gallons: 300 },
      { stationId: null, brand: null, site: null, city: null, state: "CA", fills: 1, gallons: 60 },
    ],
  };
}

/** What the page handed the report query — the wiring under test. */
const seen = { params: null as Ref<FuelReportParams> | null };
vi.mock("@/features/reconcile/useFuelReport", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/useFuelReport")>();
  return {
    ...actual,
    useFuelReportQuery: (params: Ref<FuelReportParams>) => {
      seen.params = params;
      return {
        data: computed(() => fixture(params.value)), isLoading: ref(false), isError: ref(false),
        error: ref(null), isFetching: ref(false),
      };
    },
  };
});
vi.mock("@/features/reconcile/useSpendFreshness", () => ({
  useSpendFreshnessQuery: () => ({ data: computed(() => ({ lead: "Figures rebuilt 1 day ago.", stale: false })) }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: computed(() => [{ id: "v1", unit_number: "701" }, { id: "v2", unit_number: "754" }]) }),
}));
const opensAll = vi.hoisted(() => ({ value: true }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => opensAll.value }));

import FuelCostsPage from "./FuelCostsPage.vue";

beforeEach(() => {
  seen.params = null;
  opensAll.value = true;
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
    routes: [
      { path: "/fuel-spend", component: { template: "<div/>" } },
      { path: "/fuel-buy-discipline", component: { template: "<div/>" } },
      { path: "/fuel-invoices", component: { template: "<div/>" } },
    ],
  });
  await router.push(`/fuel-spend${query}`);
  await router.isReady();
  // The export button reads the toast store, so the page needs a Pinia even to render.
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(FuelCostsPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router };
}

describe("FuelCostsPage — one report", () => {
  it("has no tabs, and opens the report even from a link to a tab that no longer exists", async () => {
    for (const q of ["", "?tab=statements", "?tab=buy_discipline", "?tab=reconcile&grain=month"]) {
      const { w } = await mountPage(q);
      expect(w.findAll('[role="tab"]'), q).toHaveLength(0);
      expect(w.text(), q).toContain("Fuel spend");
      expect(w.text(), q).not.toMatch(/NaN|undefined/);
    }
  });

  it("states both ranges it compares, and the truck figures with their coverage", async () => {
    const t = (await mountPage("?from=2026-09-01&to=2026-09-30")).w.text();
    expect(t).toContain("09/01–09/30 compared with 08/01–08/31");
    expect(t).toContain("vs 08/01–08/31");
    expect(t).toContain("Cost per mile");
    expect(t).toContain("92% of this range's tractor fuel");
    expect(t).toContain("MPG — previous 7 days");
    expect(t).toContain("6.51");
    expect(t).not.toContain(FUEL_REPORT_TRUCK_FIGURES_NOTE);
    expect(t).not.toContain("-$0");
  });

  it("swaps the truck figures for the sentence under a station-side filter", async () => {
    for (const q of ["?states=TX", "?sites=s-1", "?networks=out"]) {
      const { w } = await mountPage(q);
      expect(w.text(), q).toContain(FUEL_REPORT_TRUCK_FIGURES_NOTE);
      // The card labels, not the page text: the method panel names cost per mile whatever the filter.
      const cards = w.findAllComponents({ name: "StatCard" }).map((c) => c.props("label"));
      expect(cards, q).toEqual(["Fuel spend", "Gallons", "Avg price / gal", "Paid vs Pilot quote", "Out of network"]);
      expect(w.text(), q).not.toContain("MPG — previous 7 days");
    }
  });
});

describe("FuelCostsPage — every filter reaches the query", () => {
  it("hands the window, trucks, states, locations and networks from the URL to the report", async () => {
    await mountPage("?from=2026-06-01&to=2026-06-30&trucks=v1,v2&states=TX,CA&sites=s-1&networks=out,unknown");
    expect(seen.params?.value).toEqual({
      from: "2026-06-01", to: "2026-06-30", vehicleIds: ["v1", "v2"], states: ["TX", "CA"], siteIds: ["s-1"], networks: ["out", "unknown"],
    });
  });

  it("follows the URL when a filter changes, rather than holding its first answer", async () => {
    const { router } = await mountPage("?from=2026-06-01&to=2026-06-30");
    await router.replace({ query: { from: "2026-07-01", to: "2026-07-31", networks: "in" } });
    await flushPromises();
    expect(seen.params?.value).toMatchObject({ from: "2026-07-01", networks: ["in"] });
  });

  it("drops a network the API doesn't know rather than sending a request it will refuse", async () => {
    await mountPage("?networks=pilot,out");
    expect(seen.params?.value.networks).toEqual(["out"]);
  });

  it("clears every filter, the station-side ones included", async () => {
    const { w, router } = await mountPage("?from=2026-06-01&to=2026-06-30&trucks=v1&states=TX&sites=s-1&networks=out");
    const clear = w.findAll("button").find((b) => b.text() === "Clear filters");
    expect(clear, "no Clear filters").toBeTruthy();
    await clear!.trigger("click");
    await flushPromises();
    for (const k of ["from", "to", "trucks", "states", "sites", "networks"]) {
      expect(router.currentRoute.value.query[k], k).toBeUndefined();
    }
  });

  it("offers Clear filters for a station-side filter alone", async () => {
    for (const q of ["?states=TX", "?sites=s-1", "?networks=out"]) {
      const { w } = await mountPage(q);
      expect(w.findAll("button").some((b) => b.text() === "Clear filters"), q).toBe(true);
    }
  });

  it("keeps a selected state or location in its menu when the range no longer holds it", async () => {
    // Otherwise the reader could neither see nor clear what is filtering the page.
    const { w } = await mountPage("?states=NV&sites=gone-1");
    const menu = (label: string) =>
      w.findAllComponents({ name: "FilterSelect" }).find((c) => c.props("label") === label)!.props("options") as { value: string; label: string }[];
    expect(menu("State").map((o) => o.label)).toContain("Nevada");
    expect(menu("Location")).toContainEqual({ value: "gone-1", label: "A location not in this range" });
  });

  it("offers the states and locations this range was fuelled in", async () => {
    const { w } = await mountPage();
    const labels = w.findAllComponents({ name: "FilterSelect" }).map((c) => [c.props("label"), c.props("options").map((o: { label: string }) => o.label)]);
    const menu = Object.fromEntries(labels) as Record<string, string[]>;
    expect(menu.State).toEqual(["California", "Texas"]);
    expect(menu.Location).toEqual(["436 · Amarillo · TX"]);
    expect(menu.Network).toEqual(["In network (Pilot / Flying J)", "Out of network", "Station not identified"]);
  });
});

describe("FuelCostsPage — where the rest went", () => {
  it("links Buy discipline and Pilot invoices where the guard opens them, and names them where it doesn't", async () => {
    const links = (w: Awaited<ReturnType<typeof mountPage>>["w"]) =>
      w.findAllComponents({ name: "RouterLink" }).map((l) => l.props("to")).map((to: string | { path: string }) => (typeof to === "string" ? to : to.path));
    expect(links((await mountPage()).w)).toEqual(expect.arrayContaining(["/fuel-buy-discipline", "/fuel-invoices"]));
    opensAll.value = false;
    const denied = (await mountPage()).w;
    expect(links(denied)).not.toContain("/fuel-buy-discipline");
    expect(denied.text()).toContain("Buy discipline");
  });

  it("opens Buy discipline on the days and trucks being read, and says what it cannot carry", async () => {
    const buyTo = (w: Awaited<ReturnType<typeof mountPage>>["w"]) =>
      w.findAllComponents({ name: "RouterLink" }).map((l) => l.props("to")).find((to) => typeof to !== "string" && to.path === "/fuel-buy-discipline");
    const scoped = await mountPage("?from=2026-09-01&to=2026-09-30&trucks=v1,v2");
    expect(buyTo(scoped.w)).toEqual({ path: "/fuel-buy-discipline", query: { from: "2026-09-01", to: "2026-09-30", trucks: "v1,v2" } });
    expect(scoped.w.text()).not.toContain("it opens on every station");
    const stationed = await mountPage("?from=2026-09-01&to=2026-09-30&states=TX");
    expect(buyTo(stationed.w)).toEqual({ path: "/fuel-buy-discipline", query: { from: "2026-09-01", to: "2026-09-30" } });
    expect(stationed.w.text()).toContain("it opens on every station");
  });

  it("keeps the freshness line and the PDF export", async () => {
    const t = (await mountPage()).w.text();
    expect(t).toContain("Figures rebuilt 1 day ago.");
    expect(t).toContain("Export report");
  });

  it("says so when it corrected the window in a link it was sent", async () => {
    const t = (await mountPage("?from=2026-09-30&to=2026-09-01")).w.text();
    expect(t).toMatch(/round|order|swap|corrected|adjust/i);
  });
});
