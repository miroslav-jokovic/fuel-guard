import { describe, it, expect } from "vitest";
import { odometerAccuracy, type OdoRow } from "./odometer.js";

const row = (over: Partial<OdoRow>): OdoRow => ({
  driverId: "d1",
  driverName: "Sam Diaz",
  vehicleId: "v1",
  unit: "637",
  entered: null,
  samsara: null,
  ...over,
});

describe("odometerAccuracy", () => {
  it("computes accuracy, mismatches, and deviations per driver within tolerance", () => {
    const rows: OdoRow[] = [
      row({ entered: 1000, samsara: 1002 }), // dev 2, within ±5 → accurate
      row({ entered: 2000, samsara: 2050 }), // dev 50 → mismatch
      row({ entered: 3000, samsara: null }), // not verifiable
    ];
    const [r] = odometerAccuracy(rows, "driver", 5);
    expect(r!.fills).toBe(3);
    expect(r!.checked).toBe(2);
    expect(r!.mismatches).toBe(1);
    expect(r!.accuracyPct).toBe(50);
    expect(r!.maxDeviation).toBe(50);
  });

  it("groups by vehicle and sorts worst offenders first", () => {
    const rows: OdoRow[] = [
      row({ vehicleId: "vA", unit: "A", entered: 100, samsara: 100 }),
      row({ vehicleId: "vB", unit: "B", entered: 100, samsara: 900 }),
    ];
    const out = odometerAccuracy(rows, "vehicle", 5);
    expect(out[0]!.label).toBe("B"); // most mismatches first
    expect(out[0]!.mismatches).toBe(1);
  });
});

describe("odometerAccuracy — per-vehicle calibration offset (fix #5)", () => {
  it("judges deviation against samsara + learned offset, same as the anomaly rule", () => {
    // Truck's dash reads a constant +500 vs Samsara OBD (replaced cluster). Raw comparison called
    // every fill a mismatch; offset-adjusted comparison recognizes the entries as accurate.
    const rows: OdoRow[] = [
      row({ entered: 10500, samsara: 10000, odometerOffset: 500 }), // dev 0 after offset
      row({ entered: 20502, samsara: 20000, odometerOffset: 500 }), // dev 2 after offset
      row({ entered: 30580, samsara: 30000, odometerOffset: 500 }), // dev 80 → real mismatch
    ];
    const [r] = odometerAccuracy(rows, "driver", 10);
    expect(r!.checked).toBe(3);
    expect(r!.mismatches).toBe(1);
    expect(r!.avgDeviation).toBeCloseTo((0 + 2 + 80) / 3, 1);
  });

  it("treats a missing offset as 0 (unchanged behavior)", () => {
    const [r] = odometerAccuracy([row({ entered: 1000, samsara: 1002 })], "driver", 10);
    expect(r!.mismatches).toBe(0);
  });
});
