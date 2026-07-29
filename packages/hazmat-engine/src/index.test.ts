import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  loadInputSchema,
  computePlacards,
  validateBol,
  checkEligibility,
  checkSegregation,
  evaluateLoad,
  NotImplementedError,
  type HazmatDataset,
} from "./index";

const DATA: HazmatDataset = { version: "0.0.0-test", entries: [] };
const load = loadInputSchema.parse({ evaluatedAt: "2026-07-29T00:00:00Z" });

describe("@hazmat/engine skeleton (H0)", () => {
  it("exports a semver engine version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("parses a minimal load input, applying fail-safe defaults", () => {
    expect(load.grossWeightLb).toBeNull();
    expect(load.soleProductInTrailer).toBeNull();
    expect(load.isPortPickupOrDelivery).toBeNull();
    expect(load.lines).toEqual([]);
  });

  it("fails closed: every entry point throws NotImplementedError until H1–H3", () => {
    expect(() => computePlacards(load, DATA)).toThrow(NotImplementedError);
    expect(() => validateBol(load, DATA)).toThrow(NotImplementedError);
    expect(() => checkEligibility(load, DATA)).toThrow(NotImplementedError);
    expect(() => checkSegregation(load, DATA)).toThrow(NotImplementedError);
    expect(() => evaluateLoad(load, DATA)).toThrow(NotImplementedError);
  });
});
