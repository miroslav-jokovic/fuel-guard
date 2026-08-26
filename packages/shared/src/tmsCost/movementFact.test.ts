import { describe, it, expect } from "vitest";
import {
  greatCircleMiles,
  inferDeadheadLegs,
  tmsMovementFactSchema,
  type TmsMovementFact,
} from "./movementFact.js";

// Real lanes for this carrier. Every expected distance below was cross-checked against the
// spherical law of cosines and the Vincenty sphere formula, which agree with the haversine
// implementation to four decimals — so these constants test the code, not restate its output.
const ATL = { lat: 33.749, lon: -84.388 };
const BNA = { lat: 36.1627, lon: -86.7816 };
const MEM = { lat: 35.1495, lon: -90.049 };

const mv = (
  external_id: string,
  tractor_unit: string | null,
  settled_at: string | null,
  stops: Array<{ seq: number; kind: "pickup" | "dropoff"; lat: number; lon: number }>,
): TmsMovementFact =>
  tmsMovementFactSchema.parse({
    external_id,
    company_id: "TMS",
    tractor_unit,
    settled_at,
    loaded_miles: 250,
    stops,
  });

describe("greatCircleMiles", () => {
  it("measures a known lane", () => {
    // Atlanta → Nashville: 214.8899 statute miles.
    expect(greatCircleMiles(ATL.lat, ATL.lon, BNA.lat, BNA.lon)).toBeCloseTo(214.8899, 3);
  });

  it("is zero for a point against itself and symmetric between two points", () => {
    expect(greatCircleMiles(ATL.lat, ATL.lon, ATL.lat, ATL.lon)).toBe(0);
    expect(greatCircleMiles(ATL.lat, ATL.lon, BNA.lat, BNA.lon)).toBeCloseTo(
      greatCircleMiles(BNA.lat, BNA.lon, ATL.lat, ATL.lon),
      9,
    );
  });
});

describe("tmsMovementFactSchema", () => {
  it("requires stop coordinates, because deadhead cannot be chained without them", () => {
    const withoutCoords = {
      external_id: "M1",
      company_id: "TMS",
      stops: [{ seq: 1, kind: "pickup", city: "Atlanta", state: "GA" }],
    };
    expect(() => tmsMovementFactSchema.parse(withoutCoords)).toThrow();
  });

  it("defaults distance_unit to MI, since McLeod settlement rows declare no unit at all", () => {
    const m = tmsMovementFactSchema.parse({ external_id: "M1", company_id: "TMS" });
    expect(m.distance_unit).toBe("MI");
    expect(m.stops).toEqual([]);
    expect(m.order_ids).toEqual([]);
  });
});

describe("inferDeadheadLegs", () => {
  it("chains a tractor's deliveries to its next pickup", () => {
    // Truck 101 delivers in Nashville, then picks up in Memphis: that gap ran empty.
    const legs = inferDeadheadLegs([
      mv("M1", "101", "2026-06-01T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      mv("M2", "101", "2026-06-03T00:00:00Z", [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.tractor_unit).toBe("101");
    expect(legs[0]!.from_movement).toBe("M1");
    expect(legs[0]!.to_movement).toBe("M2");
    // Nashville → Memphis: 196.3244 miles.
    expect(legs[0]!.miles).toBeCloseTo(196.3244, 3);
  });

  it("orders by settled_at rather than input order", () => {
    // Fed newest-first; the empty leg still runs Nashville → Memphis, not the reverse.
    const legs = inferDeadheadLegs([
      mv("M2", "101", "2026-06-03T00:00:00Z", [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
      mv("M1", "101", "2026-06-01T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.from_movement).toBe("M1");
    expect(legs[0]!.to_movement).toBe("M2");
  });

  it("never chains across two different tractors", () => {
    // The whole point: truck 101 finishing in Nashville says nothing about truck 202 in Memphis.
    const legs = inferDeadheadLegs([
      mv("M1", "101", "2026-06-01T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      mv("M2", "202", "2026-06-03T00:00:00Z", [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
    ]);
    expect(legs).toEqual([]);
  });

  it("skips movements that cannot be chained instead of guessing at them", () => {
    // No tractor, no settle date, and no dropoff respectively. Each drops out; the run
    // understates deadhead, which is the safe direction for a floor.
    const legs = inferDeadheadLegs([
      mv("M1", null, "2026-06-01T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      mv("M2", "101", null, [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
      mv("M3", "101", "2026-06-04T00:00:00Z", [{ seq: 1, kind: "pickup", ...ATL }]),
      mv("M4", "101", "2026-06-05T00:00:00Z", [{ seq: 1, kind: "pickup", ...BNA }]),
    ]);
    // M3 has no dropoff, so M3 → M4 cannot be measured.
    expect(legs).toEqual([]);
  });

  it("uses the LAST dropoff and the NEXT first pickup on multi-stop movements", () => {
    // A movement ending in Memphis after an intermediate Nashville drop is empty from MEMPHIS.
    const legs = inferDeadheadLegs([
      mv("M1", "101", "2026-06-01T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
        { seq: 3, kind: "dropoff", ...MEM },
      ]),
      mv("M2", "101", "2026-06-03T00:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "pickup", ...BNA },
        { seq: 3, kind: "dropoff", ...MEM },
      ]),
    ]);
    // Memphis → Atlanta (336.6867), NOT Nashville → Atlanta (214.8899) nor Memphis → Nashville (196.3244).
    expect(legs[0]!.miles).toBeCloseTo(336.6867, 3);
  });
});
