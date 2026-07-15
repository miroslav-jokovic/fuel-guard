import { describe, it, expect } from "vitest";
import { effectiveMpg, rangeMilesOnGallons, weightLegalFillGal, legBurnGal, DIESEL_LB_PER_GAL } from "./consumption.js";

describe("consumption", () => {
  it("derates mpg by the safety factor; falls back when missing", () => {
    expect(effectiveMpg(7, 0.9)).toBeCloseTo(6.3, 6);
    expect(effectiveMpg(null, 0.9, 6)).toBeCloseTo(5.4, 6);
  });
  it("range counts reefer burn while driving (shorter than miles-only)", () => {
    const dry = rangeMilesOnGallons(100, { effMpg: 6, idleGalPerHour: 0.8, reeferGalPerHour: 0 }, 55);
    const reefer = rangeMilesOnGallons(100, { effMpg: 6, idleGalPerHour: 0.8, reeferGalPerHour: 0.75 }, 55);
    expect(dry).toBeCloseTo(600, 0);
    expect(reefer).toBeLessThan(dry); // reefer eats into range
  });
  it("weight-legal fill = headroom / lb-per-gal, never negative", () => {
    expect(weightLegalFillGal(72000, 80000)).toBeCloseTo(8000 / DIESEL_LB_PER_GAL, 3);
    expect(weightLegalFillGal(80500, 80000)).toBe(0);
  });
  it("leg burn = driving + reefer + idle", () => {
    expect(legBurnGal(300, 5, 1, { effMpg: 6, idleGalPerHour: 0.8, reeferGalPerHour: 0.75 })).toBeCloseTo(300 / 6 + 5 * 0.75 + 0.8, 6);
  });
});
