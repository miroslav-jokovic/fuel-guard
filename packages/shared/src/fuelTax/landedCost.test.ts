import { describe, expect, it } from "vitest";
import { landedCostPerGal, PURCHASE_STATE_APPORTIONMENT, type BurnApportionment, type LandedCostFill } from "./landedCost.js";

const fill = (over: Partial<LandedCostFill> = {}): LandedCostFill => ({
  gallons: 100,
  netAmount: 400,
  state: "TX",
  tranDate: "2026-08-10",
  ...over,
});

describe("landedCostPerGal", () => {
  it("strips the purchase state's tax out of the pump price", () => {
    // Texas is 0.2000 in every captured quarter, so $4.00/gal at the pump is $3.80 of fuel.
    const c = landedCostPerGal(fill())!;
    expect(c.pumpPerGal).toBe(4);
    expect(c.purchaseTaxPerGal).toBe(0.2);
    expect(c.preTaxPerGal).toBeCloseTo(3.8, 10);
    expect(c.version).toBe("3Q2026");
  });

  it("separates two states that charge the same at the pump but not for the fuel", () => {
    // The point of the whole module: $6.00/gal in California and $6.00/gal in Texas are not the same
    // purchase. California's tax is 0.9790 and Texas's is 0.2000, so California's fuel is 78 cents
    // cheaper and its pump price is entirely a jurisdiction's rate.
    const ca = landedCostPerGal(fill({ state: "CA", netAmount: 600 }))!;
    const tx = landedCostPerGal(fill({ state: "TX", netAmount: 600 }))!;
    expect(ca.pumpPerGal).toBe(tx.pumpPerGal);
    expect(tx.preTaxPerGal - ca.preTaxPerGal).toBeCloseTo(0.779, 10);
  });

  it("returns the pump price as landed cost under the default apportionment, by construction", () => {
    // With "burned where it was bought" the purchase-state tax comes out and goes straight back in.
    // The value today is in the decomposition, not in `landedPerGal` — and that is stated rather than
    // hidden, because a reader who sees landed cost equal pump price is entitled to know why.
    const c = landedCostPerGal(fill({ state: "AZ", netAmount: 450 }))!;
    expect(c.landedPerGal).toBeCloseTo(c.pumpPerGal, 10);
    expect(c.burnSurchargePerGal).toBe(0);
  });

  it("nets a high-tax purchase down when the gallons are burned somewhere cheaper", () => {
    // The F10 pin the plan asks for by name. Bought in California at $6.00; burned entirely in Texas.
    // The California tax comes out (0.9790) and the Texas liability goes in (0.2000), so the gallon
    // lands at $5.221 rather than $6.00 — and this is the argument that becomes real when Samsara
    // mileage arrives, with no other change to this function.
    const burnedInTexas: BurnApportionment = () => [{ state: "TX", share: 1 }];
    const c = landedCostPerGal(fill({ state: "CA", netAmount: 600 }), burnedInTexas)!;
    expect(c.pumpPerGal).toBe(6);
    expect(c.landedPerGal).toBeCloseTo(5.221, 10);
    expect(c.burnTaxPerGal).toBeCloseTo(0.2, 10);
  });

  it("weights a split apportionment by share", () => {
    const half: BurnApportionment = () => [
      { state: "CA", share: 0.5 },
      { state: "TX", share: 0.5 },
    ];
    const c = landedCostPerGal(fill({ state: "TX", netAmount: 400 }), half)!;
    expect(c.burnTaxPerGal).toBeCloseTo((0.979 + 0.2) / 2, 10);
    expect(c.landedPerGal).toBeCloseTo(3.8 + 0.5895, 10);
  });

  it("adds a burn jurisdiction's return surcharge, which no pump price ever showed", () => {
    // Bought and burned in Kentucky: $0.2200 at the pump, $0.1050 more on the quarterly return. The
    // gallon lands 10.5 cents above the price on the sign even though nothing about it moved.
    const c = landedCostPerGal(fill({ state: "KY", netAmount: 400 }))!;
    expect(c.pumpPerGal).toBe(4);
    expect(c.burnSurchargePerGal).toBe(0.105);
    expect(c.landedPerGal).toBeCloseTo(4.105, 10);
  });

  it("refuses to answer rather than guessing, and never answers zero", () => {
    expect(landedCostPerGal(fill({ state: null }))).toBeNull();
    expect(landedCostPerGal(fill({ tranDate: null }))).toBeNull();
    expect(landedCostPerGal(fill({ tranDate: "2025-11-01" }))).toBeNull();
    expect(landedCostPerGal(fill({ netAmount: null }))).toBeNull();
    expect(landedCostPerGal(fill({ gallons: 0 }))).toBeNull();
    // A burn share in a jurisdiction the table cannot price makes the whole figure a guess, so the
    // fill goes back unmeasured rather than as a landed cost silently missing one of its states.
    const partlyUnknown: BurnApportionment = () => [
      { state: "TX", share: 0.5 },
      { state: "ON", share: 0.5 },
    ];
    expect(landedCostPerGal(fill(), partlyUnknown)).toBeNull();
  });

  it("takes no burn liability at all for a fill with no purchase state to fall back on", () => {
    expect(PURCHASE_STATE_APPORTIONMENT(fill({ state: null }))).toEqual([]);
    expect(PURCHASE_STATE_APPORTIONMENT(fill())).toEqual([{ state: "TX", share: 1 }]);
  });

  it("prices an Oregon purchase at zero tax and says the tax is on another bill", () => {
    const c = landedCostPerGal(fill({ state: "OR", netAmount: 400 }))!;
    expect(c.purchaseTaxPerGal).toBe(0);
    expect(c.preTaxPerGal).toBe(4);
    expect(c.basis).toBe("weight_mile");
  });
});
