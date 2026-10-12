import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — a filtered list keeps its filters, sort and page in the URL.
 *
 * Trailers is the reference conversion, and the case it pins that a list opening on "every row" does
 * not have: the list OPENS NARROWED to Active. That default stays out of the URL, so a plain link
 * opens the list the way everybody expects — and "All statuses" therefore needs a word of its own,
 * or picking it would write nothing and the list would snap straight back to Active.
 */

const trailer = (i: number, over: Record<string, unknown> = {}) => ({
  id: `t${i}`, unit_number: `T${String(i).padStart(3, "0")}`, make: "Utility", model: "3000R", plate: null,
  trailer_type: "reefer", is_reefer: true, reefer_tank_capacity_gal: 50, assigned_vehicle_id: null,
  dot_annual_inspection_expires_at: null, status: "active", mcleod_trailer_id: null, identity_source: "manual",
  ...over,
});
const rows = [
  ...Array.from({ length: 22 }, (_, i) => trailer(i + 1)),
  trailer(90, { status: "retired", is_reefer: false, trailer_type: "dry_van" }),
];

vi.mock("@/composables/useTrailers", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  return {
    useTrailersQuery: () => ({ data: ref(rows), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useCreateTrailer: idle, useUpdateTrailer: idle, useRetireTrailer: idle, useBulkUpdateTrailers: idle,
  };
});
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
// DataTable swaps to cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import TrailersPage from "./TrailersPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/trailers", component: { template: "<div/>" }, meta: { title: "Trailers" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(TrailersPage, {
    global: { plugins: [router, createPinia()], stubs: { SlideOver: true, RosterFreshnessLine: true, KebabMenu: true } },
  });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const status = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Status")!;
const units = (w: Mounted) => w.findAll("tbody tr td:nth-child(2)").map((td) => td.text());

describe("Trailers keeps its list in the URL", () => {
  it("opens on Active with nothing in the URL", async () => {
    const { w, query } = await mountAt("/trailers");
    expect(status(w).props("modelValue")).toBe("active");
    expect(query()).toEqual({});
  });

  it("writes All statuses as its own word, so the list does not snap back to Active", async () => {
    const { w, query } = await mountAt("/trailers");
    status(w).vm.$emit("update:modelValue", "");
    await flushPromises();
    expect(query().status).toBe("any");
    expect(status(w).props("modelValue")).toBe("");
    expect(w.findComponent({ name: "TablePagination" }).props("total")).toBe(23);
  });

  it("reads filters, sort and page back from a pasted link", async () => {
    const { w } = await mountAt("/trailers?status=retired");
    expect(w.findComponent({ name: "TablePagination" }).props("total")).toBe(1);

    const sorted = await mountAt("/trailers?sort=unit_number&dir=desc&page=2");
    expect(sorted.w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "unit_number", dir: "desc" });
    expect(sorted.w.findComponent({ name: "TablePagination" }).props("page")).toBe(2);
    expect(units(sorted.w)[0]).toBe("T002");
  });

  it("returns to page 1 when a filter changes, and Clear filters keeps the sort", async () => {
    const { w, query } = await mountAt("/trailers?sort=unit_number&dir=desc&page=2&reefer=reefer");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ sort: "unit_number", dir: "desc" });
  });

  it("reads a column from another table as the default order, not as a sort", async () => {
    const { w } = await mountAt("/trailers?sort=declined_at");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
  });
});
