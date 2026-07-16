import { describe, it, expect } from "vitest";
import { brandFromLocationName, BRAND_LABELS, PILOT_FAMILY_BRANDS } from "./brands.js";

// Every distinct Name on the real 2026-07 locations export (20 variants) must map to a known brand.
const REAL_EXPORT_NAMES: Array<[string, string]> = [
  ["Pilot Travel Center", "pilot"], ["Pilot Dealer", "pilot"], ["Pilot Licensed Location", "pilot"],
  ["Pilot Licensee", "pilot"], ["Pilot Express", "pilot"],
  ["Flying J Travel Center", "flying_j"], ["Flying J Dealer", "flying_j"], ["Flying J Cardlock", "flying_j"],
  ["Flying J Licensed Location", "flying_j"], ["Shell Flying J Dealer", "flying_j"],
  ["ONE9 Dealer", "one9"], ["ONE9 Travel Center", "one9"], ["One9 Travel Center", "one9"],
  ["Mr. Fuel Travel Center", "mr_fuel"], ["EZ Trip Travel Center", "ez_trip"], ["EZ Trip Dealer", "ez_trip"],
  ["Xpress Fuel Travel Center", "xpress_fuel"], ["Pride Travel Center", "pride"],
  ["Stamart Travel Center", "stamart"], ["Arco Travel Center", "arco"],
];

describe("brandFromLocationName", () => {
  it("maps every location name seen on the real export to a known canonical brand", () => {
    for (const [name, brand] of REAL_EXPORT_NAMES) {
      expect(brandFromLocationName(name), name).toEqual({ brand, known: true });
    }
  });

  it("returns a deterministic slug flagged unknown for unseen names — never a silent guess", () => {
    expect(brandFromLocationName("Roadside Randy's Fuel")).toEqual({ brand: "roadside_randy_s_fuel", known: false });
    expect(brandFromLocationName("")).toEqual({ brand: "unknown", known: false });
  });

  it("keeps the family list in sync with the label catalog", () => {
    expect(PILOT_FAMILY_BRANDS).toEqual(Object.keys(BRAND_LABELS));
    for (const [, brand] of REAL_EXPORT_NAMES) expect(PILOT_FAMILY_BRANDS).toContain(brand);
  });
});
