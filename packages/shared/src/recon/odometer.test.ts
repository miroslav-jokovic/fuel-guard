import { describe, it, expect } from "vitest";
import { resolveOdometer } from "./odometer.js";
import type { SamsaraSample } from "../samsara/index.js";

const S = (time: string, odo: number, src: "obd" | "gps"): SamsaraSample => ({
  time,
  lat: 32.78,
  lng: -96.8,
  speedMph: 0,
  address: "Dallas, TX, 75201",
  odometerMiles: odo,
  odometerSource: src,
});

describe("resolveOdometer (S3 — odometer-at-fill module)", () => {
  const samples = [S("2026-06-30T13:50:00Z", 100000, "obd"), S("2026-06-30T14:10:00Z", 100020, "obd")];

  it("returns null when the anchor is NOT trusted (never reads an untrusted moment)", () => {
    expect(resolveOdometer(samples, "2026-06-30T14:00:00Z", false)).toBeNull();
  });

  it("returns null when there is no anchor time", () => {
    expect(resolveOdometer(samples, null, true)).toBeNull();
  });

  it("reads the odometer at the anchor when trusted (interpolated, source preserved)", () => {
    const r = resolveOdometer(samples, "2026-06-30T14:00:00Z", true);
    expect(r).not.toBeNull();
    expect(r!.at).toBe("2026-06-30T14:00:00Z");
    expect(r!.source).toBe("obd");
    expect(r!.miles).toBeGreaterThanOrEqual(100000);
    expect(r!.miles).toBeLessThanOrEqual(100020);
  });

  it("carries the GPS source through when the reading is GPS-derived", () => {
    const gps = [S("2026-06-30T13:50:00Z", 200000, "gps"), S("2026-06-30T14:10:00Z", 200010, "gps")];
    const r = resolveOdometer(gps, "2026-06-30T14:00:00Z", true);
    expect(r!.source).toBe("gps");
  });
});
