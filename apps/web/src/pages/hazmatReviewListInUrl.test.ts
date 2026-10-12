import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the hazmat review queue keeps its filters in the URL, so
 * Back from a load's review returns to the same narrowed queue. The queue has no sort of its own:
 * oldest-first is the review order, and it is the API's.
 */
const load = (id: string, vehicle_id: string, driver_id: string, load_ref: string) => ({
  id, vehicle_id, driver_id, load_ref, declared_lines: [{ text: "UN1203 gasoline" }], created_at: "2026-10-10T12:00:00Z",
});
const LOADS = [load("a", "v1", "d1", "L-100"), load("b", "v2", "d1", "L-200"), load("c", "v1", "d2", "L-300")];

vi.mock("@/features/hazmat/useHazmatReview", () => ({
  useReviewQueueQuery: () => ({ data: ref(LOADS), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "101" }, { id: "v2", unit_number: "102" }]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: "d1", full_name: "Ann" }, { id: "d2", full_name: "Bo" }]) }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import HazmatReviewPage from "./HazmatReviewPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/hazmat/review", component: { template: "<div/>" } }] });
  await router.push(url);
  await router.isReady();
  const w = mount(HazmatReviewPage, { global: { plugins: [router], stubs: { PageHeader: true } } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const select = (w: Mounted, label: string) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
const ids = (w: Mounted) => (w.findComponent({ name: "DataTable" }).props("rows") as Array<{ id: string }>).map((r) => r.id);

describe("the hazmat review queue keeps its filters in the URL", () => {
  it("reads the truck, the driver and the search back from a pasted link", async () => {
    const { w } = await mountAt("/hazmat/review?truck=v1&driver=d2");
    expect(select(w, "Truck").props("modelValue")).toBe("v1");
    expect(ids(w)).toEqual(["c"]);

    const searched = await mountAt("/hazmat/review?search=L-200");
    expect(ids(searched.w)).toEqual(["b"]);
  });

  it("writes a control change to the URL", async () => {
    const { w, query } = await mountAt("/hazmat/review");
    select(w, "Driver").vm.$emit("update:modelValue", "d1");
    await flushPromises();
    expect(query()).toEqual({ driver: "d1" });
    expect(ids(w)).toEqual(["a", "b"]);
  });

  it("Clear filters empties every filter at once", async () => {
    const { w, query } = await mountAt("/hazmat/review?truck=v1&driver=d1&search=L");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({});
    expect(ids(w)).toEqual(["a", "b", "c"]);
  });
});
