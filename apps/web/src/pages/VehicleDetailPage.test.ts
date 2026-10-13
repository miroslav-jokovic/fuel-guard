import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import VehicleDetailPage from "@/pages/VehicleDetailPage.vue";

/**
 * The truck page's summary card (D-US6). Before `FactList` it printed " gal" for a truck with no tank
 * on file — a unit glued to nothing. The fuel-section gate on this page has its own suite
 * (`fuelSectionGate.test.ts`).
 */
const vehicle = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
}));
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
  supabase: { from: (table: string) => chain(table === "vehicles" ? vehicle.row : []) },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));

const STUBS = { UnitKitCard: true, BaseChart: true, DataTable: true };
const mountPage = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles/:id", component: VehicleDetailPage }] });
  await router.push("/vehicles/v-1");
  await router.isReady();
  const w = mount(VehicleDetailPage, { global: { plugins: [router, VueQueryPlugin], stubs: STUBS } });
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
