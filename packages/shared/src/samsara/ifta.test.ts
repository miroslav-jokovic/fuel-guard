import { describe, expect, it } from "vitest";
import { iftaMonthNumber, mergeIftaPages, parseIftaVehicleReport, type RawIftaResponse } from "./ifta.js";

/**
 * The parser's whole contract is that it does NOT decide anything: no conversion, no pricing, no
 * dropping. Two properties carry that, and both are the kind that fail silently.
 *
 *   1. A JURISDICTION IT DOES NOT RECOGNISE IS STILL A JURISDICTION. Dropping an unknown code shrinks
 *      the denominator of every share computed downstream, and nothing on any surface would say so.
 *   2. A VEHICLE THAT REPORTED NOTHING IS NOT A VEHICLE THAT WAS ABSENT. The first means the truck
 *      moved no taxable miles; the second means Samsara did not mention it. A caller reconciling 172
 *      vehicles against its own fleet needs to tell those apart.
 */
const body = (over: Partial<NonNullable<RawIftaResponse["data"]>> = {}): RawIftaResponse => ({
  data: {
    year: 2026,
    month: "April",
    vehicleReports: [
      {
        vehicle: { id: 281474978379885, name: "506" },
        jurisdictions: [
          { jurisdiction: "TX", totalMeters: 8570727.866541315, taxableMeters: 8570727.866541315, taxPaidLiters: 0 },
          { jurisdiction: "CA", totalMeters: 2336991.3991999496, taxableMeters: 2336991.3991999496 },
        ],
      },
    ],
    troubleshooting: {
      noPurchasesFound: false, unassignedFuelTypePurchases: 0,
      unassignedFuelTypeVehicles: 187, unassignedVehiclePurchases: 0,
    },
    ...over,
  },
});

describe("parseIftaVehicleReport", () => {
  it("keeps the metres as metres — nothing here converts anything", () => {
    const r = parseIftaVehicleReport(body());
    const tx = r.rows.find((x) => x.jurisdiction === "TX")!;
    // The exact double Samsara sent. A miles figure here would be a policy baked into stored data.
    expect(tx.taxableMeters).toBe(8570727.866541315);
    expect(tx.totalMeters).toBe(8570727.866541315);
  });

  it("carries the vehicle's Samsara id as a string, because that is what it joins on", () => {
    // The id arrives as a JSON number large enough to be uncomfortable; `samsara_vehicle_id` is text.
    const r = parseIftaVehicleReport(body());
    expect(r.rows[0]!.samsaraVehicleId).toBe("281474978379885");
    expect(r.rows[0]!.vehicleName).toBe("506");
  });

  it("defaults a missing figure to zero rather than to NaN", () => {
    // `taxPaidLiters` is absent on the California row above — Samsara omits it rather than sending 0.
    const r = parseIftaVehicleReport(body());
    expect(r.rows.find((x) => x.jurisdiction === "CA")!.taxPaidLiters).toBe(0);
  });

  it("keeps a jurisdiction it does not recognise, and flags it", () => {
    // Dropping it would shrink the denominator of every share downstream, silently. It is stored as
    // sent and marked, so a surface can report it as unpriceable rather than as absent (D-IF7).
    const r = parseIftaVehicleReport(body({
      vehicleReports: [{ vehicle: { id: "1" }, jurisdictions: [
        { jurisdiction: "TX", taxableMeters: 100 },
        { jurisdiction: "ZZ", taxableMeters: 50 },
      ] }],
    }));
    expect(r.rows.map((x) => x.jurisdiction)).toEqual(["TX", "ZZ"]);
    expect(r.rows.find((x) => x.jurisdiction === "ZZ")!.recognised).toBe(false);
    expect(r.rows.find((x) => x.jurisdiction === "TX")!.recognised).toBe(true);
  });

  it("uppercases the code but does not translate it", () => {
    const r = parseIftaVehicleReport(body({
      vehicleReports: [{ vehicle: { id: "1" }, jurisdictions: [{ jurisdiction: " tx ", taxableMeters: 1 }] }],
    }));
    expect(r.rows[0]!.jurisdiction).toBe("TX");
  });

  it("counts a vehicle that reported no jurisdictions, and gives it no rows", () => {
    const r = parseIftaVehicleReport(body({
      vehicleReports: [
        { vehicle: { id: "1" }, jurisdictions: [{ jurisdiction: "TX", taxableMeters: 1 }] },
        { vehicle: { id: "2" }, jurisdictions: [] },
      ],
    }));
    expect(r.vehicles).toBe(2);
    expect(r.rows).toHaveLength(1);
  });

  it("drops a report with no vehicle id, because there is nothing to attribute it to", () => {
    const r = parseIftaVehicleReport(body({
      vehicleReports: [
        { vehicle: {}, jurisdictions: [{ jurisdiction: "TX", taxableMeters: 1 }] },
        { vehicle: { id: "2" }, jurisdictions: [{ jurisdiction: "TX", taxableMeters: 1 }] },
      ],
    }));
    expect(r.vehicles).toBe(1);
    expect(r.rows).toHaveLength(1);
  });

  it("carries the troubleshooting block through as data", () => {
    // 187 vehicles with no fuel type is WHY Samsara's own fuel figure is 668 gallons a quarter against
    // our 439,153. A surface showing the one without the other is showing a number it cannot explain.
    const r = parseIftaVehicleReport(body());
    expect(r.troubleshooting.unassignedFuelTypeVehicles).toBe(187);
    expect(r.troubleshooting.noPurchasesFound).toBe(false);
  });

  it("survives an empty or malformed body rather than throwing at a scheduler", () => {
    for (const b of [{}, { data: {} }, { data: { vehicleReports: null } } as unknown as RawIftaResponse]) {
      const r = parseIftaVehicleReport(b as RawIftaResponse);
      expect(r.rows).toEqual([]);
      expect(r.vehicles).toBe(0);
      expect(r.troubleshooting.unassignedFuelTypeVehicles).toBe(0);
    }
  });

  it("echoes the period Samsara says it answered, not the one we asked for", () => {
    const r = parseIftaVehicleReport(body());
    expect(r.year).toBe(2026);
    expect(r.month).toBe("April");
    expect(r.quarter).toBeNull();
  });
});

describe("mergeIftaPages", () => {
  it("accumulates rows and vehicles across pages", () => {
    const a = parseIftaVehicleReport(body({ vehicleReports: [{ vehicle: { id: "1" }, jurisdictions: [{ jurisdiction: "TX", taxableMeters: 1 }] }] }));
    const b = parseIftaVehicleReport(body({ vehicleReports: [{ vehicle: { id: "2" }, jurisdictions: [{ jurisdiction: "CA", taxableMeters: 2 }] }] }));
    const m = mergeIftaPages([a, b]);
    expect(m.rows).toHaveLength(2);
    expect(m.vehicles).toBe(2);
    expect(m.month).toBe("April");
  });

  it("returns an empty report for no pages rather than undefined", () => {
    const m = mergeIftaPages([]);
    expect(m.rows).toEqual([]);
    expect(m.vehicles).toBe(0);
    expect(m.year).toBeNull();
  });
});

describe("iftaMonthNumber", () => {
  it("maps the endpoint's month names to numbers", () => {
    expect(iftaMonthNumber("January")).toBe(1);
    expect(iftaMonthNumber("April")).toBe(4);
    expect(iftaMonthNumber("December")).toBe(12);
  });

  it("refuses anything that is not one of the twelve", () => {
    for (const bad of [null, undefined, "", "Apr", "13", "Quarter"]) {
      expect(iftaMonthNumber(bad)).toBeNull();
    }
  });
});
