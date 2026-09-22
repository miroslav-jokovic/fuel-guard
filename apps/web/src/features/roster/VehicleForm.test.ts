import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VehicleForm from "@/features/roster/VehicleForm.vue";

const drivers = [
  {
    id: "d1",
    org_id: "o1",
    user_id: null,
    full_name: "Marcus Reyes",
    employee_id: null,
    phone: null,
    status: "active" as const,
    samsara_driver_id: null,
    samsara_username: null,
    current_hos_status: null,
    current_hos_vehicle: null,
    current_hos_at: null,
    current_location: null,
    app_username: null,
    app_access_enabled: null,
    created_at: "",
    updated_at: "",
    archived_at: null,
  },
];

describe("VehicleForm", () => {
  it("blocks submit and shows an error when tank capacity is missing for a fuel vehicle", async () => {
    // Baseline MPG is intentionally OPTIONAL on the form (the VehiclesPage surfaces missing MPG as a
    // 'setup needed' warning); the remaining hard requirement for a fuel vehicle is a positive tank capacity.
    const wrapper = mount(VehicleForm, { props: { drivers } });
    await wrapper.find("input").setValue("T-200"); // unit_number; leave tank capacity empty (→ 0)

    await wrapper.find("form").trigger("submit.prevent");

    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(wrapper.text()).toContain("Tank capacity must be greater than 0");
  });

  it("allows submit for a diesel with a tank capacity but no baseline MPG (baseline is optional)", async () => {
    const wrapper = mount(VehicleForm, { props: { drivers } });
    await wrapper.find("input").setValue("T-201");
    await wrapper.findAll('input[inputmode="decimal"]')[0]!.setValue("120"); // tank only
    await wrapper.find("form").trigger("submit.prevent");

    const emitted = wrapper.emitted("submit");
    expect(emitted).toBeTruthy();
    const payload = emitted![0]![0] as { baseline_mpg?: number };
    expect(payload.baseline_mpg).toBeUndefined();
  });

  it("emits a parsed VehicleInput on a valid diesel submit", async () => {
    const wrapper = mount(VehicleForm, { props: { drivers } });
    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("T-200"); // unit_number
    // tank capacity + baseline mpg are the two decimal inputs (in order: tank, baseline)
    const decimals = wrapper.findAll('input[inputmode="decimal"]');
    await decimals[0]!.setValue("120"); // tank
    await decimals[1]!.setValue("6.4"); // baseline mpg

    await wrapper.find("form").trigger("submit.prevent");

    const emitted = wrapper.emitted("submit");
    expect(emitted).toBeTruthy();
    const payload = emitted![0]![0] as {
      unit_number: string;
      tank_capacity_gal: number;
      baseline_mpg?: number;
    };
    expect(payload.unit_number).toBe("T-200");
    expect(payload.tank_capacity_gal).toBe(120);
    expect(payload.baseline_mpg).toBe(6.4);
  });

  /**
   * Q-7 (2026-09-22). Once McLeod links a truck, the roster sweep writes its status on every run, so
   * an office edit would stick for an hour and silently revert. The field is shown read-only with its
   * source named; a row the office has claimed, or McLeod has never linked, stays editable.
   */
  const vehicle = (over: Record<string, unknown>) =>
    ({
      id: "v1", org_id: "o1", unit_number: "552", make: null, model: null, year: 2019, plate: null,
      vin: null, fuel_type: "diesel", tank_capacity_gal: 200, baseline_mpg: null, current_odometer: 0,
      status: "maintenance", assigned_driver_id: null, samsara_vehicle_id: null,
      samsara_fuel_percent: null, samsara_fuel_at: null, created_at: "", updated_at: "", ...over,
    }) as never;
  const statusSelect = (w: ReturnType<typeof mount>) =>
    w.findAll("select").find((s) => s.findAll("option").some((o) => o.element.value === "maintenance"))!;

  it("shows a McLeod-linked truck's status read-only, and says where it is set", () => {
    const w = mount(VehicleForm, {
      props: { drivers, vehicle: vehicle({ mcleod_tractor_id: "552", identity_source: "samsara" }) },
    });
    expect(statusSelect(w).attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("Set in McLeod");
  });

  it("keeps the status editable on a row the office has claimed", () => {
    const w = mount(VehicleForm, {
      props: { drivers, vehicle: vehicle({ mcleod_tractor_id: "552", identity_source: "manual" }) },
    });
    expect(statusSelect(w).attributes("disabled")).toBeUndefined();
    expect(w.text()).not.toContain("Set in McLeod");
  });

  it("keeps the status editable on a truck McLeod has never linked", () => {
    const w = mount(VehicleForm, { props: { drivers, vehicle: vehicle({ mcleod_tractor_id: null, identity_source: "samsara" }) } });
    expect(statusSelect(w).attributes("disabled")).toBeUndefined();
  });
});
