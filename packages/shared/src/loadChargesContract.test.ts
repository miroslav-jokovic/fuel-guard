import { describe, expect, it } from "vitest";
import { loadChargeSplitNote, loadChargesSchema, loadRatePerMile } from "./loadChargesContract.js";

/** LOAD-RATES-PLAN D-RATE4, D-RATE5, R3 — the figures every screen derives from a load's `charges`. */
describe("a load's charges", () => {
  it("rate per mile is the order total over its billed miles, and nothing without billed miles", () => {
    expect(loadRatePerMile({ total_charge: 4580, billed_miles: 1982 })).toBeCloseTo(2.3108, 4);
    expect(loadRatePerMile({ total_charge: 4580, billed_miles: null })).toBeNull();
    expect(loadRatePerMile({ total_charge: 4580, billed_miles: 0 })).toBeNull();
    // A $0 total is McLeod's figure (10 orders since 01-01), not an absence: it is $0.00 a mile.
    expect(loadRatePerMile({ total_charge: 0, billed_miles: 500 })).toBe(0);
  });

  it("notes a split order on each leg, and only when it is split", () => {
    expect(loadChargeSplitNote({ order_loaded_movements: 2 })).toBe("Order total · split over 2 trips");
    expect(loadChargeSplitNote({ order_loaded_movements: 1 })).toBeNull();
    expect(loadChargeSplitNote({ order_loaded_movements: null })).toBeNull();
  });

  it("accepts negative other charges — McLeod records them (as low as −$1,000)", () => {
    const c = { total_charge: 3000, linehaul: 4000, other_charges: -1000, currency: "USD", billed_miles: null, order_loaded_movements: 1 };
    expect(loadChargesSchema.parse(c)).toEqual(c);
  });
});
