import { describe, it, expect } from "vitest";
import { vehicleInputSchema, driverInputSchema, deriveHasApu } from "./index.js";

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

  // ── idle-reduction: APU vs OEM optimized idle (migration 0048) ──────────────
  it("defaults the idle-reduction fields to null when omitted", () => {
    const r = vehicleInputSchema.parse(baseVehicle);
    expect(r.has_apu).toBeNull();
    expect(r.apu_type).toBeNull();
    expect(r.has_optimized_idle).toBeNull();
  });

  it("records APU and OEM optimized idle as INDEPENDENT flags (a Cascadia can have optimized idle, no APU)", () => {
    const r = vehicleInputSchema.parse({
      ...baseVehicle,
      has_apu: "false",
      apu_type: "none",
      has_optimized_idle: "true",
    });
    expect(r.has_apu).toBe(false);
    expect(r.apu_type).toBe("none");
    expect(r.has_optimized_idle).toBe(true);
  });

  it("accepts a valid apu_type and coerces the tri-state has_apu string", () => {
    const r = vehicleInputSchema.parse({ ...baseVehicle, has_apu: "true", apu_type: "diesel_apu" });
    expect(r.has_apu).toBe(true);
    expect(r.apu_type).toBe("diesel_apu");
  });

  it("treats empty idle-reduction strings as unset (null), not false/invalid", () => {
    const r = vehicleInputSchema.parse({ ...baseVehicle, apu_type: "", has_optimized_idle: "" });
    expect(r.apu_type).toBeNull();
    expect(r.has_optimized_idle).toBeNull();
  });

  it("rejects an unknown apu_type", () => {
    expect(
      vehicleInputSchema.safeParse({ ...baseVehicle, apu_type: "rocket_booster" }).success,
    ).toBe(false);
  });
});

describe("deriveHasApu", () => {
  it("maps real idle-reduction equipment to engine-off capable (true)", () => {
    expect(deriveHasApu("diesel_apu")).toBe(true);
    expect(deriveHasApu("battery_hvac")).toBe(true);
    expect(deriveHasApu("shore_power")).toBe(true);
    expect(deriveHasApu("fuel_heater")).toBe(true);
  });
  it("maps 'none' to false and unknown (null/undefined) to null", () => {
    expect(deriveHasApu("none")).toBe(false);
    expect(deriveHasApu(null)).toBeNull();
    expect(deriveHasApu(undefined)).toBeNull();
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
