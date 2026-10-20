import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * TRAILER-LINK-PLAN TL4 (D-TL1): the Trailers page shows which truck a trailer is on from both sources,
 * labelled — the load McLeod put it on, and the truck the GPS last saw it with, with how old that is.
 * On 2026-10-19 they disagreed on 72 of 114 trucks, so a page that showed one would mislead half the time.
 */
const trailer = { id: "t1", unit_number: "R-501", make: "Utility", model: "3000R", year: null, plate: null, trailer_type: "reefer", is_reefer: true,
  reefer_tank_capacity_gal: 50, assigned_vehicle_id: "v-gps", pairing_source: "inferred", pairing_confirmed_at: "2026-08-04T16:06:27Z",
  dot_annual_inspection_expires_at: null, status: "active", mcleod_trailer_id: "R-501", identity_source: "mcleod" };

// The pages read every unit's file for the File column (UNIT-FILES-PLAN UF4); none is filed here.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago"), isResolved: ref(true) }) }));
vi.mock("@/composables/useCompliance", () => ({ useUnitFilesQuery: () => ({ data: ref({ units: [] }) }), useDocumentsQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useTrailerLink", () => ({
  useTrailersOnLoadsQuery: () => ({ byTrailerId: { value: new Map([["t1", { trailerId: "t1", vehicleId: "v-load", loadId: "l1", ref: "291013" }]]) } }),
}));
vi.mock("@/composables/useTrailers", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  return {
    useTrailersQuery: () => ({ data: ref([trailer]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
    useCreateTrailer: idle, useUpdateTrailer: idle, useRetireTrailer: idle, useBulkUpdateTrailers: idle,
  };
});
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v-load", unit_number: "512" }, { id: "v-gps", unit_number: "718" }]) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import TrailersPage from "./TrailersPage.vue";

describe("the Trailers page names a trailer's truck from both sources", () => {
  it("shows the McLeod load's truck and the GPS pairing's truck side by side, with the pairing's age", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/trailers", component: { template: "<div/>" }, meta: { title: "Trailers" } }] });
    await router.push("/trailers");
    await router.isReady();
    const w = mount(TrailersPage, { global: { plugins: [router, createPinia()], stubs: { SlideOver: true, RosterFreshnessLine: true, KebabMenu: true } } });
    await flushPromises();
    const heads = w.findAll("thead th").map((th) => th.text());
    expect(heads).toEqual(expect.arrayContaining(["On load (McLeod)", "GPS pairing"]));
    const row = w.find("tbody tr").text();
    expect(row).toContain("512");
    expect(row).toContain("Load 291013");
    expect(row).toContain("718");
    expect(row).toContain("GPS, as of 08/04/2026");
  });
});

/** UNIT-FILES-PLAN UF5b: a trailer has a page now, and its unit number on the list is the door to it. */
describe("the Trailers page opens a trailer's own page", () => {
  it("links the unit number to /trailers/:id", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/trailers", component: { template: "<div/>" }, meta: { title: "Trailers" } }, { path: "/trailers/:id", component: { template: "<div/>" } }],
    });
    await router.push("/trailers");
    await router.isReady();
    const w = mount(TrailersPage, { global: { plugins: [router, createPinia()], stubs: { SlideOver: true, RosterFreshnessLine: true, KebabMenu: true } } });
    await flushPromises();
    const link = w.find('tbody tr a[href="/trailers/t1"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe("R-501");
  });
});
