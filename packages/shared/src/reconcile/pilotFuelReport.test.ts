import { describe, it, expect } from "vitest";
import { parsePilotFuelReport, parsePilotSiteDescr, type ReconGrid } from "./pilotFuelReport.js";

// A synthetic grid in the real Pilot "All Transactions" shape (metadata rows, header, then lines).
const GRID: ReconGrid = [
  ["Query Name", "DBTransactionsByAccountandTransactionDate"],
  ["CompanyID", 2],
  ["StartDate", "2026-06-01T00:00:00.000Z"],
  ["EndDate", "2026-07-28T00:00:00.000Z"],
  ["StandardAcctNo", 139445],
  ["CompanyId", "StandardAcctNo", "CustomerName", "Authorization_No", "UnitNo", "Card_No", "Site", "SiteDescr", "Quantity", "InvoiceTotal", "RetailTotal", "TransactionDate", "TransactionTime", "ProductCode", "ProductDescription"],
  [2, 139445, "Silvicom Inc", 354187, 672, 947552, 747, "747 Springville UT", 70.71, 345.69, 400.17, "2026-06-01", "00:15", 20, "Truck Diesel"],
  [2, 139445, "Silvicom Inc", 370325, 700, 595140, 662, "662 Oak Grove KY", 3.34, 16.7, 16.7, "2026-06-01", "01:49", 140, "Diesel Exhaust Fluid"],
  [2, 139445, "Silvicom Inc", 370325, 700, 595140, 662, "662 Oak Grove KY", 75.96, 327.63, 363.79, "2026-06-01", "01:49", 20, "Truck Diesel"],
  // Reefer and merchandise, in Pilot's own words. Product code 33 is dyed off-road diesel; the word
  // "Reefer" contains no "diesel", which is exactly why the old description-only rule lost it.
  [2, 139445, "Silvicom Inc", 370326, 701, 595141, 662, "662 Oak Grove KY", 30.6, 161.93, 170.0, "2026-06-02", "02:10", 33, "Reefer"],
  [2, 139445, "Silvicom Inc", 370327, 701, 595141, 662, "662 Oak Grove KY", 1, 12.99, 12.99, "2026-06-02", "02:11", 400, "Miscellaneous"],
];

describe("parsePilotSiteDescr", () => {
  it("splits site / city / state", () => {
    expect(parsePilotSiteDescr("747 Springville UT")).toEqual({ site: "747", city: "Springville", state: "UT" });
    expect(parsePilotSiteDescr("211 Lake Havasu City AZ")).toEqual({ site: "211", city: "Lake Havasu City", state: "AZ" });
  });
});

describe("parsePilotFuelReport", () => {
  const p = parsePilotFuelReport(GRID);
  it("reads metadata + header", () => {
    expect(p.headerFound).toBe(true);
    expect(p.account).toBe("139445");
    expect(p.startDate).toBe("2026-06-01");
    expect(p.endDate).toBe("2026-07-28");
  });
  it("splits diesel vs DEF", () => {
    expect(p.fills.length).toBe(2);
    expect(p.defLines.length).toBe(1);
    expect(p.totalDieselGallons).toBeCloseTo(146.67, 2);
  });
  it("parses a fill in full", () => {
    const f = p.fills.find((x) => x.authNo === "354187")!;
    expect(f).toMatchObject({ unit: "672", cardRef: "947552", site: "747", city: "Springville", state: "UT", gallons: 70.71, netAmount: 345.69, retailAmount: 400.17, tranDate: "2026-06-01", time: "00:15" });
  });
});

describe("the product taxonomy, on the export's real shapes", () => {
  const p = parsePilotFuelReport(GRID);

  it("keeps reefer out of the tractor bucket AND out of the bin", () => {
    // Measured on the real 2026-06/07 export: 120 reefer lines fell through to `other` and the UI then
    // reported "0 reefer", because `/truck diesel|diesel(?! exhaust)/i` cannot match the word "Reefer".
    expect(p.fills.map((f) => f.gallons)).toEqual([70.71, 75.96]);
    expect(p.reeferLines).toHaveLength(1);
    expect(p.reeferLines[0]!.gallons).toBe(30.6);
    expect(p.defLines).toHaveLength(1);
    expect(p.other).toHaveLength(1); // the merchandise line, and only that
  });

  it("carries Pilot's own code and words on every line, padded to three", () => {
    expect(p.fills[0]!.productCode).toBe("020");
    expect(p.reeferLines[0]!.productCode).toBe("033");
    expect(p.defLines[0]!.productCode).toBe("140");
    expect(p.fills[0]!.productDescription).toBe("Truck Diesel");
  });

  it("counts only tractor diesel in the diesel totals", () => {
    expect(p.totalDieselGallons).toBeCloseTo(70.71 + 75.96, 2);
  });
});
