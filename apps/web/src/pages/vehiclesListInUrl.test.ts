import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — a filtered list keeps its filters, sort and page in the URL.
 *
 * Vehicles opens narrowed to Active, like Trailers: the default stays out of a plain link, and "All
 * statuses" is written as `any` so that choosing it does not snap the list straight back to Active.
 */

const truck = (i: number, over: Record<string, unknown> = {}) => ({
  id: `v${i}`, unit_number: `U${String(i).padStart(3, "0")}`, make: "Freightliner", model: "Cascadia", year: 2022,
  plate: null, vin: null, fuel_type: "diesel", tank_capacity_gal: 200, baseline_mpg: 7, samsara_fuel_percent: null,
  current_odometer: 0, assigned_driver_id: null, has_apu: null, has_optimized_idle: null,
  dot_annual_inspection_expires_at: null, status: "active", mcleod_tractor_id: null, identity_source: "manual",
  samsara_missing_since: null,
  ...over,
});
const rows = [
  ...Array.from({ length: 22 }, (_, i) => truck(i + 1)),
  truck(90, { status: "retired" }),
];

// The pages read every unit's file for the File column (UNIT-FILES-PLAN UF4); none is filed here.
vi.mock("@/composables/useCompliance", () => ({ useUnitFilesQuery: () => ({ data: ref({ units: [] }) }), useDocumentsQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useVehicles", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  return {
    useVehiclesQuery: () => ({ data: ref(rows), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useCreateVehicle: idle, useUpdateVehicle: idle, useRetireVehicle: idle, useBulkUpdateVehicles: idle,
  };
});
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
// The `?check=` filter and the expiry cells read the carrier's calendar day (FLEET-MANAGER-HOME-PLAN
// D-FM9); the zone is a vue-query read, answered here so this file stays about the URL.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago"), isResolved: ref(true) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
// DataTable swaps to cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import VehiclesPage from "./VehiclesPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { TablePagination } from "@silvicom/ui";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/vehicles", component: { template: "<div/>" }, meta: { title: "Vehicles" } },
      { path: "/vehicles/:id", component: { template: "<div/>" } },
    ],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(VehiclesPage, {
    global: {
      plugins: [router, createPinia()],
      stubs: { SlideOver: true, RosterFreshnessLine: true, KebabMenu: true, VehicleSetupImport: true, VehicleForm: true },
    },
  });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const status = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Status")!;
const units = (w: Mounted) => w.findAll("tbody tr td:nth-child(2)").map((td) => td.text());

describe("Vehicles keeps its list in the URL", () => {
  it("opens on Active with nothing in the URL", async () => {
    const { w, query } = await mountAt("/vehicles");
    expect(status(w).props("modelValue")).toBe("active");
    expect(w.findComponent(TablePagination).props("total")).toBe(22);
    expect(query()).toEqual({});
  });

  it("writes All statuses as its own word, so the list does not snap back to Active", async () => {
    const { w, query } = await mountAt("/vehicles");
    status(w).vm.$emit("update:modelValue", "");
    await flushPromises();
    expect(query().status).toBe("any");
    expect(status(w).props("modelValue")).toBe("");
    expect(w.findComponent(TablePagination).props("total")).toBe(23);
  });

  it("reads filters, sort and page back from a pasted link", async () => {
    const { w } = await mountAt("/vehicles?status=retired");
    expect(w.findComponent(TablePagination).props("total")).toBe(1);

    const sorted = await mountAt("/vehicles?sort=unit_number&dir=desc&page=2");
    expect(sorted.w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "unit_number", dir: "desc" });
    expect(sorted.w.findComponent(TablePagination).props("page")).toBe(2);
    expect(units(sorted.w)[0]).toContain("U002");
  });

  it("writes a header click to the URL", async () => {
    const { w, query } = await mountAt("/vehicles");
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "current_odometer");
    await flushPromises();
    expect(query()).toEqual({ sort: "current_odometer", dir: "asc" });
  });

  it("Clear filters returns to Active and page 1, and keeps the sort", async () => {
    const { w, query } = await mountAt("/vehicles?sort=unit_number&dir=desc&page=2&status=retired&search=U0");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ sort: "unit_number", dir: "desc" });
  });

  it("reads a column from another table as the default order, not as a sort", async () => {
    const { w } = await mountAt("/vehicles?sort=declined_at");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
  });
});
