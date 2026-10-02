import { describe, it, expect } from "vitest";
import { truckPositionAt } from "./truckPosition.js";
import type { SamsaraSample } from "../samsara/index.js";

const S = (time: string, lat: number, lng: number, address: string | null): SamsaraSample => ({
  time,
  lat,
  lng,
  speedMph: 60,
  address,
  odometerMiles: null,
});

// The 2026-09-23 00:16Z attempt on card …27564 at South Bend, IN, while truck 729 drove through
// Tennessee (production declines, CARD-FRAUD-ALERTS-PLAN.md §1). Coordinates are the real cities'.
const SOUTH_BEND = { lat: 41.6764, lng: -86.252 };
const samples = [
  S("2026-09-22T23:40:00Z", 36.0, -88.5, "I-40 W, Jackson, TN, 38301"),
  S("2026-09-23T00:10:00Z", 35.1495, -90.049, "Memphis, TN, 38103"),
  S("2026-09-23T00:55:00Z", 35.1467, -90.1848, "West Memphis, AR, 72301"),
];

describe("truckPositionAt (CF1 — where the card's truck was when the card was used)", () => {
  it("returns the sample nearest the attempt, with its own time, place and distance to the station", () => {
    const p = truckPositionAt(samples, "2026-09-23T00:16:00Z", SOUTH_BEND);
    expect(p).not.toBeNull();
    expect(p!.at).toBe("2026-09-23T00:10:00Z");
    expect(p!.city).toBe("Memphis");
    expect(p!.state).toBe("TN");
    // Memphis → South Bend: 6.53° of latitude (~452 mi) and 3.80° of longitude at ~38°N (~207 mi).
    expect(p!.milesToStation).toBeCloseTo(495.5, 0);
  });

  it("is null when no sample lies within the gap — 'not measured', never 'at the station'", () => {
    expect(truckPositionAt(samples, "2026-09-23T03:00:00Z", SOUTH_BEND)).toBeNull();
  });

  it("accepts a sample exactly at the bound and refuses one just past it", () => {
    // 00:25 is 15 min after the 00:10 sample and 30 min before the 00:55 one.
    expect(truckPositionAt(samples, "2026-09-23T00:25:00Z", SOUTH_BEND, 15)!.at).toBe("2026-09-23T00:10:00Z");
    expect(truckPositionAt(samples, "2026-09-23T00:25:01Z", SOUTH_BEND, 15)).toBeNull();
  });

  it("keeps the position but no distance when the station has no geocode", () => {
    const p = truckPositionAt(samples, "2026-09-23T00:16:00Z", null);
    expect(p!.city).toBe("Memphis");
    expect(p!.milesToStation).toBeNull();
  });

  it("skips samples without coordinates and returns null for an unparseable instant", () => {
    const noCoords = [{ ...samples[1]!, lat: null as unknown as number, lng: null as unknown as number }];
    expect(truckPositionAt(noCoords, "2026-09-23T00:16:00Z", SOUTH_BEND)).toBeNull();
    expect(truckPositionAt(samples, "not a time", SOUTH_BEND)).toBeNull();
  });
});
