import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TrailerForm from "@/features/roster/TrailerForm.vue";

/**
 * Q-7 (2026-09-22), the trailer half. Since E5 the roster sweep writes a McLeod-linked trailer's
 * status on every run, so the form shows it read-only rather than accept an edit that silently
 * reverts. The rule itself is `isStatusFromTms` in @silvicom/shared; this proves the form applies it.
 */
const trailer = (over: Record<string, unknown>) =>
  ({
    id: "t1", org_id: "o1", unit_number: "R532167", make: null, model: null, year: 2019, plate: null,
    trailer_type: null, cargo_capacity_gal: null, cargo_compartments: [], is_reefer: true,
    reefer_tank_capacity_gal: 50, status: "active", assigned_vehicle_id: null, samsara_asset_id: null,
    created_at: "", updated_at: "", ...over,
  }) as never;

const statusSelect = (w: ReturnType<typeof mount>) =>
  w.findAll("select").find((s) => s.findAll("option").some((o) => o.element.value === "retired"))!;

describe("TrailerForm status ownership", () => {
  it("shows a McLeod-linked trailer's status read-only, and says where it is set", () => {
    const w = mount(TrailerForm, {
      props: { vehicles: [], trailer: trailer({ mcleod_trailer_id: "532167", identity_source: "samsara" }) },
    });
    expect(statusSelect(w).attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("Set in McLeod");
  });

  it("keeps the status editable on a trailer McLeod has never linked", () => {
    const w = mount(TrailerForm, {
      props: { vehicles: [], trailer: trailer({ mcleod_trailer_id: null, identity_source: "samsara" }) },
    });
    expect(statusSelect(w).attributes("disabled")).toBeUndefined();
  });
});
