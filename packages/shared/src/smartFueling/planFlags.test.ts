import { describe, it, expect } from "vitest";
import { PLAN_FLAG_COPY, planFlagCopy } from "./planFlags.js";

describe("plan flags", () => {
  it("every flag has a sentence a dispatcher can read", () => {
    for (const [flag, copy] of Object.entries(PLAN_FLAG_COPY)) {
      expect(copy.length, flag).toBeGreaterThan(20);
      expect(copy.endsWith("."), flag).toBe(true);
    }
  });
  it("an unknown flag from an older saved plan renders as its code rather than nothing", () => {
    expect(planFlagCopy("hos_limited")).toBe("hos_limited");
    expect(planFlagCopy("stale_fuel_reading")).toBe(PLAN_FLAG_COPY.stale_fuel_reading);
  });
});
