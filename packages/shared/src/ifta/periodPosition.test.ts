import { describe, expect, it } from "vitest";
import { computeIftaPosition } from "./position.js";
import { metersFromMiles } from "../smartFueling/units.js";
import { periodPurchases } from "./periodPosition.js";

/**
 * The ledger's "gallons bought": the period read's card gallons per jurisdiction, plus McLeod's
 * hand-keyed receipts (IP6) as their own source. The page tests mock the query, so this is where the
 * join itself is pinned — for the page and for the return export, which both call it (IP9).
 */
const NONE = { jurisdictions: [], sources: [], duplicatesDropped: 0, duplicateGallons: 0, unmatched: 0, unmatchedUnits: [] };

describe("periodPurchases", () => {
  it("adds each state's receipts to its card gallons, marked as receipts", () => {
    const p = periodPurchases(
      [{ jurisdiction: "TX", purchased_gallons: "9600.5" }, { jurisdiction: "CA", purchased_gallons: 0 }],
      { ...NONE, jurisdictions: [{ jurisdiction: "TX", gallons: 400, receipts: 3 }, { jurisdiction: "UT", gallons: 110, receipts: 1 }] },
      "2026-08-15",
    );
    expect(p).toEqual([
      { jurisdiction: "TX", gallons: 9600.5, tranDate: "2026-08-15" },
      { jurisdiction: "TX", gallons: 400, tranDate: "2026-08-15", source: "mcleod_receipt" },
      { jurisdiction: "UT", gallons: 110, tranDate: "2026-08-15", source: "mcleod_receipt" },
    ]);
  });

  it("gives a state that only had receipts a credit, and moves the fleet MPG with them", () => {
    const miles = [{ jurisdiction: "TX", taxableMeters: metersFromMiles(70_000), totalMeters: metersFromMiles(70_000), taxPaidLiters: 0 }];
    const cardOnly = computeIftaPosition(miles, periodPurchases([{ jurisdiction: "TX", purchased_gallons: 9_000 }], NONE, "2026-08-15"), "2026-08-15");
    const withReceipts = computeIftaPosition(
      miles,
      periodPurchases([{ jurisdiction: "TX", purchased_gallons: 9_000 }], { ...NONE, jurisdictions: [{ jurisdiction: "UT", gallons: 1_000, receipts: 9 }] }, "2026-08-15"),
      "2026-08-15",
    );
    expect(cardOnly.mpg.fleetMpg).toBeCloseTo(70_000 / 9_000, 6);
    expect(withReceipts.mpg.fleetMpg).toBeCloseTo(7, 6);
    expect(withReceipts.jurisdictions.find((j) => j.jurisdiction === "UT")).toMatchObject({ gallonsPurchased: 1_000, gallonsFromReceipts: 1_000 });
    expect(withReceipts.receiptGallons).toBe(1_000);
  });
});
