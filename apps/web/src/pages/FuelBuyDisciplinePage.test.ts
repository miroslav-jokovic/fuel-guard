import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import { NO_FUEL_TARGETS, type FuelPolicy, type SpendLine } from "@silvicom/shared";

/**
 * Buy discipline, mounted — Fuel Spend's second tab, its own page since FS2 (Q-FSV12). These are the
 * old page's buy-discipline and discount-KPI assertions, moved with what they pin: the tab is
 * reachable, it is handed the page's window rather than one of its own (the B1 defect: one page, two
 * period controls), and the paid-vs-quote fills disclose behind their tile.
 */
const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: "Amarillo", unit: "701", driver: "A DRIVER",
  product: "diesel", tank: "tractor", retailAmount: null, contractAmount: null,
  quoteStaleDays: 0, miscAmount: null, salesTax: null, ...o,
});
const FEED: SpendLine[] = [
  fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 500, retailAmount: 560, contractAmount: 480 }),
  fill({ tranDate: "2026-08-18", gallons: 90, netAmount: 470, brand: "one9", site: "z1", unit: "754" }),
];
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
  // A second truck on a different leg (CA → NM), so a Trucks filter has something to exclude.
  {
    vehicleId: "v2", unit: "702", fueledAt: "2026-08-17T12:00:00Z", tranDate: "2026-08-17", inWindow: true,
    state: "CA", gallons: 150, netAmount: 150 * 6.6, milesSinceLast: null, baselineMpg: 7,
    levelBeforePct: 50, tankCapacityGal: 240,
  },
  {
    vehicleId: "v2", unit: "702", fueledAt: "2026-08-18T12:00:00Z", tranDate: "2026-08-18", inWindow: true,
    state: "NM", gallons: 100, netAmount: 100 * 5.2, milesSinceLast: 350, baselineMpg: 7,
    levelBeforePct: 50, tankCapacityGal: 240,
  },
];

const asQuery = <T,>(data: T) => ({ data: computed(() => data), isLoading: ref(false), isError: ref(false), error: ref(null) });
/** What the two inputs the targets are graded from report; flipped per test, reset in beforeEach. */
const inputState = { feed: "ready" as "ready" | "loading" | "error", settings: "ready" as "ready" | "loading" | "error" };
const withState = <T,>(data: T, state: "ready" | "loading" | "error") => ({
  data: computed(() => (state === "ready" ? data : undefined)), isLoading: ref(state === "loading"), isError: ref(state === "error"), error: ref(null),
});
const seen = { buyWindow: null as Ref<{ from: string; to: string }> | null, lineFilters: null as Ref<{ from: string }> | null };

vi.mock("@/features/reconcile/useBuyFills", () => ({
  useBuyFillsQuery: (window: Ref<{ from: string; to: string }>) => {
    seen.buyWindow = window;
    return asQuery(BUY_FILLS);
  },
}));
vi.mock("@/features/reconcile/useSpendLines", () => ({
  useSpendLinesQuery: (filters: Ref<{ from: string }>) => {
    seen.lineFilters = filters;
    return withState(FEED, inputState.feed);
  },
}));
const policy = ref<FuelPolicy>({ avoidStates: ["CA"], avoidBrands: ["one9"], preferredBrands: ["pilot", "flying_j"], targets: NO_FUEL_TARGETS });
vi.mock("@/composables/useRouteFuelSettings", () => ({
  useFuelPolicy: () => computed(() => policy.value),
  useRouteFuelSettings: () => withState({}, inputState.settings),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => asQuery([{ id: "v1", unit_number: "701" }]) }));
vi.mock("@/features/reconcile/usePriceCoverage", async (orig) => {
  const actual = await orig<typeof import("@/features/reconcile/usePriceCoverage")>();
  return {
    ...actual,
    usePriceCoverageQuery: () => asQuery({ days: [], covered: 0, carried: 0, uncovered: 0, firstPricedDay: null, lastPricedDay: null }),
  };
});

import FuelBuyDisciplinePage from "./FuelBuyDisciplinePage.vue";

beforeEach(() => {
  seen.buyWindow = null;
  seen.lineFilters = null;
  inputState.feed = "ready";
  inputState.settings = "ready";
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
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-buy-discipline", component: { template: "<div/>" } }, { path: "/truck-stops", component: { template: "<div/>" } }],
  });
  await router.push(`/fuel-buy-discipline${query}`);
  await router.isReady();
  setActivePinia(createPinia());
  const w = mount(FuelBuyDisciplinePage, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("FuelBuyDisciplinePage", () => {
  it("renders the carried-fuel finding and counts the legs it shows", async () => {
    const t = (await mountPage()).text();
    expect(t).toContain("Fuel carried out of dearer states");
    expect(t).toContain("CA → AZ");
    expect(t).toContain("fills in sequence");
    expect(t).not.toMatch(/NaN|undefined/);
  });

  it("hands both of its reads the page's window, not windows of their own", async () => {
    await mountPage("?from=2026-06-01&to=2026-06-30");
    expect(seen.buyWindow?.value).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(seen.lineFilters?.value).toMatchObject({ from: "2026-06-01" });
  });

  it("applies the Trucks filter to the fill sequence, not only to the brand cards", async () => {
    expect((await mountPage()).text()).toContain("CA → NM");
    const t = (await mountPage("?trucks=v1")).text();
    expect(t).toContain("CA → AZ");
    expect(t).not.toContain("CA → NM");
  });

  it("says the purchases are unavailable, not that there was no fuel, when the feed fails or is pending", async () => {
    const ok = (await mountPage()).text();
    expect(ok).toContain("On the preferred network");
    expect(ok).toContain("Paid vs Pilot quote");
    for (const [state, say] of [["error", "Couldn't load"], ["loading", "Loading the purchases"]] as const) {
      inputState.feed = state;
      const t = (await mountPage()).text();
      expect(t, state).toContain(say);
      expect(t, state).not.toContain("no tractor fuel in this window");
      expect(t, state).not.toContain("no fill in this window matched a quote");
      expect(t, state).not.toContain("Against it");
    }
  });

  it("grades nothing when the settings did not arrive, rather than reading defaults as 'no target set'", async () => {
    inputState.settings = "error";
    const t = (await mountPage()).text();
    expect(t).toContain("nothing is graded here");
    expect(t).not.toContain("no target set");
    expect(t).not.toContain("No target is set");
  });

  it("keeps the fills billed above Pilot's quote behind their tile until asked for", async () => {
    const w = await mountPage();
    expect(w.text()).not.toContain("Quoted / gal");
    const tile = w.findAll("button").find((b) => b.text().includes("Paid vs Pilot quote"));
    expect(tile, "the tile is not pressable").toBeTruthy();
    expect(tile!.attributes("aria-pressed")).toBe("false");
    await tile!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Quoted / gal");
  });
});
