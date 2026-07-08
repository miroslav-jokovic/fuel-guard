import { describe, it, expect } from "vitest";
import { odometerAccuracy, odometerMismatches, type OdoRow, type OdoMismatchInput } from "./odometer.js";

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

describe("odometerMismatches — per-fill listing", () => {
  const m = (over: Partial<OdoMismatchInput>): OdoMismatchInput => ({
    id: "t1",
    fueledAt: "2026-07-01T12:00:00Z",
    vehicleId: "v1",
    unit: "637",
    driverId: "d1",
    driverName: "Sam Diaz",
    entered: null,
    samsara: null,
    ...over,
  });

  it("lists only fills beyond tolerance, applies the offset, and sorts largest first", () => {
    const rep = odometerMismatches(
      [
        m({ id: "a", entered: 1002, samsara: 1000 }), // dev 2 → within ±10, excluded
        m({ id: "b", entered: 2050, samsara: 2000, fueledAt: "2026-07-02T12:00:00Z" }), // dev 50
        m({ id: "c", entered: 3200, samsara: 3000 }), // dev 200
        m({ id: "d", entered: 40500, samsara: 40000, odometerOffset: 500 }), // dev 0 after offset, excluded
        m({ id: "e", entered: 3000, samsara: null }), // not verifiable
      ],
      10,
    );
    expect(rep.checked).toBe(4); // a, b, c, d had both readings; e did not
    expect(rep.rows.map((r) => r.id)).toEqual(["c", "b"]); // 200 before 50
    expect(rep.rows[0]!.diff).toBe(200);
    expect(rep.rows[0]!.samsaraOdometerAt).toBeNull(); // passthrough default
    expect(rep.toleranceMiles).toBe(10);
  });

  it("rolls up offenders by driver, ranked by mismatch count", () => {
    const rep = odometerMismatches(
      [
        m({ id: "a", driverId: "d1", driverName: "Sam", entered: 1100, samsara: 1000 }),
        m({ id: "b", driverId: "d1", driverName: "Sam", entered: 2100, samsara: 2000 }),
        m({ id: "c", driverId: "d2", driverName: "Lee", entered: 3100, samsara: 3000 }),
      ],
      10,
    );
    expect(rep.offenders[0]!.label).toBe("Sam");
    expect(rep.offenders[0]!.mismatches).toBe(2);
  });
});
