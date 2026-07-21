import { describe, it, expect } from "vitest";
import { chooseFill, type FillContext } from "./fillPolicy.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";
import type { SolverStation } from "./solver.js";

const st = (over: Partial<SolverStation>): SolverStation => ({ id: "p", brand: "pilot", state: "TX", milesAhead: 200, detourMiles: 0, netPrice: 3.5, ...over });

// 200-gal tank, usable 190, reserve 38, 6 mpg -> gpm ~1/6. Arrive with 50 gal on hand.
function ctx(over: Partial<FillContext> = {}): FillContext {
  return {
    pick: st({}), arrivalGal: 50, emergency: false, overnight: false, borderTopOff: false,
    cfg: DEFAULT_ROUTE_FUEL_SETTINGS, usable: 190, reserve: 38, weightCap: 1000, tankCap: 200,
    gpm: 1 / 6, dest: 900, stations: [st({})], used: new Set<string>(), galFor: (mi) => mi / 6, ...over,
  };
}

describe("chooseFill", () => {
  it("full-fills by default (alwaysFillFull) up to usable", () => {
    const d = chooseFill(ctx());
    expect(d.fillGal).toBeCloseTo(190 - 50, 6); // top off to usable
    expect(d.isMinFill).toBe(false);
  });
  it("border top-off is always a full fill", () => {
    const d = chooseFill(ctx({ borderTopOff: true }));
    expect(d.fillGal).toBeCloseTo(140, 6);
  });
  it("caps a California (avoided-state) emergency at the splash and flags it", () => {
    const d = chooseFill(ctx({ emergency: true, pick: st({ state: "CA" }) }));
    expect(d.fillGal).toBeLessThanOrEqual(DEFAULT_ROUTE_FUEL_SETTINGS.emergencyFillGallons + 1e-6);
    expect(d.isAvoidedState).toBe(true);
  });
  it("a non-CA emergency still fills full (no splash)", () => {
    const d = chooseFill(ctx({ emergency: true }));
    expect(d.fillGal).toBeCloseTo(140, 6);
    expect(d.isAvoidedState).toBe(false);
  });
  it("min-drawdown (opt-in) partial-fills at a pricey stop with a cheaper one reachable ahead", () => {
    const pick = st({ id: "dear", milesAhead: 200, netPrice: 4.0 });
    const cheaper = st({ id: "cheap", milesAhead: 500, netPrice: 3.0 });
    const d = chooseFill(ctx({
      cfg: { ...DEFAULT_ROUTE_FUEL_SETTINGS, alwaysFillFull: false },
      pick, stations: [pick, cheaper],
    }));
    expect(d.isMinFill).toBe(true);
    expect(d.fillGal).toBeLessThan(140); // not a full top-off
    expect(d.fillGal).toBeGreaterThanOrEqual(DEFAULT_ROUTE_FUEL_SETTINGS.minPurchaseGal - 1e-6);
  });
});
