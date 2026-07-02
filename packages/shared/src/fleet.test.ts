import { describe, it, expect } from "vitest";
import { vehicleInputSchema, driverInputSchema } from "./index.js";

const baseVehicle = {
  unit_number: "T-101",
  fuel_type: "diesel" as const,
  tank_capacity_gal: 120,
  baseline_mpg: 6.4,
};

describe("vehicleInputSchema", () => {
  it("accepts a valid diesel vehicle and applies defaults", () => {
    const r = vehicleInputSchema.parse(baseVehicle);
    expect(r.status).toBe("active");
    expect(r.current_odometer).toBe(0);
  });

  it("requires a unit number", () => {
    expect(vehicleInputSchema.safeParse({ ...baseVehicle, unit_number: "" }).success).toBe(false);
  });

  it("allows diesel vehicles without baseline MPG (surfaced as a soft warning in the UI)", () => {
    const r = vehicleInputSchema.safeParse({ ...baseVehicle, baseline_mpg: undefined });
    expect(r.success).toBe(true);
  });

  it("allows electric vehicles without MPG or tank", () => {
    const r = vehicleInputSchema.safeParse({
      unit_number: "E-301",
      fuel_type: "electric",
      tank_capacity_gal: 0,
    });
    expect(r.success).toBe(true);
  });

  it("coerces numeric strings from form inputs", () => {
    const r = vehicleInputSchema.parse({
      ...baseVehicle,
      tank_capacity_gal: "120",
      baseline_mpg: "6.4",
      year: "2021",
    });
    expect(r.tank_capacity_gal).toBe(120);
    expect(r.year).toBe(2021);
  });

  it("treats empty optional strings as omitted", () => {
    const r = vehicleInputSchema.parse({ ...baseVehicle, make: "", plate: "" });
    expect(r.make).toBeUndefined();
    expect(r.plate).toBeUndefined();
  });

  it("rejects an implausible year", () => {
    expect(vehicleInputSchema.safeParse({ ...baseVehicle, year: 1700 }).success).toBe(false);
  });
});

describe("driverInputSchema", () => {
  it("accepts a valid driver", () => {
    const r = driverInputSchema.parse({ full_name: "Marcus Reyes" });
    expect(r.status).toBe("active");
  });
  it("requires a name", () => {
    expect(driverInputSchema.safeParse({ full_name: "" }).success).toBe(false);
  });
});
