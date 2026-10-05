import { describe, expect, it } from "vitest";
import { iftaJurisdictionTrucks } from "./jurisdictionTrucks.js";
import { metersFromMiles } from "../smartFueling/units.js";

const truck = (unitNumber: string | null, taxableMiles: number, totalMiles = taxableMiles, months = 3) => ({
  vehicleId: `v-${unitNumber ?? "none"}`,
  unitNumber,
  taxableMeters: metersFromMiles(taxableMiles),
  totalMeters: metersFromMiles(totalMiles),
  months,
});

describe("iftaJurisdictionTrucks", () => {
  it("converts each truck's metres to miles and totals the jurisdiction", () => {
    const r = iftaJurisdictionTrucks([truck("101", 1_200, 1_250), truck("102", 800)]);
    expect(r.trucks.map((t) => [t.unitNumber, t.taxableMiles, t.totalMiles])).toEqual([
      ["101", 1_200, 1_250],
      ["102", 800, 800],
    ]);
    expect(r.taxableMiles).toBe(2_000);
    expect(r.totalMiles).toBe(2_050);
  });

  it("gives each truck its share of the jurisdiction's TAXABLE miles, not of its total miles", () => {
    // 102's total is inflated by non-taxable (toll / off-highway) miles; its share must not be.
    const r = iftaJurisdictionTrucks([truck("101", 750), truck("102", 250, 5_000)]);
    expect(r.trucks.find((t) => t.unitNumber === "101")!.share).toBeCloseTo(0.75, 6);
    expect(r.trucks.find((t) => t.unitNumber === "102")!.share).toBeCloseTo(0.25, 6);
  });

  it("orders the most taxable miles first, unit number breaking a tie", () => {
    const r = iftaJurisdictionTrucks([truck("20", 100), truck("9", 100), truck("5", 900)]);
    expect(r.trucks.map((t) => t.unitNumber)).toEqual(["5", "9", "20"]);
  });

  it("keeps a truck with no unit number rather than dropping its miles", () => {
    const r = iftaJurisdictionTrucks([truck(null, 400), truck("101", 600)]);
    expect(r.trucks).toHaveLength(2);
    expect(r.taxableMiles).toBe(1_000);
  });

  it("has no share at all when the jurisdiction has no taxable miles, rather than dividing by zero", () => {
    const r = iftaJurisdictionTrucks([truck("101", 0, 300)]);
    expect(r.trucks[0]!.share).toBeNull();
    expect(r.totalMiles).toBe(300);
  });

  it("totals from unrounded miles, so many small trucks do not drift from the ledger's row", () => {
    // Ten trucks of 0.4 mi each: rounding first would total 0, the ledger's sum says 4.
    const r = iftaJurisdictionTrucks(Array.from({ length: 10 }, (_, i) => truck(String(i), 0.4)));
    expect(r.taxableMiles).toBe(4);
  });
});
