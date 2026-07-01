import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VehicleForm from "@/features/fleet/VehicleForm.vue";

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
    created_at: "",
    updated_at: "",
  },
];

describe("VehicleForm", () => {
  it("blocks submit and shows an error when baseline MPG is missing for diesel (audit H3)", async () => {
    const wrapper = mount(VehicleForm, { props: { drivers } });
    await wrapper.find('input').setValue("T-200"); // unit_number (first input)
    // set tank capacity, leave baseline_mpg empty
    const inputs = wrapper.findAll("input");
    // tank capacity is the input with inputmode decimal labelled Tank capacity
    const tank = wrapper
      .findAll("input")
      .find((i) => (i.element.getAttribute("inputmode") === "decimal"));
    await tank!.setValue("120");

    await wrapper.find("form").trigger("submit.prevent");

    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(wrapper.text()).toContain("Baseline MPG is required");
    expect(inputs.length).toBeGreaterThan(0);
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
    const payload = emitted![0]![0] as { unit_number: string; tank_capacity_gal: number; baseline_mpg?: number };
    expect(payload.unit_number).toBe("T-200");
    expect(payload.tank_capacity_gal).toBe(120);
    expect(payload.baseline_mpg).toBe(6.4);
  });
});
