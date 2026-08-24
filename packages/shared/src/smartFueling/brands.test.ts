import { describe, it, expect } from "vitest";
import { brandFromLocationName, matchStationBrand, BRAND_LABELS, PILOT_FAMILY_BRANDS } from "./brands.js";
import { parseStationIdentity } from "../efsImport/reconcile.js";

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

  it("every Pilot-family brand is in the catalog, and non-family networks are NOT in the family list", () => {
    for (const b of PILOT_FAMILY_BRANDS) expect(Object.keys(BRAND_LABELS)).toContain(b);
    for (const [, brand] of REAL_EXPORT_NAMES) expect(PILOT_FAMILY_BRANDS).toContain(brand);
    expect(PILOT_FAMILY_BRANDS).not.toContain("kwik_trip");
    expect(PILOT_FAMILY_BRANDS).not.toContain("road_ranger");
  });
});

describe("matchStationBrand — free-text EFS location names", () => {
  // Every shape below is a real `efs_transactions.location_name` from production (2026-06/08).
  const REAL_EFS_NAMES: Array<[string, string | null]> = [
    ["FJ-TULSA 706", "flying_j"], ["FJ 1372", "flying_j"], ["FJ BIG SPRINGS 904", "flying_j"],
    ["FJ-RAPID CITY", "flying_j"], ["FLYING J #1009", "flying_j"],
    ["PILOT JAMESTOWN 305", "pilot"], ["PFJ SOUTHEAST 1049", "pilot"],
    ["ONE9 #1251", "one9"], ["ONE 9 1330", "one9"], ["ONE9 CLINTON 061", "one9"],
    ["ONE9 PRIDE 1213", "one9"], ["ONE9 EZ TRIP #1275", "one9"],
    ["MR FUEL #715", "mr_fuel"], ["EZ TRIP 1", "ez_trip"], ["ROAD RANGER #267", "road_ranger"],
    ["LOVES #633 TRAVEL STOP", "loves"], ["TA EXPRESS OLANCHA", "ta"],
    // genuine independents — a wrong brand here becomes a wrong siteKey, so they must stay null
    ["BUCKY S STORE 515", null], ["MONROE MART", null], ["MURPHY USA #7596", null],
    ["CIRCLE K 3715", null], ["MAPCO EXPRESS # 4058", null], ["WILLIS ENT INC", null],
    ["OUTPOST TRUCK STOP & CAFE", null],
    // "NATIVE PRIDE" is a different chain; Pilot's Pride only counts when the name STARTS with it
    ["CAT SCALES  NATIVE PRIDE", null], ["Pride Travel Center", "pride"],
  ];
  it("classifies the real name shapes and leaves independents unbranded", () => {
    for (const [name, brand] of REAL_EFS_NAMES) {
      expect(matchStationBrand(name)?.brand ?? null, name).toBe(brand);
    }
  });

  it("reads the store number forward from the brand, not from the road number", () => {
    expect(parseStationIdentity("FJ-TULSA 706", "Tulsa", "OK").siteKey).toBe("flying_j#706");
    expect(parseStationIdentity("ONE9 #1251", "Wamsutter", "WY").siteKey).toBe("one9#1251");
    expect(parseStationIdentity("ONE 9 1330", "Lonoke", "AR").siteKey).toBe("one9#1330");
    // no store number to anchor → the unambiguous name key, never a guess
    expect(parseStationIdentity("FJ-RAPID CITY", "Rapid City", "SD").siteKey).toBe("fj-rapid city|rapid city|sd");
  });

  it("keeps Flying J ahead of Pilot when a name claims both", () => {
    expect(matchStationBrand("PILOT FJ-BILLINGS DBA TOWN PUMP")?.brand).toBe("flying_j");
    expect(matchStationBrand("PILOT FLYING J SOUTHEAST 6990")?.brand).toBe("flying_j");
  });
});
