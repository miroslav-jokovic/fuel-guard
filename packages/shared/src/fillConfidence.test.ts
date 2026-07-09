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

  it("fill-size is descriptive only — it does NOT gate anything in Phase 1", () => {
    const tooSmall: FillConfidence = { tankSensor: "reliable", odoSource: "obd", fillSize: "too_small" };
    for (const id of tankRules) expect(ruleEligible(id, tooSmall)).toBe(true);
  });
});
