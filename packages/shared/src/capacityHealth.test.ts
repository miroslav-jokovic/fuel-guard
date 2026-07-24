import { describe, it, expect } from "vitest";
import { computeCapacityHealth, type CapacityVehicleRow } from "./capacityHealth.js";

const veh = (over: Partial<CapacityVehicleRow> = {}): CapacityVehicleRow => ({
  id: "v1",
  unit_number: "101",
  fuel_type: "diesel",
  tank_capacity_gal: 120,
  status: "active",
  ...over,
});

describe("computeCapacityHealth (WP5 — a dead capacity rule must be visible)", () => {
  it("all set → 100%, nothing missing", () => {
    expect(computeCapacityHealth([veh(), veh({ id: "v2", unit_number: "102" })])).toEqual({ fuelVehicles: 2, missing: [], setPct: 100 });
  });
  it("null/0 capacity on a fuel vehicle is missing (capacity rules silently dead there)", () => {
    const h = computeCapacityHealth([veh(), veh({ id: "v2", unit_number: "102", tank_capacity_gal: 0 }), veh({ id: "v3", unit_number: "099", tank_capacity_gal: null })]);
    expect(h.fuelVehicles).toBe(3);
    expect(h.missing.map((m) => m.unit)).toEqual(["099", "102"]);
    expect(h.setPct).toBeCloseTo(33.3, 1);
  });
  it("non-fuel and retired vehicles don't count against the metric", () => {
    const h = computeCapacityHealth([
      veh(),
      veh({ id: "t1", unit_number: "TR1", fuel_type: "other", tank_capacity_gal: null }), // not a fuel vehicle
      veh({ id: "r1", unit_number: "R1", tank_capacity_gal: null, status: "retired" }),
    ]);
    expect(h.fuelVehicles).toBe(1);
    expect(h.missing).toHaveLength(0);
    expect(h.setPct).toBe(100);
  });
  it("empty fleet → 100% (no false alarm on a new org)", () => {
    expect(computeCapacityHealth([]).setPct).toBe(100);
  });
});
