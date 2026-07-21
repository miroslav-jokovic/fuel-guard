import { describe, it, expect } from "vitest";
import { isPreferred, rankPrice, cheapest, nearest, ESTIMATE_PENALTY_USD } from "./stationSelect.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";
import type { SolverStation } from "./solver.js";

const cfg = DEFAULT_ROUTE_FUEL_SETTINGS;
const st = (over: Partial<SolverStation>): SolverStation => ({ id: "x", brand: "pilot", state: "TX", milesAhead: 100, detourMiles: 0, netPrice: 3.5, ...over });

describe("isPreferred", () => {
  it("rejects avoided brands and avoided states, accepts preferred", () => {
    expect(isPreferred(st({ brand: "one9" }), cfg)).toBe(false);      // avoid_brands
    expect(isPreferred(st({ state: "CA" }), cfg)).toBe(false);        // avoid_states
    expect(isPreferred(st({ brand: "pilot", state: "TX" }), cfg)).toBe(true);
  });
});

describe("rankPrice / cheapest / nearest", () => {
  it("penalizes an estimate so a real quote wins a near-tie", () => {
    expect(rankPrice(st({ netPrice: 3.5, priceEstimated: true }))).toBeCloseTo(3.5 + ESTIMATE_PENALTY_USD, 6);
    const real = st({ id: "real", netPrice: 3.5 });
    const est = st({ id: "est", netPrice: 3.49, priceEstimated: true });
    expect(cheapest([real, est]).id).toBe("real"); // 3.49+0.03 > 3.5
  });
  it("breaks a price tie toward the lower-detour (easier-access) station", () => {
    const hard = st({ id: "hard", netPrice: 3.5, detourMiles: 3 });
    const easy = st({ id: "easy", netPrice: 3.5, detourMiles: 0 });
    expect(cheapest([hard, easy]).id).toBe("easy");
  });
  it("nearest picks the closest by milesAhead", () => {
    expect(nearest([st({ id: "far", milesAhead: 300 }), st({ id: "near", milesAhead: 120 })]).id).toBe("near");
  });
});
