import { describe, it, expect } from "vitest";
import {
  metersFromMiles, milesFromMeters, kmFromMiles, milesFromKm,
  cmFromInches, inchesFromCm, inchesFromFeet, kgFromLb, lbFromKg,
  litersFromGallons, gallonsFromLiters,
} from "./units.js";

describe("smartFueling units", () => {
  it("known conversions match HERE-expected values", () => {
    expect(cmFromInches(162)).toBeCloseTo(411.48, 2); // 13'6"
    expect(kgFromLb(80000)).toBeCloseTo(36287.39, 1); // legal max
    expect(litersFromGallons(100)).toBeCloseTo(378.541, 3);
    expect(kmFromMiles(100)).toBeCloseTo(160.9344, 4);
    expect(inchesFromFeet(13.5)).toBe(162);
  });
  it("round-trips within float tolerance (no silent unit drift)", () => {
    for (const v of [0, 1, 53, 411.48, 80000.5]) {
      expect(milesFromMeters(metersFromMiles(v))).toBeCloseTo(v, 9);
      expect(milesFromKm(kmFromMiles(v))).toBeCloseTo(v, 9);
      expect(inchesFromCm(cmFromInches(v))).toBeCloseTo(v, 9);
      expect(lbFromKg(kgFromLb(v))).toBeCloseTo(v, 9);
      expect(gallonsFromLiters(litersFromGallons(v))).toBeCloseTo(v, 9);
    }
  });
});
