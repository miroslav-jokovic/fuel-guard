import { describe, it, expect } from "vitest";
import { nearestOnRoute, routeLengthMiles, pointToSegmentMiles, splitRouteAt, OFF_ROUTE_MILES } from "./geo.js";

// A ~west-to-east straight route near 40N; ~53 mi/deg-lng at this latitude.
const route = [ { lat: 40, lng: -100 }, { lat: 40, lng: -99 }, { lat: 40, lng: -98 } ];

describe("geo", () => {
  it("cross-track ~0 for a point on the line, > for one off it", () => {
    expect(nearestOnRoute({ lat: 40, lng: -99.5 }, route).crossTrackMiles).toBeLessThan(0.1);
    const off = nearestOnRoute({ lat: 40.2, lng: -99.5 }, route); // 0.2 deg lat north ~= 13.8 mi
    expect(off.crossTrackMiles).toBeGreaterThan(12);
    expect(off.crossTrackMiles).toBeLessThan(15);
  });
  it("along-track increases west→east (progress)", () => {
    const a = nearestOnRoute({ lat: 40, lng: -99.8 }, route).alongTrackMiles;
    const b = nearestOnRoute({ lat: 40, lng: -98.2 }, route).alongTrackMiles;
    expect(b).toBeGreaterThan(a);
  });
  it("routeLengthMiles ~ 2 deg lng at 40N (~106 mi)", () => {
    expect(routeLengthMiles(route)).toBeGreaterThan(100);
    expect(routeLengthMiles(route)).toBeLessThan(112);
  });
  it("segment projection clamps t to [0,1]", () => {
    expect(pointToSegmentMiles({ lat: 40, lng: -101 }, { lat: 40, lng: -100 }, { lat: 40, lng: -99 }).t).toBe(0);
  });
  it("labels side of travel: north of a west→east route is LEFT, south is RIGHT", () => {
    expect(nearestOnRoute({ lat: 40.2, lng: -99.5 }, route).side).toBe("left");
    expect(nearestOnRoute({ lat: 39.8, lng: -99.5 }, route).side).toBe("right");
    expect(nearestOnRoute({ lat: 40, lng: -99.5 }, route).side).toBe("on");
  });
});

describe("splitRouteAt (TRUCK-CARD-ROUTE-PLAN D-TC3)", () => {
  // Due east along a parallel, three ~35-mile segments.
  const east = [{ lat: 41, lng: -88 }, { lat: 41, lng: -87.4 }, { lat: 41, lng: -86.8 }, { lat: 41, lng: -86.2 }];

  it("splits at the truck's point on the line, both halves meeting there", () => {
    const s = splitRouteAt(east, { lat: 41.001, lng: -87.1 });
    expect(s.onRoute).toBe(true);
    expect(s.covered).toHaveLength(3);
    expect(s.ahead).toHaveLength(3);
    expect(s.covered.at(-1)).toEqual(s.ahead[0]);
    expect(s.ahead[0]!.lng).toBeCloseTo(-87.1, 6);
    expect(s.ahead[0]!.lat).toBeCloseTo(41, 6);
    // ~1.5 segments of ~31.4 mi each at this latitude.
    expect(s.coveredMiles).toBeGreaterThan(45);
    expect(s.coveredMiles).toBeLessThan(50);
    expect(s.offRouteMiles).toBeLessThan(0.1);
  });

  it("puts the truck on the arm it is driving, not the arm whose vertex is nearest", () => {
    // Out east on the southern arm, back west on a northern arm 0.4 mi away. The truck is ON the
    // northern arm, mid-segment, right beside the southern arm's middle vertex — a vertex search
    // would put it on the outbound leg and grey out the wrong half of the trip.
    const u = [
      { lat: 41, lng: -88 }, { lat: 41, lng: -87 }, { lat: 41, lng: -86 },
      { lat: 41.006, lng: -86 }, { lat: 41.006, lng: -88 },
    ];
    const s = splitRouteAt(u, { lat: 41.0059, lng: -87 });
    expect(s.onRoute).toBe(true);
    // Covered: both outbound segments, the turn, and half the return leg.
    expect(s.covered).toHaveLength(5);
    expect(s.ahead).toEqual([{ lat: 41.006, lng: expect.closeTo(-87, 6) }, { lat: 41.006, lng: -88 }]);
  });

  it("does not split a route the truck is off, and says how far off it is", () => {
    const s = splitRouteAt(east, { lat: 41.1, lng: -87.1 });
    expect(s.onRoute).toBe(false);
    expect(s.covered).toEqual([]);
    expect(s.ahead).toBe(east);
    expect(s.offRouteMiles).toBeGreaterThan(OFF_ROUTE_MILES);
  });

  it("covers nothing before the start and everything past the end", () => {
    expect(splitRouteAt(east, { lat: 41, lng: -88.005 }).coveredMiles).toBe(0);
    const past = splitRouteAt(east, { lat: 41, lng: -86.195 });
    expect(past.ahead).toEqual([east[3], east[3]]);
  });
});
