import { describe, it, expect } from "vitest";
import { buildStationIndex, matchFillStation, storeNumberVariants, type StationRef } from "./stationMatch.js";

/**
 * Every case here is a real production shape. The two that matter most are the ones that cost fills in
 * the first two attempts at this matcher: EFS printing a Flying J as "PILOT", and the registry holding
 * zero-padded duplicates of the same store.
 */
const stations: StationRef[] = [
  { id: "fj-305", brand: "flying_j", storeNumber: "305", state: "NM" },   // EFS calls this "PILOT JAMESTOWN 305"
  { id: "pilot-609", brand: "pilot", storeNumber: "609", state: "AZ" },   // …and this "FLYING J ELOY 609"
  { id: "loves-609", brand: "loves", storeNumber: "609", state: "TX" },   // same number, different network
  { id: "pilot-31-pad", brand: "pilot", storeNumber: "031", state: "IN" },
  { id: "one9-37", brand: "one9", storeNumber: "37", state: "IN" },
  { id: "kwik-1015", brand: "kwik_trip", storeNumber: "1015", state: "WI" },
  { id: "pilot-1015", brand: "pilot", storeNumber: "1015", state: "WI" },
];
const index = buildStationIndex(stations);
const match = (text: string, state: string | null) => matchFillStation(index, text, state);

describe("the Pilot family is matched on store and state, never on the brand EFS printed", () => {
  it("resolves a Flying J that EFS billed as PILOT", () => {
    const m = match("PILOT JAMESTOWN 305 JAMESTOWN NM", "NM");
    expect(m.stationId).toBe("fj-305");
    expect(m.reason).toBe("family");
    // The registry's brand is the answer, not the one on the receipt — this IS the brand analysis.
    expect(m.brand).toBe("flying_j");
  });

  it("resolves a Pilot that EFS billed as FLYING J", () => {
    const m = match("FLYING J ELOY 609 ELOY AZ", "AZ");
    expect(m.stationId).toBe("pilot-609");
    expect(m.brand).toBe("pilot");
  });

  it("reads the abbreviations EFS actually writes", () => {
    expect(match("FJ-TULSA 305 JAMESTOWN NM", "NM").stationId).toBe("fj-305");
    expect(match("FJ 305 NM", "NM").stationId).toBe("fj-305");
  });

  it("resolves ONE9, which is what the avoid-brand report is for", () => {
    const m = match("ONE9 37 WHITELAND IN", "IN");
    expect(m.stationId).toBe("one9-37");
    expect(m.brand).toBe("one9");
  });
});

describe("networks outside the family keep their own numbering space", () => {
  it("never lets a Love's store number resolve into the Pilot family", () => {
    expect(match("LOVES 609 DENTON TX", "TX").stationId).toBe("loves-609");
    // …and the Pilot 609 in Arizona is a different place entirely.
    expect(match("PILOT 609 ELOY AZ", "AZ").stationId).toBe("pilot-609");
  });

  it("keeps Kwik Trip #1015 and Pilot #1015 apart in the same state", () => {
    expect(match("KWIK TRIP 1015 WI", "WI").stationId).toBe("kwik-1015");
    expect(match("PILOT 1015 WI", "WI").stationId).toBe("pilot-1015");
  });
});

describe("store numbers are matched as printed before anything is normalised", () => {
  it("tries raw first, then the zero-padded spellings the registry may hold", () => {
    expect(storeNumberVariants("31")).toEqual(["31", "031", "0031"]);
    expect(storeNumberVariants("0305")[0]).toBe("0305"); // raw always leads
  });

  it("finds a padded registry row from an unpadded receipt", () => {
    const m = match("PILOT HIGHLAND 31 HIGHLAND IN", "IN");
    expect(m.stationId).toBe("pilot-31-pad");
  });

  it("does not fold a padded and an unpadded row into one ambiguous key", () => {
    // The production registry holds BOTH "031" (no city) and "31" for Highland. Normalising both sides
    // made 54 keys ambiguous and cost 790 fills; matching raw-first resolves them.
    const dupes = buildStationIndex([...stations, { id: "pilot-31-raw", brand: "pilot", storeNumber: "31", state: "IN" }]);
    const m = matchFillStation(dupes, "PILOT HIGHLAND 31 HIGHLAND IN", "IN");
    expect(m.reason).toBe("family");
    expect(m.stationId).toBe("pilot-31-raw"); // the exact spelling wins
  });
});

describe("what does not resolve stays null, and says why", () => {
  it("leaves a genuine independent alone rather than guessing a brand for it", () => {
    const m = match("MONROE MART MONROE MI", "MI");
    expect(m.stationId).toBeNull();
    expect(m.reason).toBe("no_brand");
  });

  it("reports a branded dealer site printed without a store number", () => {
    // Real: "PILOT TOWN PUMP BILLINGS" — Pilot-branded, no number anywhere in the string.
    const m = match("PILOT TOWN PUMP BILLINGS, BILLINGS, MT", "MT");
    expect(m.stationId).toBeNull();
    expect(m.reason).toBe("no_store");
    expect(m.brand).toBe("pilot");
  });

  it("reports a key the registry has never heard of, so the gap is visible", () => {
    const m = match("PILOT 9999 NOWHERE NM", "NM");
    expect(m.reason).toBe("unmatched");
    expect(m.key).toContain("9999");
  });

  it("refuses to place a store number with no state to place it in", () => {
    expect(match("PILOT 305 JAMESTOWN", null).reason).toBe("no_state");
  });

  it("never crosses a state line to find a match", () => {
    expect(match("PILOT JAMESTOWN 305 JAMESTOWN NM", "TX").reason).toBe("unmatched");
  });

  it("declines to choose when two distinct stations answer to one key", () => {
    const clash = buildStationIndex([
      { id: "a", brand: "pilot", storeNumber: "77", state: "OH" },
      { id: "b", brand: "flying_j", storeNumber: "77", state: "OH" },
    ]);
    const m = matchFillStation(clash, "PILOT 77 OH", "OH");
    expect(m.stationId).toBeNull();
    expect(m.reason).toBe("ambiguous");
  });
});
