import { describe, it, expect } from "vitest";
import { computeFillConfidence, ruleEligible, type FillConfidence } from "./fillConfidence.js";
import type { RuleContext, RuleId, TxnView, VehicleView } from "./index.js";

const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 120, baselineMpg: 6.4 };
const txn: TxnView = {
  id: "t", vehicleId: "v1", driverId: "d1", fueledAt: "2026-06-10T17:00:00Z",
  odometer: 100000, gallons: 90, pricePerGal: 3.9, totalCost: 351,
};
const base = (over: Partial<RuleContext> = {}): RuleContext =>
  ({ txn, vehicle, previousTxn: null, recentTxns: [], thresholds: {} as never, operatingHours: {} as never, ...over });

describe("computeFillConfidence", () => {
  it("marks the tank sensor reliable only when tankSensorReliable === true", () => {
    expect(computeFillConfidence(base()).tankSensor).toBe("unreliable"); // undefined → unreliable
    expect(computeFillConfidence(base({ vehicle: { ...vehicle, tankSensorReliable: false } })).tankSensor).toBe("unreliable");
    expect(computeFillConfidence(base({ vehicle: { ...vehicle, tankSensorReliable: true } })).tankSensor).toBe("reliable");
  });

  it("classifies the cross-source odometer provenance (obd / other / null)", () => {
    expect(computeFillConfidence(base()).odoSource).toBeNull(); // no source recorded
    expect(computeFillConfidence(base({ crossSourceOdometerSource: "obd" })).odoSource).toBe("obd");
    expect(computeFillConfidence(base({ crossSourceOdometerSource: "gps" })).odoSource).toBe("other");
    expect(computeFillConfidence(base({ crossSourceOdometerSource: "reconstructed" })).odoSource).toBe("other");
  });

  it("computes a descriptive fill-size against max(15 gal, 8% capacity)", () => {
    expect(computeFillConfidence(base()).fillSize).toBe("measurable"); // 90 gal ≥ max(15, 9.6)
    expect(computeFillConfidence(base({ txn: { ...txn, gallons: 8 } })).fillSize).toBe("too_small");
    expect(computeFillConfidence(base({ vehicle: { ...vehicle, tankCapacityGal: 0 } })).fillSize).toBe("unknown");
  });

  /**
   * Audit 2026-08-09 finding A — the capacity SOURCE mismatch. The measurable-fill floor is 8% of the
   * truck's tank, so it has to read the same capacity the capacity RULES read (`resolveCapacity`:
   * sensor-measured physics > entered nameplate > billed history). Reading the raw `tankCapacityGal`
   * sized the floor off a number a human typed, on exactly the trucks the resolver exists to rescue.
   */
  it("sizes the measurable-fill floor from the RESOLVED capacity, not the entered nameplate", () => {
    // A true 240-gal truck whose nameplate was mis-entered as 120. Floor = 8% of 240 = 19.2 gal, so a
    // 16-gal splash is sensor noise. Off the nameplate the floor was 8% of 120 = 9.6 → clamped up to the
    // 15-gal absolute minimum, and the splash read as "measurable" — a rise inside the sensor's own
    // noise band, handed to tank_fill_short / tank_space_exceeded / mpg_deviation as signal.
    const misEntered: VehicleView = { ...vehicle, tankCapacityGal: 120, sensorCapacityGal: 240, sensorCapacitySamples: 9 };
    expect(computeFillConfidence(base({ vehicle: misEntered, txn: { ...txn, gallons: 16 } })).fillSize).toBe("too_small");
    expect(computeFillConfidence(base({ vehicle: misEntered, txn: { ...txn, gallons: 90 } })).fillSize).toBe("measurable");
  });

  it("knows a fill's size on a truck with NO entered capacity but a sensor-measured one", () => {
    // No nameplate + a physics measurement: this read as "unknown" (which does not gate) even though the
    // true tank size was knowable. Floor = 8% of 200 = 16 gal.
    const sensorOnly: VehicleView = { ...vehicle, tankCapacityGal: 0, sensorCapacityGal: 200, sensorCapacitySamples: 9 };
    expect(computeFillConfidence(base({ vehicle: sensorOnly, txn: { ...txn, gallons: 12 } })).fillSize).toBe("too_small");
    expect(computeFillConfidence(base({ vehicle: sensorOnly, txn: { ...txn, gallons: 90 } })).fillSize).toBe("measurable");
  });
});

describe("ruleEligible — reproduces the previous inline guards exactly", () => {
  const reliable: FillConfidence = { tankSensor: "reliable", odoSource: "obd", fillSize: "measurable" };
  const unreliable: FillConfidence = { tankSensor: "unreliable", odoSource: "obd", fillSize: "measurable" };
  const tankRules: RuleId[] = ["tank_space_exceeded", "implausible_topoff", "tank_fill_short", "mpg_deviation", "mpg_sustained_decline"];

  it("gates per-fill tank/volume/consumption rules on a reliable sensor", () => {
    for (const id of tankRules) {
      expect(ruleEligible(id, reliable)).toBe(true);
      expect(ruleEligible(id, unreliable)).toBe(false);
    }
  });

  it("gates odometer_mismatch to OBD or absent source (never a GPS/reconstructed reading)", () => {
    expect(ruleEligible("odometer_mismatch", { tankSensor: "unreliable", odoSource: "obd", fillSize: "unknown" })).toBe(true);
    expect(ruleEligible("odometer_mismatch", { tankSensor: "unreliable", odoSource: null, fillSize: "unknown" })).toBe(true);
    expect(ruleEligible("odometer_mismatch", { tankSensor: "unreliable", odoSource: "other", fillSize: "unknown" })).toBe(false);
  });

  it("leaves unrelated rules always eligible", () => {
    for (const id of ["exceeds_tank_capacity", "cumulative_overfuel", "location_mismatch", "off_hours_fueling"] as RuleId[]) {
      expect(ruleEligible(id, unreliable)).toBe(true);
    }
  });

  it("a too-small fill makes the per-fill sensor-measurement rules ineligible (audit A2.4)", () => {
    const tooSmall: FillConfidence = { tankSensor: "reliable", odoSource: "obd", fillSize: "too_small" };
    // Sensor-measurement rules: a fill too small to read against a coarse sensor → ineligible.
    for (const id of ["tank_space_exceeded", "tank_fill_short", "mpg_deviation"] as RuleId[]) {
      expect(ruleEligible(id, tooSmall)).toBe(false);
    }
    // Consumption/trend rules are NOT gated on fill size (a small fill can't over-topoff; decline spans fills).
    for (const id of ["implausible_topoff", "mpg_sustained_decline"] as RuleId[]) {
      expect(ruleEligible(id, tooSmall)).toBe(true);
    }
  });

  it("an unknown fill-size does NOT gate — only a demonstrably too-small fill does", () => {
    const unknown: FillConfidence = { tankSensor: "reliable", odoSource: "obd", fillSize: "unknown" };
    for (const id of tankRules) expect(ruleEligible(id, unknown)).toBe(true);
  });
});
