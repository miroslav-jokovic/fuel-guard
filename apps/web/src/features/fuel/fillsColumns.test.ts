import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * F02-F04 chunk 11b (AUDIT.md N6): a fill row says what it cost, and its gallons read as EFS billed them.
 *
 * Mounted with the REAL `DataTable`, because both facts live in cell slots: a test of the column list
 * alone would pass with the `#cell-total_cost` template missing and the raw number printed by the
 * table's default cell.
 */
// Real refs, not `{ value }` objects: the template reads `isLoading || unitPending` unwrapped, and a
// plain object there is truthy, which leaves the table on its loading skeleton.
const rows = ref<Record<string, unknown>[]>([]);
vi.mock("@/composables/useFuelLog", async () => {
  const { ref: r, computed } = await import("vue");
  return {
    FUEL_PAGE_SIZE: 20,
    useFuelTransactions: () => ({
      data: computed(() => ({ rows: rows.value, total: rows.value.length })),
      isLoading: r(false), isError: r(false), error: r(null), refetch: () => {}, isFetching: r(false),
    }),
    useFuelRangeTotals: () => ({ data: r(null) }),
  };
});
vi.mock("@/composables/useFleetMpg", () => ({ useFleetMpg: () => ({ data: { value: null } }) }));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: { value: [] } }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: { value: [] } }) }));
vi.mock("./unitFilter", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitOptions: () => r([]),
    useVehicleIdsForUnits: () => ({ vehicleIds: r(undefined), pending: r(false) }),
  };
});
vi.mock("vue-router", async (importOriginal) => ({
  ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
    await importOriginal<typeof import("vue-router")>(),
  ),
  useRouter: () => ({ push: () => {} }),
}));

import FillsTab from "./FillsTab.vue";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

const shared = (): FuelLogSharedFilters =>
  ({
    tab: ref("fills"), from: ref(undefined), to: ref(undefined), units: ref([]),
    setFrom: () => {}, setTo: () => {}, setUnits: () => {}, facet: () => ref(""), clear: () => {},
  }) as unknown as FuelLogSharedFilters;

const fill = (over: Record<string, unknown>) => ({
  id: "f1", org_id: "o", vehicle_id: null, driver_id: null, fueled_at: "2026-09-15T15:00:00Z", odometer: null,
  miles_since_last: null, gallons: 112.5, price_per_gal: 3.899, total_cost: 438.64, location_text: null, state: "TX",
  source: "fuel_card", card_ref: null, computed_mpg: null, has_anomaly: false, max_severity: null, ai_risk_level: null,
  samsara_location_confidence: null, tank_type: "tractor", case_level: null, case_score: null, case_signals: null,
  case_signals_unscored: null, case_gates: null, created_at: "2026-09-15T15:00:00Z",
  ...over,
});

// jsdom has no `matchMedia`, so DataTable would render its phone cards (see DataTable.test.ts). The
// columns are a table's question, so the viewport is a desktop one.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (media: string) => ({
    matches: true, media, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

const render = () => {
  const w = mount(FillsTab, {
    props: { shared: shared() },
    global: {
      plugins: [VueQueryPlugin, createPinia()],
      stubs: {
        FeedFreshnessLine: true, RowCoverageLine: true, FilterBar: true, ExportButton: true,
        DateRangeFilter: true, TablePagination: true, RouterLink: true,
      },
    },
  });
  const headers = w.findAll("thead th").map((th) => th.text());
  const cells = (i: number) => w.findAll("tbody tr")[i]!.findAll("td").map((td) => td.text());
  return { w, headers, cells };
};

describe("the Fills table's money and volume", () => {
  it("has an Amount column after $/gal, showing what EFS billed for the fill to the cent", () => {
    rows.value = [fill({})];
    const { headers, cells } = render();
    const amount = headers.indexOf("Amount");
    expect(amount).toBe(headers.indexOf("$/gal") + 1);
    expect(cells(0)[amount]).toBe("$438.64");
  });

  it("prints a fill with no amount as a dash, never $0.00", () => {
    rows.value = [fill({ total_cost: null })];
    const { headers, cells } = render();
    expect(cells(0)[headers.indexOf("Amount")]).toBe("—");
  });

  it("prints gallons to the hundredth with a thousands separator, as EFS sends them", () => {
    rows.value = [fill({ gallons: 112.5 }), fill({ id: "f2", gallons: 1204.35 })];
    const { headers, cells } = render();
    const g = headers.indexOf("Gallons");
    expect(cells(0)[g]).toBe("112.50");
    expect(cells(1)[g]).toBe("1,204.35");
  });
});
