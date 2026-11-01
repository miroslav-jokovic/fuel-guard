import { describe, expect, it } from "vitest";
import { adAreaSchema, adBriefSchema, adClaimSchema } from "./contracts.js";

const area = { label: "Joliet yard", latitude: 41.525, longitude: -88.08, radius_miles: 15, reason: "Drivers who can reach the yard daily" };
const brief = {
  source: "recruiting_opening", ref: "op-1@v3", subject: "Class A regional driver",
  claims: [{ kind: "money", cents: 68, per: "mile" }, { kind: "quantity", value: 2, unit: "day" }, { kind: "term", term: "home weekly" }],
  area, form_questions: ["class_a", "years_class_a"], landing_url: null,
};

describe("ads contracts", () => {
  it("a brief with claims, an area and form questions parses", () => {
    expect(adBriefSchema.parse(brief)).toEqual(brief);
  });
  it("an area under Meta's 15-mile employment floor is refused, and 15 itself is allowed", () => {
    expect(adAreaSchema.safeParse({ ...area, radius_miles: 14 }).success).toBe(false);
    expect(adAreaSchema.safeParse(area).success).toBe(true);
  });
  it("an area with no written reason is refused", () => {
    expect(adAreaSchema.safeParse({ ...area, reason: "   " }).success).toBe(false);
  });
  it("there is no field to target by age, gender or ZIP — unknown keys are dropped, never stored", () => {
    const parsed = adAreaSchema.parse({ ...area, zip_codes: ["60431"], age_min: 25, gender: "male" });
    expect(Object.keys(parsed).sort()).toEqual(["label", "latitude", "longitude", "radius_miles", "reason"]);
  });
  it("a brief with no claims has nothing the copy may say, and is refused", () => {
    expect(adBriefSchema.safeParse({ ...brief, claims: [] }).success).toBe(false);
  });
  it("a money claim is whole cents, positive", () => {
    expect(adClaimSchema.safeParse({ kind: "money", cents: 0.5, per: "mile" }).success).toBe(false);
    expect(adClaimSchema.safeParse({ kind: "money", cents: 0, per: null }).success).toBe(false);
  });
  it("a landing page must be https", () => {
    expect(adBriefSchema.safeParse({ ...brief, landing_url: "http://example.com/apply" }).success).toBe(false);
    expect(adBriefSchema.safeParse({ ...brief, landing_url: "https://example.com/apply" }).success).toBe(true);
  });
});
