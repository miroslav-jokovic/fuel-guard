import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { FUEL_LOG_DECLINE_RISKS, FUEL_LOG_QUERY_KEYS, FUEL_LOG_TANK_TYPES, fuelLogToQuery } from "@silvicom/shared";
import { useFuelLogFilters } from "./useFuelLogFilters";

/**
 * The Fuel log reads its URL through `fuelLogLinkContract.ts`, the one definition Ask AI's `open_view`
 * writes with (F21 Step 5, D-AI6). A link built by the contract must land as the filters it names.
 */
async function open(query: Record<string, string>) {
  let f!: ReturnType<typeof useFuelLogFilters>;
  const C = defineComponent({
    setup() {
      f = useFuelLogFilters();
      return () => h("div");
    },
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/fuel-log", component: C }] });
  await router.push({ path: "/fuel-log", query });
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  await flushPromises();
  return { f, router };
}

describe("useFuelLogFilters reads the Fuel log link contract (F21 Step 5)", () => {
  it("lands a link built by the contract as the tab, window, trucks and the tab's own facets it names", async () => {
    const { f } = await open(fuelLogToQuery({ tab: "declines", from: "2026-11-01", to: "2026-11-07", units: ["718", "751"], risk: "alert", state: "TX" }));
    expect(f.tab.value).toBe("declines");
    expect([f.from.value, f.to.value]).toEqual(["2026-11-01", "2026-11-07"]);
    expect(f.units.value).toEqual(["718", "751"]);
    expect(f.facet(FUEL_LOG_QUERY_KEYS.risk, FUEL_LOG_DECLINE_RISKS).value).toBe("alert");
    expect(f.facet(FUEL_LOG_QUERY_KEYS.state).value).toBe("TX");
  });

  it("opens on Fills with the tank a link names, and a tab change drops the facet it owned", async () => {
    const { f, router } = await open(fuelLogToQuery({ tank: "reefer", units: ["718"] }));
    expect(f.tab.value).toBe("fills");
    expect(f.facet(FUEL_LOG_QUERY_KEYS.tank, FUEL_LOG_TANK_TYPES).value).toBe("reefer");
    f.tab.value = "declines";
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ tab: "declines", unit: "718" });
  });
});
