import { describe, it, expect } from "vitest";
import { learnStationCoord } from "./stationCoord.js";

describe("learnStationCoord (station coordinate from clustered truck stops)", () => {
  it("learns the site centroid when visits cluster at one pump lot", () => {
    const pos = Array.from({ length: 8 }, (_, i) => ({ lat: 41.5 + (i % 2) * 0.0005, lng: -87.9 + (i % 2) * 0.0005 }));
    const r = learnStationCoord(pos);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(41.5, 2);
    expect(r!.lng).toBeCloseTo(-87.9, 2);
    expect(r!.samples).toBeGreaterThanOrEqual(8);
  });

  it("returns null when there aren't enough visits", () => {
    expect(learnStationCoord([{ lat: 41.5, lng: -87.9 }, { lat: 41.5, lng: -87.9 }])).toBeNull();
  });

  it("returns null when the stop positions are scattered (can't pin the station)", () => {
    const pos = [
      { lat: 41.5, lng: -87.9 }, { lat: 42.1, lng: -88.4 }, { lat: 40.9, lng: -87.2 },
      { lat: 41.8, lng: -86.9 }, { lat: 41.2, lng: -88.8 },
    ];
    expect(learnStationCoord(pos)).toBeNull();
  });

  it("tolerates a few outliers around a tight cluster", () => {
    const pos = [
      ...Array.from({ length: 8 }, () => ({ lat: 41.5, lng: -87.9 })),
      { lat: 43.0, lng: -90.0 }, // one truck that stopped elsewhere
    ];
    const r = learnStationCoord(pos);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(41.5, 3);
  });
});
