import { describe, it, expect } from "vitest";
import { anomalyTransitionSchema, thresholdsFormSchema } from "./index.js";

describe("anomalyTransitionSchema", () => {
  it("allows moving to investigating without a note", () => {
    expect(anomalyTransitionSchema.safeParse({ status: "investigating", version: 1 }).success).toBe(true);
  });
  it("requires a note when resolving or dismissing", () => {
    expect(anomalyTransitionSchema.safeParse({ status: "resolved", version: 1 }).success).toBe(false);
    expect(anomalyTransitionSchema.safeParse({ status: "resolved", note: "checked, legit", version: 1 }).success).toBe(true);
  });
  it("rejects an invalid status", () => {
    expect(anomalyTransitionSchema.safeParse({ status: "open", version: 1 }).success).toBe(false);
  });
});

describe("thresholdsFormSchema", () => {
  const base = {
    mpg_drop_pct: 15,
    capacity_tolerance_pct: 5,
    rapid_refuel_hours: 4,
    max_plausible_mph: 85,
    cost_min_per_gal: "",
    cost_max_per_gal: 6,
    disabled_rules: ["off_hours_fueling"],
    ai_verification_enabled: true,
    ai_monthly_token_budget: "",
  };
  it("parses and coerces a valid form, nulling empty optionals", () => {
    const r = thresholdsFormSchema.parse(base);
    expect(r.cost_min_per_gal).toBeNull();
    expect(r.cost_max_per_gal).toBe(6);
    expect(r.ai_monthly_token_budget).toBeNull();
  });
  it("rejects an unknown disabled rule id", () => {
    expect(thresholdsFormSchema.safeParse({ ...base, disabled_rules: ["bogus"] }).success).toBe(false);
  });
  it("bounds percentages", () => {
    expect(thresholdsFormSchema.safeParse({ ...base, mpg_drop_pct: 250 }).success).toBe(false);
  });
});
