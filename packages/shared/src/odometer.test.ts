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
