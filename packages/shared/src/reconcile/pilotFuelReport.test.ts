import { describe, it, expect } from "vitest";
import {
  parsePilotFuelReport,
  parsePilotSiteDescr,
  reconcilePilotFuel,
  type ReconGrid,
  type SystemFill,
  type PilotReportFill,
} from "./pilotFuelReport.js";

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

describe("reconcilePilotFuel", () => {
  const rf = (o: Partial<PilotReportFill>): PilotReportFill => ({ authNo: "A1", unit: "100", cardRef: "947552", site: "747", city: "X", state: "UT", gallons: 70, netAmount: 300, retailAmount: 350, tranDate: "2026-06-01", time: "00:15", product: "diesel", rowNumber: 1, ...o });
  const sf = (o: Partial<SystemFill>): SystemFill => ({ id: "s1", cardRef: "947552", controlId: null, unit: "100", fueledAt: "2026-06-01T00:15:00Z", tranDate: "2026-06-01", gallons: 70, totalCost: 300, ...o });

  it("clean", () => expect(reconcilePilotFuel([rf({})], [sf({})]).summary.clean).toBe(1));
  it("amount mismatch counts $ at stake", () => {
    const r = reconcilePilotFuel([rf({ netAmount: 320 })], [sf({ totalCost: 300 })]);
    expect(r.summary.amountMismatch).toBe(1);
    expect(r.summary.dollarsAtStake).toBeCloseTo(20);
  });
  it("gallon mismatch", () => expect(reconcilePilotFuel([rf({ gallons: 80 })], [sf({ gallons: 70 })]).summary.gallonMismatch).toBe(1));
  it("missing in system", () => {
    const r = reconcilePilotFuel([rf({ netAmount: 450 })], []);
    expect(r.summary.missingInSystem).toBe(1);
    expect(r.summary.dollarsAtStake).toBeCloseTo(450);
  });
  it("missing on report (in-window only)", () => {
    const r = reconcilePilotFuel([rf({})], [sf({ id: "s1" }), sf({ id: "old", tranDate: "2025-01-01", cardRef: "999999", gallons: 99 })]);
    expect(r.summary.missingOnReport).toBe(0);
    expect(r.summary.systemFills).toBe(1);
  });
  it("card drift -> other", () => expect(reconcilePilotFuel([rf({})], [sf({ cardRef: "000000" })]).summary.other).toBe(1));
  it("no double-consume", () => {
    const r = reconcilePilotFuel([rf({ authNo: "A1", gallons: 70 }), rf({ authNo: "A2", gallons: 71 })], [sf({ id: "only", gallons: 70 })]);
    expect(r.summary.missingInSystem).toBe(1);
  });
});
