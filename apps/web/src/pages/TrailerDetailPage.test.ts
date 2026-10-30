import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";
import TrailerDetailPage from "@/pages/TrailerDetailPage.vue";
import { TRAILER_SECTIONS, resolveTrailerSection } from "@/pages/trailerSections";

/**
 * The trailer's own page (UNIT-FILES-PLAN UF5b): the summary's facts with their labels and units, the
 * GPS pairing with its age, and the three sections — the truck page's without Fuel, so `?section=fuel`
 * on a trailer lands on the overview rather than an anchor that is not there.
 */
const trailer = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
const chain = (result: unknown) => {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: result, error: null });
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
};
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => chain(table === "trailers" ? trailer.row : []) } }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v-1", unit_number: "654" }]) }) }));

const STUBS = { HolderEquipmentCard: true, UnitFileSection: true, UnitWorkOrdersCard: true, UnitInspectionsCard: true };
const mountPage = async (path = "/trailers/t-1") => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/trailers/:id", component: TrailerDetailPage }] });
  await router.push(path);
  await router.isReady();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(TrailerDetailPage, { global: { plugins: [router, [VueQueryPlugin, { queryClient }]], stubs: STUBS } });
  await flushPromises();
  return w;
};
const pairs = (w: Awaited<ReturnType<typeof mountPage>>) =>
  Object.fromEntries(w.get("dl").findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()]));

describe("TrailerDetailPage", () => {
  beforeEach(() => {
    trailer.row = {
      id: "t-1", unit_number: "5302", status: "active", trailer_type: "reefer", plate: "TR 5302", is_reefer: true,
      reefer_tank_capacity_gal: 50, cargo_capacity_gal: null, assigned_vehicle_id: "v-1", pairing_source: null,
      pairing_confirmed_at: "2026-10-19T12:00:00Z", make: "Utility", model: "3000R", year: 2022,
    };
  });

  it("pairs each fact with its label, and names the GPS-paired truck with the pairing's age", async () => {
    const w = await mountPage();
    expect(w.text()).toContain("Trailer 5302");
    expect(pairs(w)).toMatchObject({ Plate: "TR 5302", Reefer: "Yes · 50 gal tank", "GPS pairing": "Unit 654 (GPS, as of 10/19/2026)" });
    expect(pairs(w)["Cargo capacity"]).toBe("—");
  });

  it("offers Overview, File and Maintenance — the truck's sections without Fuel", async () => {
    const w = await mountPage("/trailers/t-1?section=file");
    expect(TRAILER_SECTIONS.map((s) => s.value)).toEqual(["overview", "file", "maintenance"]);
    expect(resolveTrailerSection("fuel")).toBe("overview");
    expect(w.find("#section-file").exists()).toBe(true);
    expect(w.find("#section-maintenance").exists()).toBe(true);
    expect(w.find("#section-fuel").exists()).toBe(false);
    expect(w.findComponent({ name: "UnitFileSection" }).props("subject")).toEqual({ type: "trailer", id: "t-1" });
  });
});
