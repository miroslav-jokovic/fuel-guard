import { describe, it, expect } from "vitest";
import { learnIdleBurn, estimateIdleGallons } from "./idleBurn.js";
import { aggregateDriverIdle, topAvoidableIdles, type IdleRow, type LongIdleInput } from "./idleScoring.js";

describe("learnIdleBurn", () => {
  it("learns a per-truck rate only with enough measured evidence, and a fleet fallback", () => {
    const r = learnIdleBurn([
      { vehicleId: "A", durationSec: 3600, fuelGal: 1.0 }, // A: 3 events, 3 h, 3 gal → 1.0/h
      { vehicleId: "A", durationSec: 3600, fuelGal: 1.0 },
      { vehicleId: "A", durationSec: 3600, fuelGal: 1.0 },
      { vehicleId: "B", durationSec: 3600, fuelGal: 0.9 }, // B: only 1 event → no per-truck rate
      { vehicleId: "C", durationSec: 1800, fuelGal: null }, // unmeasured → ignored
    ]);
    expect(r.perVehicle.A).toBe(1.0);
    expect(r.perVehicle.B).toBeUndefined();
    expect(r.fleet).toBeGreaterThan(0);
  });

  it("clamps implausible rates into the DOE band", () => {
    const r = learnIdleBurn([
      { vehicleId: "X", durationSec: 3600, fuelGal: 9 }, // 9 gal/h → clamp to 2.0
      { vehicleId: "X", durationSec: 3600, fuelGal: 9 },
      { vehicleId: "X", durationSec: 3600, fuelGal: 9 },
    ]);
    expect(r.perVehicle.X).toBe(2.0);
  });

  it("returns null fleet rate when there is nothing measured", () => {
    expect(learnIdleBurn([{ vehicleId: "A", durationSec: 3600, fuelGal: null }]).fleet).toBeNull();
  });
});

describe("estimateIdleGallons", () => {
  const learned = { perVehicle: { A: 1.2 }, fleet: 0.9 };
  it("passes measured fuel through untouched", () => {
    const g = estimateIdleGallons({ vehicleId: "A", durationSec: 3600, fuelGal: 0.75, airTempF: 70 }, { learned });
    expect(g.source).toBe("measured");
    expect(g.gallons).toBe(0.75);
  });
  it("uses the per-truck rate when available", () => {
    const g = estimateIdleGallons({ vehicleId: "A", durationSec: 3600, fuelGal: null, airTempF: 70 }, { learned });
    expect(g.source).toBe("per_truck");
    expect(g.gallons).toBe(1.2);
  });
  it("falls back to the fleet rate, then the default", () => {
    expect(estimateIdleGallons({ vehicleId: "Z", durationSec: 3600, fuelGal: null, airTempF: 70 }, { learned }).source).toBe("fleet");
    expect(estimateIdleGallons({ vehicleId: "Z", durationSec: 3600, fuelGal: null, airTempF: 70 }, { learned: { perVehicle: {}, fleet: null } }).source).toBe("default");
  });
  it("nudges the estimate up in extreme weather", () => {
    const mild = estimateIdleGallons({ vehicleId: "Z", durationSec: 3600, fuelGal: null, airTempF: 70 }, { learned: { perVehicle: {}, fleet: null }, defaultGalPerHour: 0.8 });
    const hot = estimateIdleGallons({ vehicleId: "Z", durationSec: 3600, fuelGal: null, airTempF: 100 }, { learned: { perVehicle: {}, fleet: null }, defaultGalPerHour: 0.8 });
    expect(hot.gallons).toBeGreaterThan(mild.gallons);
  });
});

describe("idleGal is preferred for gallon totals", () => {
  it("aggregateDriverIdle uses row.idleGal for the discretionary gallons", () => {
    const rows: IdleRow[] = [
      { driverId: "d1", driverName: "A", durationSec: 3600, classification: "discretionary", fuelGal: null, idleGal: 1.5, costUsd: 6 },
    ];
    const s = aggregateDriverIdle(rows);
    expect(s.fleetDiscretionaryGal).toBe(1.5);
  });
  it("topAvoidableIdles uses idleGal for its gallons/cost basis", () => {
    const rows: LongIdleInput[] = [
      { driverName: "A", unitNumber: "1", startedAt: "2026-07-08T04:00:00Z", durationSec: 36000, classification: "discretionary", costUsd: null, fuelGal: null, idleGal: 5, hasApu: true, idleCapability: "apu" },
    ];
    const out = topAvoidableIdles(rows, { fuelPricePerGal: 4 });
    expect(out[0]!.costUsd).toBe(20); // 5 gal * $4
  });
});
