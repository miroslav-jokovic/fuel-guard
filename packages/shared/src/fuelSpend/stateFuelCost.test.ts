import { describe, expect, it } from "vitest";
import { policyDivergence, rankStatesByFuelCost, THIN_STATE_GALLONS, type StateFuelCostFill } from "./stateFuelCost.js";

/**
 * A ranking that decides where a fleet buys fuel has to be right about two things a pump price gets
 * wrong: that the tax in the price is owed wherever the diesel was bought, and that a state the fleet
 * barely visits cannot carry an average. Both are pinned here.
 */
const at = (state: string, perGal: number, gallons: number, tranDate = "2026-08-10"): StateFuelCostFill => ({
  tranDate, state, gallons, netAmount: perGal * gallons,
});

describe("rankStatesByFuelCost", () => {
  it("ranks on the price of the FUEL, which reorders states a pump price gets wrong", () => {
    // New Jersey pumps HIGHER than Texas and is cheaper underneath: $0.561 of its price is tax the
    // carrier owes on the miles it drives there whichever state the diesel came from. A pump-price
    // ranking sends a dispatcher round a tax rate.
    const r = rankStatesByFuelCost([
      ...Array.from({ length: 30 }, () => at("NJ", 4.9, 120)),
      ...Array.from({ length: 30 }, () => at("TX", 4.6, 120)),
    ]);
    const nj = r.states.find((s) => s.state === "NJ")!;
    const tx = r.states.find((s) => s.state === "TX")!;
    expect(nj.pumpPerGal).toBeGreaterThan(tx.pumpPerGal);
    expect(nj.preTaxPerGal).toBeLessThan(tx.preTaxPerGal);
    expect(r.states[0]!.state).toBe("TX");
  });

  it("measures every state against the fleet's own pre-tax average", () => {
    const r = rankStatesByFuelCost([
      ...Array.from({ length: 30 }, () => at("CA", 6.6, 120)),
      ...Array.from({ length: 30 }, () => at("TX", 4.4, 120)),
    ]);
    expect(r.fleetPreTaxPerGal).toBeCloseTo((6.6 - 0.979 + (4.4 - 0.2)) / 2, 6);
    const ca = r.states.find((s) => s.state === "CA")!;
    expect(ca.vsFleetPerGal).toBeCloseTo(ca.preTaxPerGal - r.fleetPreTaxPerGal!, 6);
    expect(ca.vsFleetPerGal).toBeGreaterThan(0);
  });

  it("weights by gallons, not by fills — one big fill is not one small one", () => {
    const r = rankStatesByFuelCost([at("TX", 5.0, 500), at("TX", 4.0, 100)]);
    const tx = r.states[0]!;
    expect(tx.pumpPerGal).toBeCloseTo((5.0 * 500 + 4.0 * 100) / 600, 6);
    expect(tx.fills).toBe(2);
  });

  it("marks a state the fleet barely visits as thin rather than ranking it silently", () => {
    // Massachusetts is the live case: 15 fills and ~1,600 gallons in ninety days. A policy built on
    // that is a policy about noise.
    const r = rankStatesByFuelCost([at("MA", 7.5, 100), ...Array.from({ length: 30 }, () => at("TX", 4.4, 120))]);
    expect(r.states.find((s) => s.state === "MA")!.thin).toBe(true);
    expect(r.states.find((s) => s.state === "TX")!.thin).toBe(false);
    expect(THIN_STATE_GALLONS).toBe(2000);
  });

  it("keeps a weight-mile jurisdiction out of the ranking rather than showing it as untaxed", () => {
    // Oregon's pump price carries no per-gallon tax because the tax arrives on the weight-mile
    // return. A pre-tax figure for it is not comparable with anybody else's, so it is reported apart.
    const r = rankStatesByFuelCost([at("OR", 4.9, 3000), at("TX", 4.4, 3000)]);
    expect(r.states.map((s) => s.state)).toEqual(["TX"]);
    expect(r.weightMileGallons).toBe(3000);
  });

  it("reports gallons it cannot price rather than counting them as free", () => {
    const r = rankStatesByFuelCost([at("ON", 5.0, 1000), at("TX", 4.4, 1000), at("TX", 4.4, 1000, "2024-01-01")]);
    expect(r.unpricedGallons).toBe(2000);
    expect(r.gallons).toBe(1000);
  });

  it("prices each fill from the quarter its own date falls in", () => {
    // California moved 0.9710 → 0.9790 on 2026-07-01, so a window spanning the boundary is a weighted
    // mix rather than one rate applied to all of it.
    const r = rankStatesByFuelCost([at("CA", 6.6, 1000, "2026-06-30"), at("CA", 6.6, 1000, "2026-07-01")]);
    expect(r.states[0]!.taxPerGal).toBeCloseTo((0.971 + 0.979) / 2, 6);
  });

  it("says nothing at all rather than dividing by no gallons", () => {
    const r = rankStatesByFuelCost([]);
    expect(r.states).toEqual([]);
    expect(r.fleetPreTaxPerGal).toBeNull();
  });
});

describe("policyDivergence", () => {
  const fleet = (): StateFuelCostFill[] => [
    ...Array.from({ length: 30 }, () => at("CA", 6.6, 120)),
    ...Array.from({ length: 30 }, () => at("AZ", 4.9, 120)),
    ...Array.from({ length: 30 }, () => at("TX", 4.3, 120)),
    ...Array.from({ length: 30 }, () => at("WI", 4.2, 120)),
    at("MA", 7.9, 100), // dear, and far too thin to act on
  ];

  it("names the dear states no policy mentions, which is the whole finding", () => {
    // The live shape: California is listed and correct; the next dearest carry real volume and are
    // in no list at all.
    const d = policyDivergence(rankStatesByFuelCost(fleet()), ["CA"]);
    expect(d.dearer.map((s) => s.state)).toContain("CA");
    expect(d.unlisted.map((s) => s.state)).toContain("AZ");
    expect(d.unlisted.map((s) => s.state)).not.toContain("CA");
  });

  it("never puts a thin state on the list, however dear it looks", () => {
    const d = policyDivergence(rankStatesByFuelCost(fleet()), []);
    expect(d.dearer.map((s) => s.state)).not.toContain("MA");
    expect(d.unlisted.map((s) => s.state)).not.toContain("MA");
  });

  it("flags a configured state this window cannot show as dear, without saying to remove it", () => {
    // `fuel_before_states = {MA}` is the live instance: 15 fills, below any threshold at which a rule
    // means anything. It is reported as unverifiable here, not as wrong — a list has reasons a price
    // cannot see (CARB, tolls, a customer who will not take the truck).
    const d = policyDivergence(rankStatesByFuelCost(fleet()), ["MA", "WI"]);
    expect(d.listedButCheap).toContain("MA");
    expect(d.listedButCheap).toContain("WI");
    expect(d.listedButCheap).not.toContain("CA");
  });

  it("normalises the configured codes, because the settings form takes free text", () => {
    const d = policyDivergence(rankStatesByFuelCost(fleet()), [" ca "]);
    expect(d.unlisted.map((s) => s.state)).not.toContain("CA");
  });
});
