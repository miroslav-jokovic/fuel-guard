import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * F02-F04 chunk 11b (AUDIT.md N6): a fill row says what it cost, and its gallons read as EFS billed them.
 * Chunk 11c (N9): a tile whose figure has not arrived says so, never 0.
 *
 * Mounted with the REAL `DataTable`, because both facts live in cell slots: a test of the column list
 * alone would pass with the `#cell-total_cost` template missing and the raw number printed by the
 * table's default cell.
 */
// Real refs, not `{ value }` objects: the template reads `isLoading || unitPending` unwrapped, and a
// plain object there is truthy, which leaves the table on its loading skeleton.
const rows = ref<Record<string, unknown>[]>([]);
// The tiles' query, separate from the list's: either can fail alone, and N9 was the tiles printing 0
// when theirs did.
const totals = ref<Record<string, unknown> | null>(null);
const totalsFailed = ref(false);
const totalsStale = ref(false);
const mpg = ref<Record<string, unknown> | undefined>(undefined);
const mpgFailed = ref(false);
vi.mock("@/composables/useFuelLog", async () => {
  const { ref: r, computed } = await import("vue");
  return {
    FUEL_PAGE_SIZE: 20,
    useFuelTransactions: () => ({
      data: computed(() => ({ rows: rows.value, total: rows.value.length })),
      isLoading: r(false), isError: r(false), error: r(null), refetch: () => {}, isFetching: r(false),
    }),
    useFuelRangeTotals: () => ({ data: totals, isError: totalsFailed, isPlaceholderData: totalsStale }),
  };
});
vi.mock("@/composables/useFleetMpg", async () => {
  const { ref: r } = await import("vue");
  return { useFleetMpg: () => ({ data: mpg, isError: mpgFailed, isPlaceholderData: r(false) }) };
});
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

const range = { from: undefined as string | undefined, to: undefined as string | undefined };
const shared = (): FuelLogSharedFilters =>
  ({
    tab: ref("fills"), from: ref(range.from), to: ref(range.to), units: ref([]),
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

const TOTALS = {
  fillUps: 2, fillsWithVehicle: 2, totalMiles: 1234, totalGallons: 225, totalCost: 877.28,
  hasCost: true, flagged: 0, clear: 2,
};
/** The six tiles, as label → [figure, sub-line]. */
const tiles = (w: ReturnType<typeof render>["w"]) =>
  Object.fromEntries(
    w.findAll("dl > div").map((d) => {
      const dds = d.findAll("dd").map((x) => x.text());
      return [d.find("dt").text(), dds];
    }),
  );

describe("the tiles above the Fills table", () => {
  it("show the range's figures once their query has answered", () => {
    rows.value = [fill({}), fill({ id: "f2" })];
    totals.value = TOTALS;
    const t = tiles(render().w);
    expect(t["Total miles"]).toEqual(["1,234", "driven in selected range"]);
    expect(t["Gallons"]![1]).toBe("$877 total cost");
    expect(t["Clear"]![0]).toBe("2");
  });

  // 11c's accept line: a failed totals query renders "—". Before it, every tile here read 0.
  it.each([
    ["failed", () => { totalsFailed.value = true; }],
    ["not answered yet", () => { totals.value = null; }],
    ["still showing the previous window's answer", () => { totalsStale.value = true; }],
  ])("show a dash and Not available, never 0, when the totals query has %s", (_state, arrange) => {
    rows.value = [fill({}), fill({ id: "f2" })];
    totals.value = TOTALS;
    totalsFailed.value = false;
    totalsStale.value = false;
    arrange();
    try {
      const t = tiles(render().w);
      for (const label of ["Total miles", "Flagged", "Clear"]) expect(t[label]).toEqual(["—", "Not available"]);
      expect(t["Gallons"]).toEqual(["—", "Not available"]);
      // Total fill-ups is the LIST's count, which did answer; it is not this query's to withhold.
      expect(t["Total fill-ups"]![0]).toBe("2");
    } finally {
      totalsFailed.value = false;
      totalsStale.value = false;
    }
  });
});

describe("the Avg MPG tile", () => {
  const asked = () => { range.from = "2026-09-01"; range.to = "2026-09-30"; };
  const reset = () => { range.from = undefined; range.to = undefined; mpg.value = undefined; mpgFailed.value = false; };

  it("shows the measured figure for a full window", () => {
    asked();
    mpg.value = { mpg: 6.84, measuredShare: 0.97 };
    rows.value = [fill({})];
    totals.value = TOTALS;
    try {
      expect(tiles(render().w)["Avg MPG"]).toEqual(["6.8", "97% of fuel measured"]);
    } finally { reset(); }
  });

  it("says Not available when its own query fails, though the other tiles answered", () => {
    asked();
    mpg.value = { mpg: 6.84, measuredShare: 0.97 };
    mpgFailed.value = true;
    rows.value = [fill({})];
    totals.value = TOTALS;
    try {
      const t = tiles(render().w);
      expect(t["Avg MPG"]).toEqual(["—", "Not available"]);
      expect(t["Clear"]![0]).toBe("2");
    } finally { reset(); }
  });

  // Not asked is not unavailable: with no closed window there is no question, and the tile keeps its
  // explanation of what the figure would be.
  it("keeps its explanation, not Not available, when no window was asked", () => {
    rows.value = [fill({})];
    totals.value = TOTALS;
    expect(tiles(render().w)["Avg MPG"]).toEqual(["—", "measured miles ÷ fuel"]);
  });
});
