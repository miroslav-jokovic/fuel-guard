import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { ref } from "vue";
import FuelStationsPage from "@/pages/FuelStationsPage.vue";
import FilterBar from "@/components/ui/FilterBar.vue";

const state = vi.hoisted(() => ({
  data: undefined as undefined | { stations: Record<string, unknown>[] },
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock("@/features/fueling/useFuelStations", async () => {
  const { computed } = await import("vue");
  return {
    useFuelStations: () => ({
      data: computed(() => state.data),
      isLoading: computed(() => state.isLoading),
      isError: computed(() => state.isError),
      error: computed(() => state.error),
      isFetching: computed(() => state.isLoading),
      refetch: vi.fn(),
    }),
  };
});

vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => false }),
}));

// A real memory router: filters, sort and page are read from the URL through `useQueryState` (D-US2).
// Built and settled before mounting, so the existing synchronous `page()` still mounts at once.
let router: Router;
async function at(url = "/fuel-stations") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/fuel-stations", component: { template: "<div/>" } }] });
  await router.push(url);
  await router.isReady();
}
const page = () => shallowMount(FuelStationsPage, {
  global: {
    plugins: [router],
    stubs: {
      DataWorkspace: { template: "<section><slot /></section>" },
    },
  },
});

beforeEach(async () => {
  await at();
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
});

describe("FuelStationsPage", () => {
  it("keeps the result count unknown while stations are loading", () => {
    state.isLoading = true;
    expect(page().find("filter-bar-stub").attributes("count")).toBeUndefined();
  });

  it("keeps the result count unknown when the station request fails", () => {
    state.isError = true;
    state.error = new Error("Could not load stations");
    expect(page().find("filter-bar-stub").attributes("count")).toBeUndefined();
  });

  it("shows the filtered count after the station request succeeds", () => {
    state.data = {
      stations: [
        { id: "one", name: "Pilot 1", state: "TX", brand: "pilot", netPrice: 3.1 },
        { id: "two", name: "Pilot 2", state: "OK", brand: "pilot", netPrice: 3.2 },
      ],
    };
    expect(page().find("filter-bar-stub").attributes("count")).toBe("2");
  });

  it("hands FilterBar its active filters and returns them to default on clear-all", async () => {
    state.data = {
      stations: [
        { id: "one", name: "Pilot 1", state: "TX", brand: "pilot", netPrice: 3.1 },
        { id: "two", name: "Pilot 2", state: "OK", brand: "pilot", netPrice: 3.2 },
      ],
    };
    const w = page();
    const bar = w.getComponent(FilterBar);
    expect(bar.props("activeCount")).toBe(0);

    // Through the search, because shallowMount does not render FilterBar's slots (the selects live there).
    bar.vm.$emit("update:search", "Pilot 1");
    await flushPromises();
    expect(bar.props("activeCount")).toBe(1);
    expect(bar.props("count")).toBe(1);

    bar.vm.$emit("clear-all");
    await flushPromises();
    expect(bar.props("activeCount")).toBe(0);
    expect(bar.props("search")).toBe("");
    expect(bar.props("count")).toBe(2);
  });
});

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12): filters, sort and page are in the URL. Cheapest net price
 * first is the default order and never written; the third click on a column writes `sort=any`.
 */
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

describe("FuelStationsPage keeps its list in the URL", () => {
  const stations = [
    { id: "a", name: "Pilot A", state: "TX", brand: "pilot", netPrice: 3.3 },
    { id: "b", name: "Pilot B", state: "OK", brand: "pilot", netPrice: 3.1 },
    { id: "c", name: "Flying J C", state: "OK", brand: "flying_j", netPrice: 3.2 },
  ];
  const full = async (url: string) => {
    await at(url);
    state.data = { stations };
    const w = mount(FuelStationsPage, { global: { plugins: [router], stubs: { PriceUploadDrawer: true, PageHeader: true } } });
    await flushPromises();
    return w;
  };
  const names = (w: Awaited<ReturnType<typeof full>>) => w.findAll("tbody tr td:first-child").map((td) => td.text());
  const table = (w: Awaited<ReturnType<typeof full>>) => w.findComponent({ name: "DataTable" });

  it("opens cheapest first with nothing in the URL", async () => {
    const w = await full("/fuel-stations");
    expect(table(w).props("sort")).toEqual({ key: "netPrice", dir: "asc" });
    expect(names(w)).toEqual(["Pilot B", "Flying J C", "Pilot A"]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reads a pasted link's filter and sort", async () => {
    const w = await full("/fuel-stations?state=OK&sort=name&dir=desc");
    expect(table(w).props("sort")).toEqual({ key: "name", dir: "desc" });
    expect(names(w)).toEqual(["Pilot B", "Flying J C"]);
  });

  it("walks the default column through descending to no sort, and back to cheapest first", async () => {
    const w = await full("/fuel-stations");
    table(w).vm.$emit("sort", "netPrice");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ dir: "desc" });
    table(w).vm.$emit("sort", "netPrice");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ sort: "any" });
    expect(table(w).props("sort")).toEqual({ key: null, dir: "asc" });
    table(w).vm.$emit("sort", "netPrice");
    await flushPromises();
    // `dir=asc` is spelled out here (useUrlSort writes the direction with any key), and reads the same
    // as the plain link: the default column, ascending.
    expect(router.currentRoute.value.query).toEqual({ dir: "asc" });
    expect(table(w).props("sort")).toEqual({ key: "netPrice", dir: "asc" });
  });

  it("writes a filter, and Clear filters keeps the sort", async () => {
    const w = await full("/fuel-stations?sort=name&dir=desc&page=2");
    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "Pilot");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ sort: "name", dir: "desc", search: "Pilot" });
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ sort: "name", dir: "desc" });
  });
});
