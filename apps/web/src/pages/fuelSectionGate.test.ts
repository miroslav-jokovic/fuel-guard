import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import DriverDetailPage from "@/pages/DriverDetailPage.vue";
import VehicleDetailPage from "@/pages/VehicleDetailPage.vue";

/**
 * A role without the fuel section does not read the fuel ledger from these two pages
 * (database audit 2026-10-03, finding 1; migration 0416 refuses the same read at the database).
 *
 * What can be wrong:
 *
 *  - THE PAGE QUERIED FUEL FOR EVERY ROLE THAT COULD OPEN IT. `VehicleDetailPage` is reached through the
 *    equipment section and `DriverDetailPage` through roster, and neither asked for fuel. So a technician
 *    (equipment view, fuel none) read a truck's whole fill history, and a recruiter (roster view, fuel
 *    none) read a driver's. The cases below assert the REQUEST is not sent, not only that the panel is
 *    hidden: a hidden panel over a still-sent query is the same leak with a tidier screen.
 *  - THE GATE IS "VIEW", NOT "MANAGE". `session.can` asks for manage and `session.canView` for view; the
 *    database policy this ships with is view-level, so a view-only role (dispatcher, auditor, accountant)
 *    must keep the panels. Every case that denies fuel also has a twin that allows view-only.
 *  - HIDING MUST NOT TAKE THE REST OF THE PAGE WITH IT. The driver's status badge sits in the summary card
 *    beside the fuel stats; a recruiter still has to see it.
 */
const tables: string[] = [];
let fuelAccess: "none" | "view" | "manage" = "none";

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
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      tables.push(table);
      const row = table === "vehicles" ? { id: "v-1", unit_number: "654", status: "active", fuel_type: "diesel", tank_capacity_gal: 200, current_odometer: 1, odometer_offset: 0 }
        : table === "drivers" ? { id: "d-1", full_name: "Marcus Reyes", status: "active" }
        : [];
      // `.maybeSingle()` returns a row, list reads return []; one stub serves both through the thenable.
      const p = chain(row) as Record<string, unknown>;
      return p;
    },
  },
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    can: (s: string) => (s === "fuel" ? fuelAccess === "manage" : true),
    canView: (s: string) => (s === "fuel" ? fuelAccess !== "none" : true),
  }),
}));
// The driver profile comes from the roster API, not PostgREST (`useDriverQuery`), so without this the
// summary card never renders and the "status badge stays" case would assert against an empty page.
vi.mock("@/lib/api", () => ({
  apiFetch: async () => ({ ok: true, data: { driver: { id: "d-1", full_name: "Marcus Reyes", status: "active" } }, error: null }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const STUBS = {
  QualificationSection: { template: "<div />" }, SevenDayStatementSection: { template: "<div />" },
  UnitKitCard: { template: "<div />" }, BaseChart: { template: "<div />" }, DataTable: { template: "<table />" },
};
const mountPage = async (component: unknown, path: string, route: string) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: route, component: component as never }, { path: "/recruitment/:id", component: { template: "<div />" } }] });
  await router.push(path);
  await router.isReady();
  const w = mount(component as never, { attachTo: document.body, global: { plugins: [router, VueQueryPlugin], stubs: STUBS } });
  await flushPromises();
  return w;
};
beforeEach(() => { tables.length = 0; document.body.innerHTML = ""; Element.prototype.scrollIntoView = vi.fn(); });

describe("VehicleDetailPage — fuel history follows the fuel section", () => {
  it("sends no fuel_transactions request and shows no fuel panel to a role with fuel none", async () => {
    fuelAccess = "none";
    const w = await mountPage(VehicleDetailPage, "/vehicles/v-1", "/vehicles/:id");
    expect(tables).not.toContain("fuel_transactions");
    expect(w.text()).not.toContain("MPG history");
    expect(w.text()).not.toContain("Recent fills");
    expect(w.text()).toContain("Anomalies"); // the rest of the page is still there
  });
  it("still reads and shows fuel history to a view-only role (the gate is view, not manage)", async () => {
    fuelAccess = "view";
    const w = await mountPage(VehicleDetailPage, "/vehicles/v-1", "/vehicles/:id");
    expect(tables).toContain("fuel_transactions");
    expect(w.text()).toContain("MPG history");
    expect(w.text()).toContain("Recent fills");
  });
});

describe("DriverDetailPage — fuel history follows the fuel section", () => {
  it("sends no fuel_transactions request and shows no fuel card to a role with fuel none", async () => {
    fuelAccess = "none";
    const w = await mountPage(DriverDetailPage, "/drivers/d-1", "/drivers/:id");
    expect(tables).not.toContain("fuel_transactions");
    expect(w.find("#section-fuel").exists()).toBe(false);
    expect(w.text()).not.toContain("Recent fills");
    expect(w.text()).not.toContain("MPG on this driver's fills");
  });
  it("keeps the driver's status badge when the fuel stats are withheld", async () => {
    fuelAccess = "none";
    const w = await mountPage(DriverDetailPage, "/drivers/d-1", "/drivers/:id");
    expect(w.text()).toContain("Driver summary");
    expect(w.text().toLowerCase()).toContain("active");
  });
  it("still reads and shows fuel history to a view-only role", async () => {
    fuelAccess = "view";
    const w = await mountPage(DriverDetailPage, "/drivers/d-1", "/drivers/:id");
    expect(tables).toContain("fuel_transactions");
    expect(w.find("#section-fuel").exists()).toBe(true);
    expect(w.text()).toContain("MPG on this driver's fills");
  });
});
