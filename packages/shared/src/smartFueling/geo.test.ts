import { describe, it, expect } from "vitest";
import { nearestOnRoute, routeLengthMiles, pointToSegmentMiles } from "./geo.js";

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
