import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { computed, ref } from "vue";
import type { TruckIdleVerdict } from "@silvicom/shared";

/**
 * Idling, mounted — the Trucks table's shape (design verdict 2026-10-03, E3). Thirteen columns put the two
 * costs ninth and eleventh, off the right edge at a desktop width; what is pinned here is that the costs now
 * lead, that the time split behind them is one click away under each truck rather than gone, and that the
 * rows keep the breakdown's largest-cost-first order. The figures are `idleBreakdown`'s and not tested here.
 */

const truck = (o: Partial<TruckIdleVerdict>): TruckIdleVerdict => ({
  vehicleId: "v1", unit: "701", engineOnH: 210.5, driveH: 150, idleH: 60.5, offH: 500, idlePct: 29,
  managedH: 0, continuousH: 60.5, avoidableH: 12.3, avoidableUsd: 41.8, reducibleH: 30.1, reducibleUsd: 98.4,
  blendedPricePerGal: 3.9, unpricedDays: 0, unavoidableH: 0, justifiedH: 0, uncertainH: 0, operationalGraceH: 0,
  score: 80, alternative: "battery_apu", capability: "apu", coveragePct: 97, confident: true,
  restIdleH: 44.2, workIdleH: 16.3, ...o,
});

const rows = vi.hoisted(() => ({ trucks: [] as unknown[] }));
const query = (data: unknown) => ({
  data: computed(() => data), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
});
vi.mock("@/composables/useIdleBreakdown", () => ({
  useIdleBreakdown: () => query({
    trucks: rows.trucks,
    fleet: {
      engineOnH: 1000, driveH: 700, idleH: 300, offH: 0, drivePct: 70, idlePct: 30, avoidableH: 20, avoidableUsd: 80,
      reducibleH: 50, reducibleUsd: 200, reducibleTrucks: 2, confidentTrucks: 2, totalTrucks: 2, rangeDays: 30,
    },
  }),
}));
vi.mock("@/features/idle/useIdleDrivers", () => ({ useIdleDrivers: () => query([]) }));
vi.mock("@/composables/useIdleCostBasis", () => ({
  useIdleCostBasis: () => computed(() => ({ fuelPricePerGal: 3.9, priceSource: "truck_stops" })),
}));
vi.mock("@/features/idle/useIdleCapabilities", () => ({ useIdleCapabilities: () => ({ data: computed(() => []) }) }));
vi.mock("@/features/idle/useIdleSettings", () => ({
  useIdleSettings: () => ({ data: computed(() => null) }),
  useAdoptComfortBand: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/features/idle/useIdleConfidence", () => ({ useIdleConfidence: () => ({ data: computed(() => null) }) }));

import IdlingPage from "./IdlingPage.vue";

beforeEach(() => {
  rows.trucks = [
    truck({}),
    truck({ vehicleId: "v2", unit: "754", avoidableUsd: 0, avoidableH: 0, reducibleUsd: null, reducibleH: null, restIdleH: null, workIdleH: null, capability: "continuous_only" }),
  ];
  // DataTable branches on matchMedia; jsdom has none.
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (q: string) => ({
      matches: true, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

async function mountPage() {
  // PageHeader reads the route's meta for its title.
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/idling", component: { template: "<div/>" }, meta: { title: "Idling" } }] });
  await router.push("/idling");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(IdlingPage, {
    global: { plugins: [router, pinia], stubs: { SamsaraFeedLine: true, IdleBurnRatesPanel: true } },
  });
  await flushPromises();
  return w;
}

const headers = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("thead th").map((h) => h.text()).filter(Boolean);

describe("IdlingPage — the engine release gate is not an office figure (Q-FSV17 step 3)", () => {
  it("shows the burn rates under 'How idle is scored' and never the parity gate", async () => {
    const w = await mountPage();
    const scored = w.findAll("button").find((b) => b.text() === "How idle is scored")!;
    await scored.trigger("click");
    expect(w.findComponent({ name: "IdleBurnRatesPanel" }).exists()).toBe(true);
    const t = w.text();
    for (const s of ["Days with data missing", "finished days", "release", "parity"]) expect(t.toLowerCase(), s).not.toContain(s.toLowerCase());
  });
});

describe("IdlingPage — the Trucks table", () => {
  it("leads with the two costs, and keeps the table to seven columns", async () => {
    const w = await mountPage();
    expect(headers(w)).toEqual([
      "Truck", "Avoidable cost", "Avoidable hours", "Needs an APU, cost", "Needs an APU, hours", "Idle %", "Data completeness",
    ]);
  });

  it("keeps the breakdown's largest-cost-first order", async () => {
    const w = await mountPage();
    const units = w.findAll("tbody tr").map((r) => r.find("td").text());
    expect(units).toEqual(["701", "754"]);
  });

  it("opens where a truck's running time went under that truck, and closes it again", async () => {
    const w = await mountPage();
    expect(w.find('[data-testid="truck-detail"]').exists()).toBe(false);
    const toggle = w.findAll("button[aria-expanded]").find((b) => b.attributes("aria-label")?.includes("truck 701"))!;
    expect(toggle.attributes("aria-expanded")).toBe("false");
    await toggle.trigger("click");
    const detail = w.find('[data-testid="truck-detail"]');
    expect(detail.exists()).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const t = detail.text();
    for (const s of ["Engine hours", "210.5 h", "Driving", "150 h", "Idling", "60.5 h", "off duty or sleeping", "44.2 h", "on duty", "16.3 h", "Engine-off rest"]) {
      expect(t, s).toContain(s);
    }
    // One truck's detail only: the other row stays closed.
    expect(w.findAll('[data-testid="truck-detail"]')).toHaveLength(1);
    await toggle.trigger("click");
    expect(w.find('[data-testid="truck-detail"]').exists()).toBe(false);
  });

  it("prints a dash, not 0 h, for a truck with no duty split", async () => {
    const w = await mountPage();
    await w.findAll("button[aria-expanded]").find((b) => b.attributes("aria-label")?.includes("truck 754"))!.trigger("click");
    const detail = w.get('[data-testid="truck-detail"]');
    const value = (label: string) => detail.findAll("div").find((d) => d.find("dt").text() === label)!.find("dd").text();
    expect(value("Idling while off duty or sleeping")).toBe("—");
    expect(value("Idling on duty")).toBe("—");
    expect(detail.text()).toContain("Continuous idle only");
  });
});
