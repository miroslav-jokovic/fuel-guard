import { describe, it, expect } from "vitest";
import { isReliableCardRef } from "./fuel.js";
import { derivePricePerGal, computeFillUpWarnings, fillUpInputSchema } from "./index.js";

describe("derivePricePerGal (audit L3)", () => {
  it("computes total / gallons rounded to 3 decimals", () => {
    expect(derivePricePerGal(100, 389.9)).toBe(3.899);
  });
  it("returns null when total is missing or gallons is zero", () => {
    expect(derivePricePerGal(100, null)).toBeNull();
    expect(derivePricePerGal(0, 100)).toBeNull();
  });
});

describe("computeFillUpWarnings (audit M10)", () => {
  const base = { tankCapacityGal: 120, fuelType: "diesel" as const, lastOdometer: 184000 };

  it("flags an odometer below the last reading", () => {
    const w = computeFillUpWarnings({ ...base, gallons: 90, odometer: 183900 });
    expect(w.odometerBelowLast).toBe(true);
    expect(w.exceedsCapacity).toBe(false);
    expect(w.odometerMissing).toBe(false);
  });

  it("flags a missing odometer", () => {
    const w = computeFillUpWarnings({ ...base, gallons: 90, odometer: undefined });
    expect(w.odometerMissing).toBe(true);
  });

  it("flags gallons over tank capacity", () => {
    const w = computeFillUpWarnings({ ...base, gallons: 150, odometer: 184100 });
    expect(w.exceedsCapacity).toBe(true);
  });

  it("does not flag capacity for a clean fill", () => {
    const w = computeFillUpWarnings({ ...base, gallons: 90, odometer: 184100 });
    expect(w.exceedsCapacity).toBe(false);
    expect(w.odometerBelowLast).toBe(false);
  });
});

describe("fillUpInputSchema", () => {
  const valid = {
    id: "11111111-1111-4111-8111-111111111111",
    vehicle_id: "22222222-2222-4222-8222-222222222222",
    fueled_at: "2026-06-30T12:00:00.000Z",
    gallons: 95.5,
    total_cost: 372.5,
  };

  it("accepts a valid fill-up and coerces numbers", () => {
    const r = fillUpInputSchema.parse({ ...valid, gallons: "95.5" });
    expect(r.gallons).toBe(95.5);
  });
  it("requires a positive gallons value", () => {
    expect(fillUpInputSchema.safeParse({ ...valid, gallons: 0 }).success).toBe(false);
  });
  it("requires a vehicle", () => {
    expect(fillUpInputSchema.safeParse({ ...valid, vehicle_id: "" }).success).toBe(false);
  });
  it("allows a missing odometer (warned, not blocked)", () => {
    expect(fillUpInputSchema.safeParse(valid).success).toBe(true);
  });
});

describe("isReliableCardRef", () => {
  it("accepts full numbers and real fleet card numbers", () => {
    expect(isReliableCardRef("7083440000094507")).toBe(true);
    expect(isReliableCardRef("94507")).toBe(true);
  });
  it("rejects a bare last-4, masked PANs, and empty", () => {
    expect(isReliableCardRef("1234")).toBe(false);       // last-4 only
    expect(isReliableCardRef("****1234")).toBe(false);   // masked
    expect(isReliableCardRef("7083XXXX1234")).toBe(false);
    expect(isReliableCardRef(null)).toBe(false);
    expect(isReliableCardRef("")).toBe(false);
  });
});
