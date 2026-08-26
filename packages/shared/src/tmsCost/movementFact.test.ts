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

type StopSpec = {
  seq: number;
  kind: "pickup" | "dropoff";
  lat: number;
  lon: number;
  departed_at?: string;
};

/**
 * A trip whose LAST delivery departs at `endedAt`.
 *
 * The delivery time is what orders the chain — not the settle date. This helper exists so a test
 * cannot quietly omit it and end up exercising the skip path while looking like it tests the sort.
 */
const trip = (
  id: string,
  tractor: string | null,
  endedAt: string | null,
  stops: StopSpec[],
  settledAt: string | null = "2026-06-15T09:15:44Z",
): TmsMovementFact => {
  const lastDropoffIndex = stops.reduce((acc, s, i) => (s.kind === "dropoff" ? i : acc), -1);
  const withTime = stops.map((s, i) =>
    i === lastDropoffIndex && endedAt ? { ...s, departed_at: endedAt } : s,
  );
  return tmsMovementFactSchema.parse({
    external_id: id,
    company_id: "TMS",
    tractor_unit: tractor,
    settled_at: settledAt,
    loaded_miles: 250,
    stops: withTime,
  });
};

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
      trip("M1", "101", "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      trip("M2", "101", "2026-06-03T12:00:00Z", [
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

  it("orders by trip end rather than input order", () => {
    const legs = inferDeadheadLegs([
      trip("M2", "101", "2026-06-03T12:00:00Z", [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
      trip("M1", "101", "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.from_movement).toBe("M1");
    expect(legs[0]!.to_movement).toBe("M2");
  });

  it("orders by TRIP END even when settle dates are identical", () => {
    // The regression this function was rewritten for. `xfer2settle_date` is a BATCH timestamp:
    // 2,226 of 3,165 consecutive movement pairs on one tractor (70.3%) share it to the second in
    // June 2026. Sorting on it chained unrelated trips and produced 2,257,083 deadhead miles
    // against 1,694,429 loaded — 133%, where ordering by delivery time gives 3.95%.
    //
    // Here both movements settle in the SAME batch and are fed in reverse trip order.
    const batch = "2026-06-15T09:15:44Z";
    const legs = inferDeadheadLegs([
      trip(
        "LATER",
        "101",
        "2026-06-10T12:00:00Z",
        [
          { seq: 1, kind: "pickup", ...MEM },
          { seq: 2, kind: "dropoff", ...ATL },
        ],
        batch,
      ),
      trip(
        "EARLIER",
        "101",
        "2026-06-02T12:00:00Z",
        [
          { seq: 1, kind: "pickup", ...ATL },
          { seq: 2, kind: "dropoff", ...BNA },
        ],
        batch,
      ),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.from_movement).toBe("EARLIER");
    expect(legs[0]!.to_movement).toBe("LATER");
    // Nashville → Memphis, the real empty leg. Chained the other way it would be Atlanta → Atlanta:
    // a deadhead of zero, which is exactly the silently-wrong answer this pins.
    expect(legs[0]!.miles).toBeCloseTo(196.3244, 3);
  });

  it("skips a movement with no delivery time rather than placing it arbitrarily", () => {
    // 12 of June 2026's 3,337 movements have no usable trip-end time. Guessing where they sit in the
    // sequence would invent empty legs; skipping shortens the chain and understates deadhead, which
    // is the safe direction for a floor.
    const legs = inferDeadheadLegs([
      trip("M1", "101", "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      trip("NOTIME", "101", null, [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
    ]);
    expect(legs).toEqual([]);
  });

  it("never chains across two different tractors", () => {
    // Truck 101 finishing in Nashville says nothing about truck 202 in Memphis.
    const legs = inferDeadheadLegs([
      trip("M1", "101", "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      trip("M2", "202", "2026-06-03T12:00:00Z", [
        { seq: 1, kind: "pickup", ...MEM },
        { seq: 2, kind: "dropoff", ...ATL },
      ]),
    ]);
    expect(legs).toEqual([]);
  });

  it("skips movements that cannot be chained instead of guessing at them", () => {
    const legs = inferDeadheadLegs([
      trip("M1", null, "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
      ]),
      trip("M3", "101", "2026-06-04T12:00:00Z", [{ seq: 1, kind: "pickup", ...ATL }]),
      trip("M4", "101", "2026-06-05T12:00:00Z", [{ seq: 1, kind: "pickup", ...BNA }]),
    ]);
    // M1 has no tractor; M3 and M4 have no dropoff, so neither has a trip-end time.
    expect(legs).toEqual([]);
  });

  it("uses the LAST dropoff and the NEXT first pickup on multi-stop movements", () => {
    const legs = inferDeadheadLegs([
      trip("M1", "101", "2026-06-01T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "dropoff", ...BNA },
        { seq: 3, kind: "dropoff", ...MEM },
      ]),
      trip("M2", "101", "2026-06-03T12:00:00Z", [
        { seq: 1, kind: "pickup", ...ATL },
        { seq: 2, kind: "pickup", ...BNA },
        { seq: 3, kind: "dropoff", ...MEM },
      ]),
    ]);
    // Memphis → Atlanta (336.6867), NOT Nashville → Atlanta (214.8899) nor Memphis → Nashville (196.3244).
    expect(legs[0]!.miles).toBeCloseTo(336.6867, 3);
  });
});
