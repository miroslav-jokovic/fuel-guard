import { beforeEach, describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
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

const page = () => shallowMount(FuelStationsPage, {
  global: {
    stubs: {
      DataWorkspace: { template: "<section><slot /></section>" },
    },
  },
});

beforeEach(() => {
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
    await w.vm.$nextTick();
    expect(bar.props("activeCount")).toBe(1);
    expect(bar.props("count")).toBe(1);

    bar.vm.$emit("clear-all");
    await w.vm.$nextTick();
    expect(bar.props("activeCount")).toBe(0);
    expect(bar.props("search")).toBe("");
    expect(bar.props("count")).toBe(2);
  });
});
