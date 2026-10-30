import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import VehicleDetailPage from "@/pages/VehicleDetailPage.vue";

/**
 * The truck page's summary card (D-US6). Before `FactList` it printed " gal" for a truck with no tank
 * on file — a unit glued to nothing. The fuel-section gate on this page has its own suite
 * (`fuelSectionGate.test.ts`).
 */
const vehicle = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  /** F9: the tables whose read is refused. */
  failing: new Set<string>(),
}));
const chain = (result: unknown, failed = false) => {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === "then")
        return (resolve: (v: unknown) => void) =>
          resolve(failed ? { data: null, error: { message: "permission denied" } } : { data: result, error: null });
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
};
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => chain(table === "vehicles" ? vehicle.row : [], vehicle.failing.has(table)) },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));

// The file and maintenance sections (UF5) have reads and stores of their own and their own suites;
// this file pins the summary card and the fuel panels.
const STUBS = { HolderEquipmentCard: true, UnitFileSection: true, UnitWorkOrdersCard: true, UnitInspectionsCard: true, BaseChart: true, DataTable: true };
const mountPage = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles/:id", component: VehicleDetailPage }] });
  await router.push("/vehicles/v-1");
  await router.isReady();
  // No retries: a refused read is a failure on its first answer.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(VehicleDetailPage, { global: { plugins: [router, [VueQueryPlugin, { queryClient }]], stubs: STUBS } });
  await flushPromises();
  return w;
};
const pairs = (w: Awaited<ReturnType<typeof mountPage>>) =>
  Object.fromEntries(w.get("dl").findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()]));

describe("VehicleDetailPage — the summary's facts", () => {
  it("pairs each fact with its label, the tank with its unit", async () => {
    vehicle.row = { id: "v-1", unit_number: "654", status: "active", fuel_type: "diesel", tank_capacity_gal: 200, baseline_mpg: 6.8, current_odometer: 412000, odometer_offset: 0 };
    expect(pairs(await mountPage())).toEqual({ Tank: "200 gal", "Baseline MPG": "6.8", Odometer: "412000", "Open anomalies": "0" });
  });

  it("draws a dash for a truck with no tank or baseline on file, never a bare unit", async () => {
    vehicle.row = { id: "v-1", unit_number: "654", status: "active", fuel_type: "diesel", tank_capacity_gal: null, baseline_mpg: null, current_odometer: 1, odometer_offset: 0 };
    const facts = pairs(await mountPage());
    expect(facts.Tank).toBe("—");
    expect(facts["Baseline MPG"]).toBe("—");
  });
});

/**
 * F9 (US6b): the page's reads used to drop supabase's `error`, so a refused read was an empty answer —
 * "Not enough data to chart MPG yet", "No fills yet", "No anomalies". Each panel now says its read
 * failed and offers a Retry.
 */
describe("VehicleDetailPage — a failed read is not an empty truck", () => {
  const ROW = { id: "v-1", unit_number: "654", status: "active", fuel_type: "diesel", tank_capacity_gal: 200, baseline_mpg: 6.8, current_odometer: 1, odometer_offset: 0 };
  beforeEach(() => {
    vehicle.row = ROW;
    vehicle.failing = new Set();
  });

  it("says the fills could not be loaded, in the chart and the table", async () => {
    vehicle.failing = new Set(["fuel_transactions"]);
    const w = await mountPage();
    expect(w.text()).toContain("Could not load the fills.");
    expect(w.text()).not.toContain("Not enough data to chart MPG yet");
    expect(w.findComponent({ name: "DataTable" }).attributes("error")).toBe("Could not load the fills.");
  });

  it("says the anomalies could not be loaded, and counts none open as a dash", async () => {
    vehicle.failing = new Set(["anomalies"]);
    const w = await mountPage();
    expect(w.text()).toContain("Could not load the anomalies.");
    expect(w.text()).not.toContain("No anomalies.");
    expect(pairs(w)["Open anomalies"]).toBe("—");
  });

  it("says the vehicle could not be loaded, with a Retry", async () => {
    vehicle.failing = new Set(["vehicles"]);
    const w = await mountPage();
    expect(w.text()).toContain("Could not load this vehicle.");
    expect(w.findAll("button").some((b) => b.text() === "Retry")).toBe(true);
  });
});
