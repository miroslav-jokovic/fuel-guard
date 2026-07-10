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

  it("pairs a reefer that was HAULED then PARKED — parked-alone time doesn't dilute the hauler", () => {
    const moving = Array.from({ length: 30 }, (_, i) => ({ t: i * 60_000, lat: 40, lng: -80 + i * 0.001, speedMph: 60 }));
    const parked = Array.from({ length: 40 }, (_, i) => ({ t: (200 + i) * 60_000, lat: 41.5, lng: -83, speedMph: 0 }));
    const truckA = moving.map((s) => ({ t: s.t, lat: s.lat + 0.0003, lng: s.lng, speedMph: 60 }));
    const r = inferTrailerPairing([...moving, ...parked], [{ vehicleId: "A", gps: truckA }]);
    expect(r?.vehicleId).toBe("A"); // old logic (share over all samples = 30/70) would have failed
  });

  it("prefers the truck it MOVED with over one merely parked next to it in a yard", () => {
    const moving = Array.from({ length: 30 }, (_, i) => ({ t: i * 60_000, lat: 40, lng: -80 + i * 0.001, speedMph: 60 }));
    const parked = Array.from({ length: 50 }, (_, i) => ({ t: (100 + i) * 60_000, lat: 41, lng: -85, speedMph: 0 }));
    const truckA = moving.map((s) => ({ t: s.t, lat: s.lat + 0.0003, lng: s.lng, speedMph: 60 })); // hauls it
    const truckB = parked.map((s) => ({ t: s.t, lat: 41.0003, lng: -85, speedMph: 0 })); // parked beside it, not hauling
    const r = inferTrailerPairing([...moving, ...parked], [{ vehicleId: "A", gps: truckA }, { vehicleId: "B", gps: truckB }]);
    expect(r?.vehicleId).toBe("A");
  });
});
