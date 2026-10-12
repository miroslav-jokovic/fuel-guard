import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — Reefer coverage keeps its search and pairing filter in the
 * URL. The table has no sort and no pages, so those two are the whole of the list's state.
 */
const truck = (vehicleId: string) => ({
  vehicleId, reeferActive: true, reeferGal: 100, reeferFills: 2, avgGalPerFill: 50, reeferSpend: 400,
  reeferSharePct: 10, avgCadenceDays: 7, lastReeferAt: null, daysSinceReefer: 3, primaryDriverId: null,
});
vi.mock("@/features/fuel/useReeferCoverage", () => ({
  useReeferCoverage: () => ({
    data: ref({ fleetMedianSharePct: 10, perTruck: [truck("v1"), truck("v2"), truck("v3")] }),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "101" }, { id: "v2", unit_number: "102" }, { id: "v3", unit_number: "103" }]) }),
}));
// 101 is paired to one reefer; 102 and 103 to none.
vi.mock("@/composables/useTrailers", () => ({
  useTrailersQuery: () => ({ data: ref([{ unit_number: "R1", is_reefer: true, status: "active", assigned_vehicle_id: "v1", reefer_tank_capacity_gal: 50 }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import ReeferCoveragePage from "./ReeferCoveragePage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/reefer", component: { template: "<div/>" }, meta: { title: "Reefer coverage" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(ReeferCoveragePage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const pairing = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Pairing")!;
const count = (w: Mounted) => w.findComponent({ name: "FilterBar" }).props("count");

describe("Reefer coverage keeps its list in the URL", () => {
  it("reads a pasted pairing and search back into the list", async () => {
    const { w } = await mountAt("/reefer?pairing=unpaired&search=103");
    expect(pairing(w).props("modelValue")).toBe("unpaired");
    expect(count(w)).toBe(1);
  });

  it("reads a pairing it does not know as all pairings", async () => {
    const { w } = await mountAt("/reefer?pairing=bogus");
    expect(pairing(w).props("modelValue")).toBe("");
    expect(count(w)).toBe(3);
  });

  it("writes a chosen pairing, and Clear filters takes both out", async () => {
    const { w, query } = await mountAt("/reefer?search=10");
    pairing(w).vm.$emit("update:modelValue", "paired");
    await flushPromises();
    expect(query()).toEqual({ search: "10", pairing: "paired" });
    expect(count(w)).toBe(1);
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({});
  });
});
