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
