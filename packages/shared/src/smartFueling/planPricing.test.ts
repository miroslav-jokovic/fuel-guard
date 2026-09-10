import { describe, it, expect } from "vitest";
import { planPricing, discountPerGal } from "./planPricing.js";

describe("planPricing", () => {
  it("totalCostAtPump − totalCost = discountSavings", () => {
    const p = planPricing([
      { gallons: 146.7, netPrice: 5.571, postedPrice: 5.94 },
      { gallons: 144.8, netPrice: 5.38, postedPrice: 6.01 },
    ]);
    expect(p.totalCost).toBeCloseTo(146.7 * 5.571 + 144.8 * 5.38, 2);
    expect(p.totalCostAtPump).toBeCloseTo(146.7 * 5.94 + 144.8 * 6.01, 2);
    expect(p.discountSavings).toBeCloseTo(p.totalCostAtPump! - p.totalCost!, 2);
    expect(p.discountSavings).toBeGreaterThan(0);
  });
  it("a stop with no pump price makes the pump total unknown, not a total that skips the stop", () => {
    const p = planPricing([
      { gallons: 100, netPrice: 5.5, postedPrice: 5.9 },
      { gallons: 100, netPrice: 5.4, postedPrice: null }, // a history-median stop
    ]);
    expect(p.totalCost).toBeCloseTo(1090, 2);
    expect(p.totalCostAtPump).toBeNull();
    expect(p.discountSavings).toBeNull();
  });
  it("a stop with no net price leaves the pump total knowable and the discount unknown", () => {
    const p = planPricing([{ gallons: 100, netPrice: null, postedPrice: 5.9 }]);
    expect(p).toEqual({ totalCost: null, totalCostAtPump: 590, discountSavings: null });
  });
  it("the per-gallon discount is signed and null when either side is unknown", () => {
    expect(discountPerGal(5.94, 5.571)).toBeCloseTo(0.369, 3);
    expect(discountPerGal(5.0, 5.2)).toBeCloseTo(-0.2, 3); // a cost-plus rule
    expect(discountPerGal(null, 5.5)).toBeNull();
    expect(discountPerGal(5.5, null)).toBeNull();
  });
});
