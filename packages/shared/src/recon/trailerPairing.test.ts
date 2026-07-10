import { describe, it, expect } from "vitest";
import { inferTrailerPairing, type GpsSample, type TruckTrack } from "./trailerPairing.js";

// Build a GPS track that walks east from a start point, one sample per minute.
function track(startLat: number, startLng: number, n: number, stepDeg = 0.001, startMin = 0): GpsSample[] {
  return Array.from({ length: n }, (_, i) => ({ t: (startMin + i) * 60_000, lat: startLat, lng: startLng + i * stepDeg }));
}

describe("inferTrailerPairing (reefer ↔ tractor GPS co-location)", () => {
  it("pairs a trailer to the truck it travels with", () => {
    const trailer = track(40, -80, 60);
    const trucks: TruckTrack[] = [
      { vehicleId: "with", gps: track(40.0005, -80, 60) }, // ~0.03 mi away, same path — the hauler
      { vehicleId: "far", gps: track(41, -75, 60) }, // hundreds of miles away
    ];
    const r = inferTrailerPairing(trailer, trucks);
    expect(r?.vehicleId).toBe("with");
    expect(r!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("returns null when no truck is consistently co-located (parked in a shared yard)", () => {
    const trailer = track(40, -80, 60);
    const trucks: TruckTrack[] = [
      { vehicleId: "a", gps: track(41, -75, 60) },
      { vehicleId: "b", gps: track(42, -70, 60) },
    ];
    expect(inferTrailerPairing(trailer, trucks)).toBeNull();
  });

  it("returns null when two trucks split the trailer evenly (no dominant share)", () => {
    // Trailer near truck A for the first half, truck B for the second half → neither clears 60% share.
    const trailer = track(40, -80, 60);
    const a: GpsSample[] = trailer.slice(0, 30).map((s) => ({ ...s, lat: s.lat + 0.0004 }));
    const b: GpsSample[] = trailer.slice(30).map((s) => ({ ...s, lat: s.lat + 0.0004 }));
    const r = inferTrailerPairing(trailer, [
      { vehicleId: "A", gps: a },
      { vehicleId: "B", gps: b },
    ]);
    expect(r).toBeNull();
  });

  it("requires an absolute minimum number of co-located samples (ignores a brief pass-by)", () => {
    const trailer = track(40, -80, 5); // only 5 samples
    const trucks: TruckTrack[] = [{ vehicleId: "with", gps: track(40.0005, -80, 5) }];
    expect(inferTrailerPairing(trailer, trucks)).toBeNull(); // < minCoSamples
  });

  it("ignores a truck whose samples are far off in TIME even if co-located in space", () => {
    const trailer = track(40, -80, 60, 0.001, 0); // minutes 0..59
    const trucks: TruckTrack[] = [{ vehicleId: "later", gps: track(40.0005, -80, 60, 0.001, 600) }]; // 10h later
    expect(inferTrailerPairing(trailer, trucks)).toBeNull();
  });
});
