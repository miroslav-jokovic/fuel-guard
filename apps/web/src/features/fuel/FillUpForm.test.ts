import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import FillUpForm from "@/features/fuel/FillUpForm.vue";

const vehicle = {
  id: "22222222-2222-4222-8222-222222222222",
  org_id: "o1",
  unit_number: "T-101",
  make: "Volvo",
  model: "VNL",
  year: 2022,
  plate: null,
  vin: null,
  fuel_type: "diesel" as const,
  tank_capacity_gal: 120,
  baseline_mpg: 6.4,
  current_odometer: 184000,
  status: "active" as const,
  assigned_driver_id: null,
  created_at: "",
  updated_at: "",
};

const setGallons = async (wrapper: ReturnType<typeof mount>, value: string) => {
  const decimals = wrapper.findAll('input[inputmode="decimal"]');
  // order: odometer, gallons, total_cost
  await decimals[1]!.setValue(value);
};

afterEach(() => vi.restoreAllMocks());

describe("FillUpForm", () => {
  it("emits a parsed fill-up on a valid clean submit", async () => {
    const wrapper = mount(FillUpForm, { props: { vehicles: [vehicle] } });
    const decimals = wrapper.findAll('input[inputmode="decimal"]');
    await decimals[0]!.setValue("184250"); // odometer
    await decimals[1]!.setValue("95"); // gallons
    await decimals[2]!.setValue("370"); // total cost

    await wrapper.find("form").trigger("submit.prevent");

    const emitted = wrapper.emitted("submit");
    expect(emitted).toBeTruthy();
    const payload = emitted![0]![0] as { input: { gallons: number; vehicle_id: string } };
    expect(payload.input.gallons).toBe(95);
    expect(payload.input.vehicle_id).toBe(vehicle.id);
  });

  it("hard-confirms when gallons exceed tank capacity and aborts if declined (audit M10)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(FillUpForm, { props: { vehicles: [vehicle] } });
    await setGallons(wrapper, "150"); // > 120 gal tank

    // the inline capacity warning should be visible
    expect(wrapper.text()).toContain("Exceeds tank capacity");

    await wrapper.find("form").trigger("submit.prevent");

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(wrapper.emitted("submit")).toBeUndefined(); // declined → no submit
  });

  it("submits the over-capacity fill-up when the user confirms", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(FillUpForm, { props: { vehicles: [vehicle] } });
    await setGallons(wrapper, "150");

    await wrapper.find("form").trigger("submit.prevent");

    expect(wrapper.emitted("submit")).toBeTruthy();
  });

  it("warns when the odometer is below the last reading", async () => {
    const wrapper = mount(FillUpForm, { props: { vehicles: [vehicle] } });
    const decimals = wrapper.findAll('input[inputmode="decimal"]');
    await decimals[0]!.setValue("183900"); // below current_odometer 184000
    expect(wrapper.text()).toContain("below the last recorded reading");
  });
});
