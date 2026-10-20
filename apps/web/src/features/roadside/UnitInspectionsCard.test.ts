import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import UnitInspectionsCard from "./UnitInspectionsCard.vue";

/**
 * The roadside record for one unit (UNIT-FILES-PLAN UF5): the inspections whose report names this unit
 * — by the company number or the plate the officer wrote, on a unit of this kind — from the page's own
 * whole-record read. No card for a reader without the safety section.
 */
const safety = vi.hoisted(() => ({ view: true }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ canView: (s: string) => (s === "safety" ? safety.view : true), can: () => true, role: "admin", sections: null, surfaces: null }),
}));
vi.mock("./useRoadsideInspections", () => ({
  useRoadsideInspectionsQuery: () => ({
    data: ref([
      { id: "i1", reportNumber: "R1", reportState: "IL", inspectionDate: "2026-09-12", level: 1, violations: 2, vehicleOos: 1, units: [{ seq: 1, kind: "tractor", companyNumber: "654", plate: null, plateState: null, matched: true }] },
      // Named by plate only, on a trailer of ours — a trailer's card finds it, a truck's does not.
      { id: "i2", reportNumber: "R2", reportState: "IN", inspectionDate: "2026-08-02", level: 2, violations: 0, vehicleOos: 0, units: [{ seq: 2, kind: "trailer", companyNumber: null, plate: "TR 5302", plateState: "IL", matched: true }] },
      { id: "i3", reportNumber: "R3", reportState: "IL", inspectionDate: "2026-07-01", level: 3, violations: 1, vehicleOos: 0, units: [{ seq: 1, kind: "tractor", companyNumber: "700", plate: null, plateState: null, matched: true }] },
      // A TRAILER numbered 654: the same digits as the truck, a different unit. Kind decides.
      { id: "i4", reportNumber: "R4", reportState: "WI", inspectionDate: "2026-06-15", level: 2, violations: 0, vehicleOos: 0, units: [{ seq: 2, kind: "trailer", companyNumber: "654", plate: null, plateState: null, matched: true }] },
    ]),
    isPending: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn(),
  }),
}));

const mountCard = async (props: { kind: "tractor" | "trailer"; unitNumber: string; plate?: string | null }) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/roadside-inspections/:id", component: { template: "<div/>" } }, { path: "/", component: { template: "<div/>" } }] });
  await router.push("/");
  await router.isReady();
  const w = mount(UnitInspectionsCard, { props, global: { plugins: [router] } });
  await flushPromises();
  return w;
};

describe("UnitInspectionsCard", () => {
  it("lists the inspections that name this unit, by number or by plate, on a unit of its kind", async () => {
    safety.view = true;
    const truck = await mountCard({ kind: "tractor", unitNumber: "654" });
    expect(truck.text()).toContain("09/12/2026");
    expect(truck.text()).toContain("Level 1 · Full");
    expect(truck.text()).toContain("2 violations");
    expect(truck.text()).toContain("vehicle OOS");
    expect(truck.text()).not.toContain("07/01/2026");
    // Not the trailer that shares its number.
    expect(truck.text()).not.toContain("06/15/2026");
    expect(truck.find('a[href="/roadside-inspections/i1"]').exists()).toBe(true);

    const trailer = await mountCard({ kind: "trailer", unitNumber: "5302", plate: "TR 5302" });
    expect(trailer.text()).toContain("08/02/2026");
    expect(trailer.text()).not.toContain("09/12/2026");
  });

  it("says when no report names the unit, and draws nothing for a reader without the safety section", async () => {
    safety.view = true;
    expect((await mountCard({ kind: "tractor", unitNumber: "999" })).text()).toContain("No roadside inspection names this unit.");
    safety.view = false;
    expect((await mountCard({ kind: "tractor", unitNumber: "654" })).find("[data-test=unit-inspections]").exists()).toBe(false);
  });
});
