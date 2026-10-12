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
/** The date window the breakdown was asked for — what the summary tiles read too. */
const seen = vi.hoisted(() => ({ filter: null as null | { value: unknown } }));
const query = (data: unknown) => ({
  data: computed(() => data), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn(),
});
vi.mock("@/composables/useIdleBreakdown", () => ({
  useIdleBreakdown: (filter: { value: unknown }) => (seen.filter = filter, query({
    trucks: rows.trucks,
    fleet: {
      engineOnH: 1000, driveH: 700, idleH: 300, offH: 0, drivePct: 70, idlePct: 30, avoidableH: 20, avoidableUsd: 80,
      reducibleH: 50, reducibleUsd: 200, reducibleTrucks: 2, confidentTrucks: 2, totalTrucks: 2, rangeDays: 30,
      thinTrucks: 0, throughDay: "2026-10-02",
      avoidablePricing: { blendedPricePerGal: 5.912, pricedDays: 27, unpricedDays: 3 },
      reduciblePricing: { blendedPricePerGal: 5.9, pricedDays: 30, unpricedDays: 0 },
    },
  })),
}));
vi.mock("@/features/idle/useIdleDrivers", () => ({ useIdleDrivers: () => query([]) }));
vi.mock("@/composables/useIdleCostBasis", () => ({
  useIdleCostBasis: () => computed(() => ({ idleGalPerHour: 0.8, fuelPricePerGal: 3.9, priceSource: "truck_stops" })),
}));
// The capability read's state, per test: loaded and empty unless a test says it is pending or failed.
const caps = vi.hoisted(() => ({ loading: false, failed: false, refetch: (() => {}) as () => void }));
vi.mock("@/features/idle/useIdleCapabilities", () => ({
  useIdleCapabilities: () => ({
    data: computed(() => (caps.loading || caps.failed ? undefined : [])),
    isLoading: ref(caps.loading), isError: ref(caps.failed),
    error: ref(caps.failed ? new Error("Could not read the trucks' idle equipment") : null),
    isFetching: ref(false), refetch: caps.refetch,
  }),
}));
vi.mock("@/features/idle/useIdleSettings", () => ({
  useIdleSettings: () => ({ data: computed(() => null) }),
  useAdoptComfortBand: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/features/idle/useIdleConfidence", () => ({ useIdleConfidence: () => ({ data: computed(() => null) }) }));

import IdlingPage from "./IdlingPage.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";

beforeEach(() => {
  Object.assign(caps, { loading: false, failed: false, refetch: vi.fn() });
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

let router: ReturnType<typeof createRouter>;
async function mountPage(url = "/idling") {
  // PageHeader reads the route's meta for its title.
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/idling", component: { template: "<div/>" }, meta: { title: "Idling" } }] });
  await router.push(url);
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

describe("IdlingPage — each total says what it covers, how it was priced, and how far the data reaches", () => {
  it("puts the coverage and pricing lines on the card they qualify, and the reach above the cards", async () => {
    const w = await mountPage();
    const text = (id: string) => w.get(`[data-testid="${id}"]`).text();
    expect(text("idle-scope")).toBe(
      "Idle data through 10/02/2026. The cards are fleet totals; the search and filters below narrow the table, not them.",
    );
    expect(text("avoidable-coverage")).toBe("Counts 2 of 2 trucks.");
    expect(text("avoidable-pricing")).toContain("$5.912/gal on average");
    expect(text("avoidable-pricing")).toContain("3 of 30 days had no price and used $3.900/gal, the recent truck-stop median.");
    expect(text("reducible-coverage")).toBe("From 2 of 2 trucks: the ones with rest idle an APU would carry.");
    expect(text("reducible-pricing")).toContain("$5.900/gal on average");
    expect(text("reducible-pricing")).not.toContain("had no price");
    // Each line sits inside its own card, beside its own dollars.
    const card = (id: string) => w.get(`[data-testid="${id}"]`).element.closest("dl, div.rounded-surface, [class*='card']")?.textContent ?? "";
    expect(card("avoidable-pricing")).toContain("Avoidable idle");
    expect(card("reducible-pricing")).toContain("Needs an APU");
    // The old line named the fallback price as if every dollar were charged at it.
    expect(w.text()).not.toContain("live truck-stop prices");
  });
});

describe("IdlingPage — the Trucks table", () => {
  it("gives the active tab one embedded toolbar-and-table workspace", async () => {
    const w = await mountPage();
    const workspaces = w.findAllComponents(DataWorkspace);

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.getComponent(FilterBar).props("embedded")).toBe(true);
    expect(workspaces[0]!.getComponent({ name: "DataTable" }).props()["embedded"]).toBe(true);
  });

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

describe("IdlingPage — the tab strip and the two disclosures say what they are (design verdict, E8)", () => {
  it("is a labelled tablist whose tabs select the panel that names them", async () => {
    const w = await mountPage();
    expect(w.get('[role="tablist"]').attributes("aria-label")).toBe("Idling views");
    const tabs = w.findAll('[role="tab"]');
    // Each read has answered, so each tab carries its count — zero included.
    expect(tabs.map((t) => t.text().replace(/\s+/g, " "))).toEqual(["Trucks 2", "Drivers 0", "Truck capability 0"]);
    expect(tabs.map((t) => t.attributes("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(w.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe("idling-tab-trucks");
    await tabs[2]!.trigger("click");
    expect(tabs.map((t) => t.attributes("aria-selected"))).toEqual(["false", "false", "true"]);
    const panel = w.get('[role="tabpanel"]');
    expect(panel.attributes("id")).toBe(tabs[2]!.attributes("aria-controls"));
    expect(panel.attributes("aria-labelledby")).toBe(tabs[2]!.attributes("id"));
    expect(panel.text()).toContain("No trucks match");
    expect(panel.text()).toContain("0 trucks");
  });

  it("says whether How idle is scored is open, and points at what it opened", async () => {
    const w = await mountPage();
    const btn = w.findAll("button").find((b) => b.text().includes("How idle is scored"))!;
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(btn.attributes("aria-controls")).toBeUndefined();
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
    // Still named for what it opens: "Hide" alone tells a screen reader nothing about which region.
    expect(btn.text()).toBe("How idle is scored");
    const region = w.get(`#${btn.attributes("aria-controls")}`);
    expect(region.text()).toContain("Avoidable idle is waste we can coach");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(w.find("#idling-how-scored").exists()).toBe(false);
  });

  it("says whether Data completeness is open", async () => {
    const w = await mountPage();
    const btn = w.findAll("button").find((b) => b.text().includes("Data completeness"))!;
    expect(btn.attributes("aria-expanded")).toBe("false");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
  });
});

describe("IdlingPage — the Truck capability table never reads a pending or failed load as no trucks", () => {
  const openCapability = async () => {
    const w = await mountPage();
    await w.findAll('[role="tab"]')[2]!.trigger("click");
    return { w, panel: w.get("#idling-panel-capability") };
  };

  it("shows the table loading while the read is pending", async () => {
    caps.loading = true;
    const { w, panel } = await openCapability();
    expect(panel.text()).not.toContain("No trucks match");
    expect(panel.find(".animate-pulse").exists()).toBe(true);
    // Nor does its tab, or the bar above the table, claim a count it has not read.
    expect(w.findAll('[role="tab"]')[2]!.text()).toBe("Truck capability");
    expect(panel.text()).not.toContain("0 trucks");
  });

  it("shows the failure and a retry that reads again", async () => {
    caps.failed = true;
    const { panel } = await openCapability();
    expect(panel.text()).not.toContain("No trucks match");
    expect(panel.text()).toContain("Could not read the trucks' idle equipment");
    await panel.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(caps.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("IdlingPage — the dollar totals carry no direction (Q-FSV15 ruling 2, extended to Idling 2026-10-04)", () => {
  it("prints both money figures in the same ink as the other cards, with no danger or warning tone", async () => {
    const w = await mountPage();
    for (const id of ["avoidable-usd", "reducible-usd"]) {
      // The testid sits on the StatCard; the figure is its line that starts with the dollar sign.
      const value = w.get(`[data-testid="${id}"]`).findAll("p").find((p) => p.text().startsWith("$"));
      expect(value, id).toBeTruthy();
      const cls = value!.classes();
      expect(cls, id).toContain("text-ink");
      expect(cls.filter((c) => /^text-(danger|warning|success)/.test(c)), id).toEqual([]);
    }
  });
});

describe("IdlingPage — Clear filters on the Drivers tab", () => {
  it("clears the driver search but leaves the page's date window alone", async () => {
    const w = await mountPage();
    await w.findAll('[role="tab"]')[1]!.trigger("click");
    const panel = () => w.get('[role="tabpanel"]');
    const clear = () => panel().findAll("button").filter((b) => b.text() === "Clear filters");
    expect(clear()).toHaveLength(0);

    await panel().get('input[placeholder="Search driver…"]').setValue("smith");
    // AppSearchField debounces its emit by 250 ms; the count follows the emitted value.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(clear()).toHaveLength(1);

    await clear()[0]!.trigger("click");
    await flushPromises();
    expect(panel().get<HTMLInputElement>('input[placeholder="Search driver…"]').element.value).toBe("");
    expect(clear()).toHaveLength(0);
  });
});

// ── D-US2 (2026-10-12): the date window, the tab, and each tab's filters, sort and page live in the URL ──
describe("IdlingPage keeps what the reader was looking at in the URL", () => {
  const query = () => router.currentRoute.value.query;
  const units = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("tbody tr").map((r) => r.find("td").text());

  it("asks for the pasted date window — which the tiles above the tabs read too — and ignores one that is not a day", async () => {
    await mountPage("/idling?from=2026-09-01&to=2026-09-30");
    expect(seen.filter!.value).toEqual({ from: "2026-09-01T00:00:00", to: "2026-09-30T23:59:59" });
    await mountPage("/idling?from=yesterday");
    expect(seen.filter!.value).toEqual({ from: undefined, to: undefined });
  });

  it("opens the tab the link names, and each tab's list reads its own scoped keys", async () => {
    const w = await mountPage("/idling?tab=drivers&trucks.search=701");
    expect(w.findAll('[role="tab"]').map((t) => t.attributes("aria-selected"))).toEqual(["false", "true", "false"]);
    // The Trucks search is not the Drivers search.
    expect(w.get('input[placeholder="Search driver…"]').element).toHaveProperty("value", "");
  });

  it("reads the Trucks tab's filter and sort back from a pasted link", async () => {
    const w = await mountPage("/idling?trucks.sort=unit&trucks.dir=desc");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "unit", dir: "desc" });
    expect(units(w)).toEqual(["754", "701"]);
    const narrowed = await mountPage("/idling?trucks.capability=continuous_only");
    expect(units(narrowed)).toEqual(["754"]);
  });

  it("writes a chosen capability under the tab's scope; Clear filters keeps the window and the sort", async () => {
    const w = await mountPage("/idling?from=2026-09-01&trucks.sort=unit&trucks.dir=desc");
    w.findAllComponents({ name: "FilterSelect" }).find((c) => c.props("label") === "Capability")!.vm.$emit("update:modelValue", "apu");
    await flushPromises();
    expect(query()).toEqual({ from: "2026-09-01", "trucks.sort": "unit", "trucks.dir": "desc", "trucks.capability": "apu" });
    w.findComponent(FilterBar).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ from: "2026-09-01", "trucks.sort": "unit", "trucks.dir": "desc" });
  });
});
