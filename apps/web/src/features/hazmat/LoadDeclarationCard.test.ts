import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/** D-US6 — the record's read-only load details are a FactList; an undeclared field is a dash. */
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "654" }]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: "d1", full_name: "Ann Lee" }]) }) }));
vi.mock("@/features/hazmat/useHazmatEquipment", () => ({ useHazmatTrailersQuery: () => ({ data: ref([]) }) }));
vi.mock("@/features/hazmat/useHazmatLoads", () => ({
  useUpdateLoad: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
const LoadDeclarationCard = (await import("./LoadDeclarationCard.vue")).default;

const load = (extra: Record<string, unknown> = {}) =>
  ({
    id: "l1", status: "draft", vehicle_id: "v1", trailer_id: null, driver_id: "d1", tank_state: "loaded",
    carrier_relationship: "private_carrier", planned_pickup_at: null, special_permit_numbers: [],
    claimed_no_placards: false, ...extra,
  }) as never;

beforeEach(() => setActivePinia(createPinia()));

describe("the load details card", () => {
  it("pairs each declared field with its value, and dashes what nobody declared", () => {
    const w = mount(LoadDeclarationCard, { props: { load: load(), canManage: false } });
    expect(w.findAll("dt").map((d) => d.text())).toEqual([
      "Truck", "Trailer", "Driver", "Planned pickup", "Tank state", "Who placards this vehicle", "Special permits",
    ]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual([
      "654", "—", "Ann Lee", "—", "Loaded", "Private carrier — our own freight", "—",
    ]);
  });

  it("adds the shipper's no-placard claim only when the paper makes it", () => {
    const w = mount(LoadDeclarationCard, { props: { load: load({ claimed_no_placards: true }), canManage: false } });
    expect(w.findAll("dt").at(-1)!.text()).toBe("Shipper's claim");
  });
});
