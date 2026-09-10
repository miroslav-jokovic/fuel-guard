import { describe, it, expect } from "vitest";
import { resolveRouteFuelConfig, effectiveTruckProfile } from "./settings.js";
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";

describe("resolveRouteFuelConfig", () => {
  it("null row -> defaults", () => {
    expect(resolveRouteFuelConfig(null)).toEqual(DEFAULT_ROUTE_FUEL_SETTINGS);
  });
  it("row overrides scalars + arrays; empty arrays fall back to defaults", () => {
    const c = resolveRouteFuelConfig({ reserve_pct: 25, avoid_states: ["CA", "OR"], preferred_brands: [] });
    expect(c.reservePct).toBe(25);
    expect(c.avoidStates).toEqual(["CA", "OR"]);
    expect(c.preferredBrands).toEqual(DEFAULT_ROUTE_FUEL_SETTINGS.preferredBrands); // [] -> default
  });
});

describe("resolveRouteFuelConfig — the 0335 columns", () => {
  it("reads fill target, refuel band, critical %, opposite-side miles and border top-off from the row", () => {
    const c = resolveRouteFuelConfig({ fill_target_pct: "95", refuel_band_miles: 200, critical_fuel_pct: 8, opposite_side_access_miles: 0, border_top_off_pct: 85 });
    expect(c.fillTargetPct).toBe(95);
    expect(c.refuelBandMiles).toBe(200);
    expect(c.criticalFuelPct).toBe(8);
    expect(c.oppositeSideAccessMiles).toBe(0);
    expect(c.borderTopOffPct).toBe(85);
  });
  it("clamps the critical threshold under the reserve, so a planned stop at the reserve is never an emergency", () => {
    expect(resolveRouteFuelConfig({ reserve_pct: 15, critical_fuel_pct: 30 }).criticalFuelPct).toBe(15);
    expect(resolveRouteFuelConfig({ reserve_pct: 25, critical_fuel_pct: 10 }).criticalFuelPct).toBe(10);
  });
});

describe("effectiveTruckProfile", () => {
  const cfg = DEFAULT_ROUTE_FUEL_SETTINGS;
  it("uses per-vehicle overrides, else org defaults", () => {
    const p = effectiveTruckProfile({ heightIn: 168, axleCount: 6 }, cfg);
    expect(p.heightIn).toBe(168);
    expect(p.axleCount).toBe(6);
    expect(p.widthIn).toBe(cfg.defaultProfile.widthIn); // fell back
  });
  it("never routes as heavier than the legal max default", () => {
    expect(effectiveTruckProfile({ grossWeightLb: 90000 }, cfg).grossWeightLb).toBe(80000);
    expect(effectiveTruckProfile({ grossWeightLb: 62000 }, cfg).grossWeightLb).toBe(62000);
    expect(effectiveTruckProfile(null, cfg).grossWeightLb).toBe(80000);
  });
});
