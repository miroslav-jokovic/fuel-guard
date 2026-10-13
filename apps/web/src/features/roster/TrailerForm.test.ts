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

/**
 * 2026-10-12: "Not set" is the Type select's empty string, and the shared schema's type is an enum or
 * null. Sent as "", every save of a trailer with no type failed validation on a field that showed no
 * error — Save did nothing and said nothing, for a new trailer and for editing any untyped one.
 */
describe("TrailerForm saves a trailer with no type", () => {
  it("submits an untyped trailer with its type as null, not as a refusal nobody can see", async () => {
    const w = mount(TrailerForm, { props: { vehicles: [], trailer: trailer({ trailer_type: null }) } });
    await w.find("form").trigger("submit.prevent");
    const sent = w.emitted("submit")?.[0]?.[0] as { trailer_type: unknown } | undefined;
    expect(sent, "the form refused to submit").toBeTruthy();
    expect(sent!.trailer_type).toBeNull();
  });
});
