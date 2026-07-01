import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  impliedSpeedMph,
  shouldEscalate,
  shouldVerify,
  withinBudget,
  aiInputHash,
  aiOutputSchema,
  type AiVerificationContext,
} from "./index.js";

describe("haversineMiles", () => {
  it("computes a known distance (Chicago→NYC ≈ 711 mi)", () => {
    const d = haversineMiles(41.8781, -87.6298, 40.7128, -74.006);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(720);
  });
  it("is ~0 for identical points", () => {
    expect(haversineMiles(40, -80, 40, -80)).toBeCloseTo(0, 5);
  });
});

describe("impliedSpeedMph", () => {
  it("computes mph and rounds", () => {
    expect(impliedSpeedMph(700, 2)).toBe(350);
  });
  it("returns null for non-positive hours", () => {
    expect(impliedSpeedMph(700, 0)).toBeNull();
  });
});

describe("escalation + triggers", () => {
  it("escalates on high/critical or needs_deeper_review", () => {
    expect(shouldEscalate({ risk_level: "high", needs_deeper_review: false })).toBe(true);
    expect(shouldEscalate({ risk_level: "low", needs_deeper_review: true })).toBe(true);
    expect(shouldEscalate({ risk_level: "low", needs_deeper_review: false })).toBe(false);
  });
  it("verifies only when severity ≥ medium", () => {
    expect(shouldVerify("medium")).toBe(true);
    expect(shouldVerify("critical")).toBe(true);
    expect(shouldVerify("low")).toBe(false);
    expect(shouldVerify(null)).toBe(false);
  });
  it("respects the token budget", () => {
    expect(withinBudget(900, 1000)).toBe(true);
    expect(withinBudget(1000, 1000)).toBe(false);
    expect(withinBudget(999_999, null)).toBe(true);
  });
});

const ctx: AiVerificationContext = {
  vehicle: { unit: "T-101", fuel_type: "diesel", tank_capacity_gal: 120, baseline_mpg: 6.4 },
  transaction: {
    fueled_at: "2026-06-21T14:05:00-05:00",
    odometer: 184230,
    gallons: 119.6,
    price_per_gal: 3.91,
    total_cost: 467.6,
    station: { name: "Loves #221", city: "Effingham", state: "IL", lat: null, lng: null },
  },
  rules_fired: [{ ruleId: "exceeds_tank_capacity", severity: "critical", message: "over tank" }],
  recent_transactions: [],
  implied_speed_mph: null,
  operating_hours: { start: "05:00", end: "20:00", tz: "America/Chicago" },
  attribution: { attributed: true, vehicle_unit: "T-101", efs_unit_text: "101", driver_name: "Sam Diaz" },
  cross_source: { samsara_odometer: 184228, location_matched: true, tank_short_gal: null, reconciled_at: null },
};

describe("aiInputHash", () => {
  it("is deterministic and changes with content", () => {
    expect(aiInputHash(ctx)).toBe(aiInputHash(JSON.parse(JSON.stringify(ctx)) as AiVerificationContext));
    const other = { ...ctx, transaction: { ...ctx.transaction, gallons: 50 } };
    expect(aiInputHash(other)).not.toBe(aiInputHash(ctx));
  });
});

describe("aiOutputSchema", () => {
  const valid = {
    risk_score: 88,
    risk_level: "critical",
    location_assessment: { plausible: true, reason: "ok", implied_speed_mph: null },
    summary: "Over-capacity fill on a 120 gal tank.",
    recommended_action: "investigate",
    contributing_factors: ["over capacity"],
    needs_deeper_review: false,
    confidence: 0.82,
  };
  it("accepts a well-formed response", () => {
    expect(aiOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an out-of-range score or bad action", () => {
    expect(aiOutputSchema.safeParse({ ...valid, risk_score: 150 }).success).toBe(false);
    expect(aiOutputSchema.safeParse({ ...valid, recommended_action: "delete" }).success).toBe(false);
  });
});
