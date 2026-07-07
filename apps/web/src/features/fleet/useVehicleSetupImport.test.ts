import { describe, it, expect } from "vitest";
import type { Vehicle } from "@fuelguard/shared";
import { rowsToCsvText, analyzeVehicleImport } from "./useVehicleSetupImport";

const HEADERS = ["unit_number", "fuel_type", "make", "tank_capacity_gal", "baseline_mpg"];

describe("rowsToCsvText", () => {
  it("serializes rows and quotes cells containing commas, quotes, or newlines", () => {
    const csv = rowsToCsvText(["a", "b"], [{ a: "x,y", b: 'he said "hi"' }, { a: "1", b: null }]);
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n1,');
  });
});

// These simulate what the shared reader returns from an .xlsx (headers + row objects), proving the
// Vehicles importer now handles Excel — not just CSV — through the rowsToCsvText bridge.
describe("analyzeVehicleImport via the Excel/CSV bridge", () => {
  it("creates a new vehicle from parsed rows", () => {
    const rows = [{ unit_number: "T-1", fuel_type: "diesel", make: "Freightliner", tank_capacity_gal: "120", baseline_mpg: "6.5" }];
    const p = analyzeVehicleImport(rowsToCsvText(HEADERS, rows), "fleet.xlsx", []);
    expect(p.errors).toEqual([]);
    expect(p.toCreate).toHaveLength(1);
    expect(p.toCreate[0]!.unit_number).toBe("T-1");
    expect(p.toCreate[0]!.tank_capacity_gal).toBe(120);
    expect(p.toCreate[0]!.baseline_mpg).toBe(6.5);
  });

  it("updates tank/MPG on an existing vehicle matched by unit_number", () => {
    const vehicles = [{ id: "v1", unit_number: "T-1", tank_capacity_gal: 100, baseline_mpg: 6.0 } as unknown as Vehicle];
    const rows = [{ unit_number: "T-1", fuel_type: "diesel", tank_capacity_gal: "120", baseline_mpg: "6.5" }];
    const p = analyzeVehicleImport(rowsToCsvText(HEADERS, rows), "fleet.xlsx", vehicles);
    expect(p.toCreate).toEqual([]);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0]!.tank_after).toBe(120);
    expect(p.toUpdate[0]!.mpg_after).toBe(6.5);
  });
});
