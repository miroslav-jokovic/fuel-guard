import { describe, expect, it } from "vitest";
import { checkClaims, promiseTermOf } from "../../ads/adClaims.js";
import { openingOfBrief } from "./leadContract.js";
import { HIRING_PROFILE_V1, type HiringRequirements } from "./hiringProfile.js";
import { openingBrief, type OpeningForBrief } from "./openingBrief.js";

const OPENING: OpeningForBrief = {
  opening_id: "0b6f3c1e-2d4a-4f5b-8c6d-7e8f9a0b1c2d",
  version: 3,
  title: "Class A regional driver",
  facts: { pay: { per: "mile", min_cents: 68, max_cents: 72 }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null },
  area: { label: "Joliet, IL", latitude: 41.525, longitude: -88.0817, radius_miles: 75, reason: "The terminal's daily dispatch radius" },
};
const req = (over: Partial<HiringRequirements> = {}): HiringRequirements => ({ ...HIRING_PROFILE_V1, ...over });

describe("openingBrief — an opening as the ads module's brief (D-AD17)", () => {
  it("the ref is <opening>@v<version> and reads back to the opening", () => {
    const b = openingBrief(OPENING, req());
    expect(b.source).toBe("recruiting_opening");
    expect(b.ref).toBe(`${OPENING.opening_id}@v3`);
    expect(openingOfBrief(b.source, b.ref)).toBe(OPENING.opening_id);
  });

  it("copy stating the opening's pay, age floor, Class A years and home time passes the claim checker", () => {
    const b = openingBrief(OPENING, req());
    const copy = "Earn 68 cents to $0.72/mile, home weekly. 2 years Class A, must be 23+.";
    expect(checkClaims(copy, b).findings).toEqual([]);
  });

  it("a pay figure the opening does not hold is refused by the claim checker", () => {
    const b = openingBrief(OPENING, req());
    expect(checkClaims("Earn 75 cents per mile.", b).findings.length).toBeGreaterThan(0);
  });

  it("a single-figure pay range claims one amount", () => {
    const b = openingBrief({ ...OPENING, facts: { ...OPENING.facts, pay: { per: "week", min_cents: 150000, max_cents: 150000 } } }, req());
    expect(b.claims.filter((c) => c.kind === "money")).toEqual([{ kind: "money", cents: 150000, per: "week" }]);
  });

  it("home time that is not exactly a listed promise is not turned into a term", () => {
    const b = openingBrief({ ...OPENING, facts: { ...OPENING.facts, home_time: "Out 2 weeks, home 3 days" } }, req());
    expect(b.claims.some((c) => c.kind === "term")).toBe(false);
    expect(checkClaims("Home weekly.", b).findings.map((f) => f.kind)).toContain("term_not_in_brief");
  });

  it("the form asks Class A always, years only above a zero floor, hazmat only when required", () => {
    expect(openingBrief(OPENING, req()).form_questions).toEqual(["class_a_held", "class_a_years"]);
    const none = req({ min_class_a_years: { years: 0, reason: "No floor for this opening" }, hazmat: { mode: "required", reason: "Tanker freight is hazmat" } });
    expect(openingBrief(OPENING, none).form_questions).toEqual(["class_a_held", "hazmat_endorsement"]);
    expect(openingBrief(OPENING, none).claims.some((c) => c.kind === "quantity" && c.unit === "year")).toBe(false);
  });

  it("the area is the opening's, unchanged", () => {
    expect(openingBrief(OPENING, req()).area).toEqual(OPENING.area);
  });
});

describe("promiseTermOf — exact phrasings only", () => {
  it("reads a listed phrasing in any case and spacing, English or Spanish", () => {
    expect(promiseTermOf("  Home   Weekly ")).toBe("home weekly");
    expect(promiseTermOf("En casa cada semana")).toBe("home weekly");
  });
  it("text that only mentions a promise is not one", () => {
    expect(promiseTermOf("Home weekly most weeks")).toBeNull();
  });
});
