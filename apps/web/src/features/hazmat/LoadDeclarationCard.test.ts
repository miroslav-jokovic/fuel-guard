import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/** D-US6 — the record's read-only load details are a FactList; an undeclared field is a dash. */
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "654" }]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: "d1", full_name: "Ann Lee" }]) }) }));
// Two trailers: one with no equipment type and no tank data on file, one typed (TC1.4).
const TRAILERS = [
  { id: "t-untyped", unit_number: "T-9", trailer_type: null, cargo_capacity_gal: null, cargo_compartments: null },
  { id: "t-van", unit_number: "T-1", trailer_type: "dry_van", cargo_capacity_gal: null, cargo_compartments: null },
];
vi.mock("@/features/hazmat/useHazmatEquipment", () => ({ useHazmatTrailersQuery: () => ({ data: ref(TRAILERS) }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
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

describe("the equipment question (TWO-CLICK-READER-PLAN TC1.4, Q-TC4 (b))", () => {
  const mountWith = (trailerId: string | null) =>
    mount(LoadDeclarationCard, { props: { load: load({ trailer_id: trailerId }), canManage: false }, global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } } });

  it("asks before submit when the trailer has no equipment type, and says the analysis will not guess", () => {
    const text = mountWith("t-untyped").text();
    expect(text).toContain("Trailer T-9 has no equipment type, so the analysis will stop rather than guess");
    expect(text).toContain("Trailers page");
  });

  it("asks nothing for a typed trailer, or when no trailer is chosen", () => {
    expect(mountWith("t-van").text()).not.toContain("no equipment type");
    expect(mountWith(null).text()).not.toContain("no equipment type");
  });
});
