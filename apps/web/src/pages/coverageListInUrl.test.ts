import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Detection coverage keeps its search and its page in the URL.
 *
 * The list has no sort and no filters beyond the search, so what is pinned is the pair, and one trap
 * the conversion had to step around: the page used to reset on any change to the FILTERED list, which
 * also changes when the coverage read lands — so a pasted `?page=2` would have been thrown away the
 * moment the list loaded. It resets on the search now.
 */
const perTruck = Array.from({ length: 25 }, (_, i) => ({
  vehicleId: `v${String(i + 1).padStart(2, "0")}`, fills: 10, blindFills: 1, blindPct: 10,
  reconciledPct: 90, locationPct: 90, odometerPct: 90, attributedPct: 100,
}));
const summary = {
  perTruck, totalFills: 250, blindFills: 25, reconciledPct: 90, locationConfirmedPct: 80, locationPct: 90,
  odometerPct: 90, attributedPct: 100, unattributed: 0, cardIdentifiablePct: 100, cardBlindFills: 0, cardFills: 0,
  lastReconciledAt: null, timeBasis: { tank_confirmed: 0, stop_estimated: 0, reported: 0, date_only: 0, none: 0 },
};
vi.mock("@/features/fuel/useDetectionCoverage", () => ({
  useDetectionCoverage: () => ({ data: ref(summary), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
  useCapacityHealth: () => ({ data: ref(null) }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@/components/SamsaraFeedLine.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import CoveragePage from "./CoveragePage.vue";
import TablePagination from "@/components/TablePagination.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/coverage", component: { template: "<div/>" }, meta: { title: "Coverage" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(CoveragePage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}

describe("Detection coverage keeps its list in the URL", () => {
  it("reads a pasted search and page back into the list", async () => {
    const { w } = await mountAt("/coverage?search=v2");
    expect(w.findComponent({ name: "FilterBar" }).props("search")).toBe("v2");
    expect(w.findComponent(TablePagination).props("total")).toBe(6);

    const paged = await mountAt("/coverage?page=2");
    expect(paged.w.findComponent(TablePagination).props("page")).toBe(2);
    expect(paged.w.findAll("tbody tr")).toHaveLength(5);
  });

  it("writes the search and returns to page 1", async () => {
    const { w, query } = await mountAt("/coverage?page=2");
    w.findComponent({ name: "FilterBar" }).vm.$emit("update:search", "v1");
    await flushPromises();
    expect(query()).toEqual({ search: "v1" });
  });
});
