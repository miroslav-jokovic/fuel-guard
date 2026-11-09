import { describe, it, expect } from "vitest";
import {
  PLAZA_RADIUS_M,
  REPAIR_RADIUS_M,
  TRUCK_PLACE_SEARCH_RADIUS_M,
  pickTruckPlace,
  placeLookupApplies,
  type PlaceCandidate,
} from "./livemapPlace.js";

/**
 * D-LM31. The candidates are HERE Browse answers for the REAL fleet's stopped trucks on 2026-11-09,
 * trimmed to the fields the rule reads. The verdicts are the ones satellite imagery gave
 * (`livemapPlace.ts` header) — so a change to a radius that turns a checked case the other way fails
 * here, against the case it was measured on, rather than against a number.
 */
const cat = (...ids: string[]) => ids.map((id) => ({ id }));
const TRUCK_STOP = "700-7900-0132";
const REST_AREA = "400-4300-0199";
const TRUCK_PARKING = "700-7900-0131";
const TRUCK_REPAIR = "700-7850-0126";
const GAS = "700-7600-0116";

describe("which truck place a stopped truck is at (D-LM31)", () => {
  it("names the truck stop a truck is parked in, from the plaza's own pin", () => {
    // Amarillo, TX: the Pilot is 72 m from the truck and a McDonald's 57 m — the case that killed
    // "nearest place of any kind".
    const here: PlaceCandidate[] = [
      { title: "McDonald's", distance: 57, categories: cat("100-1000-0009") },
      { title: "Pilot", distance: 72, categories: cat(TRUCK_STOP, GAS) },
    ];
    expect(pickTruckPlace(here)).toEqual({ name: "Pilot", kind: "truck_stop", distanceMeters: 72 });
  });

  it("names a plaza out to its radius, because the truck lot is far from the building", () => {
    // Anthony, TX: in the Love's truck lot, 234 m from HERE's pin — checked on satellite.
    const loves: PlaceCandidate = { title: "Love's Travel Stop", distance: 234, categories: cat(REST_AREA, GAS, TRUCK_STOP) };
    expect(pickTruckPlace([loves])?.kind).toBe("truck_stop");
    expect(pickTruckPlace([{ ...loves, distance: PLAZA_RADIUS_M + 1 }])).toBeNull();
  });

  it("names rest areas and truck parking as what they are", () => {
    expect(pickTruckPlace([{ title: "St. Clair County Rest Area N", distance: 6, categories: cat("400-4300-0200", REST_AREA) }])?.kind).toBe("rest_area");
    expect(pickTruckPlace([{ title: "Truck Parking", distance: 66, categories: cat(TRUCK_PARKING) }])?.kind).toBe("truck_parking");
  });

  /**
   * ⚠ The yard. Silvicom's own trucks on Armitage Ave, Melrose Park sit 165 m and 243 m from two repair
   * shops beside the yard, and satellite shows them in the yard. A plaza radius for a repair shop would
   * put a stranger's name on the place this fleet parks most.
   */
  it("does not name a repair shop next door to the carrier's own yard", () => {
    expect(pickTruckPlace([{ title: "JCN Truck & Reefer Repair", distance: 165, categories: cat(TRUCK_REPAIR) }])).toBeNull();
    expect(pickTruckPlace([{ title: "VI Truck and Trailer Repair", distance: 243, categories: cat(TRUCK_REPAIR) }])).toBeNull();
  });

  it("names a repair shop the truck is actually at", () => {
    // Albuquerque: at All Heart Fleet Services' gate, 27 m. Vero Beach: TA's shop lot, 116 m.
    expect(pickTruckPlace([{ title: "All Heart Fleet Services", distance: 27, categories: cat(TRUCK_REPAIR) }])).toEqual({
      name: "All Heart Fleet Services",
      kind: "truck_repair",
      distanceMeters: 27,
    });
    expect(pickTruckPlace([{ title: "Ta Truck Service", distance: 116, categories: cat(TRUCK_REPAIR) }])?.kind).toBe("truck_repair");
    expect(pickTruckPlace([{ title: "Shop", distance: REPAIR_RADIUS_M + 1, categories: cat(TRUCK_REPAIR) }])).toBeNull();
  });

  it("calls a place tagged both ways a truck stop, out to the plaza radius", () => {
    // A repair category does not shrink a truck stop's radius when HERE tags one place with both.
    expect(pickTruckPlace([{ title: "Pete's Service & Sales", distance: 200, categories: cat(TRUCK_STOP, TRUCK_REPAIR) }])?.kind).toBe("truck_stop");
  });

  it("takes the nearest qualifying place, and a plaza over a repair bay at the same distance", () => {
    expect(
      pickTruckPlace([
        { title: "Far plaza", distance: 200, categories: cat(TRUCK_STOP) },
        { title: "Near shop", distance: 40, categories: cat(TRUCK_REPAIR) },
      ])?.name,
    ).toBe("Near shop");
    expect(
      pickTruckPlace([
        { title: "Bay", distance: 50, categories: cat(TRUCK_REPAIR) },
        { title: "Plaza", distance: 50, categories: cat(TRUCK_STOP) },
      ])?.name,
    ).toBe("Plaza");
  });

  it("names nothing when nothing nearby is a truck place", () => {
    expect(pickTruckPlace([])).toBeNull();
    expect(pickTruckPlace([{ title: "A1 Tool Corporation", distance: 71, categories: cat("700-7400-0000") }])).toBeNull();
  });

  it("ignores a candidate with no name or no usable distance rather than inventing one", () => {
    expect(pickTruckPlace([{ title: "  ", distance: 10, categories: cat(TRUCK_STOP) }])).toBeNull();
    expect(pickTruckPlace([{ title: "Pilot", categories: cat(TRUCK_STOP) }])).toBeNull();
    expect(pickTruckPlace([{ title: "Pilot", distance: Number.NaN, categories: cat(TRUCK_STOP) }])).toBeNull();
  });

  it("searches a circle wide enough for the widest rule", () => {
    expect(TRUCK_PLACE_SEARCH_RADIUS_M).toBe(PLAZA_RADIUS_M);
  });
});

describe("which trucks are looked up at all (D-LM31)", () => {
  it("looks up a stopped or parked truck and never a moving or offline one", () => {
    expect(placeLookupApplies("stopped")).toBe(true);
    expect(placeLookupApplies("parked")).toBe(true);
    expect(placeLookupApplies("moving")).toBe(false);
    expect(placeLookupApplies("offline")).toBe(false);
  });
});
