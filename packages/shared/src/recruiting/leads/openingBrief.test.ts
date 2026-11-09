import { describe, expect, it } from "vitest";
import { checkClaims, promiseTermOf } from "../../ads/adClaims.js";
import { openingOfBrief } from "./leadContract.js";
import { HIRING_PROFILE_V1, type HiringRequirements } from "./hiringProfile.js";
import { openingBrief, openingSubjectMatter, type OpeningForBrief } from "./openingBrief.js";
import { OPENING_BENEFIT_TERMS, openingFactsSchema } from "./opening.js";

const OPENING: OpeningForBrief = {
  opening_id: "0b6f3c1e-2d4a-4f5b-8c6d-7e8f9a0b1c2d",
  version: 3,
  title: "Class A regional driver",
  facts: {
    pay: { per: "mile", min_cents: 68, max_cents: 72 }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null,
    benefits: [], bonus: null, schedule: null, in_our_words: null,
  },
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

describe("openingBrief — the job, not only its figures (CQ2, D-AD20)", () => {
  const rich: OpeningForBrief = {
    ...OPENING,
    facts: {
      ...OPENING.facts, equipment: ["flatbed", "reefer"], lanes: "Midwest to the Southeast", schedule: "regional",
      benefits: ["401k", "no-touch freight", "paid orientation"], bonus: { kind: "sign-on bonus", cents: 300000 },
      in_our_words: "Family-run since the eighties; dispatch answers the phone.",
    },
  };

  it("a ticked benefit and a bonus with its amount become claims the copy may state", () => {
    const b = openingBrief(rich, req());
    expect(b.claims).toEqual(expect.arrayContaining([
      { kind: "money", cents: 300000, per: null }, { kind: "term", term: "sign-on bonus" },
      { kind: "term", term: "401k" }, { kind: "term", term: "no-touch freight" }, { kind: "term", term: "paid orientation" },
    ]));
    expect(checkClaims("A $3,000 sign-on bonus, 401k and no-touch freight. Paid orientation.", b).findings).toEqual([]);
  });

  it("an unticked benefit is still refused: the box is the only way a promise enters", () => {
    const b = openingBrief(rich, req());
    expect(checkClaims("Health insurance from day one.", b).findings.map((f) => f.kind)).toEqual(["term_not_in_brief"]);
  });

  it("equipment, schedule, lanes and the carrier's line reach the brief as subject matter, never as claims", () => {
    const b = openingBrief(rich, req());
    expect(b.subject_matter).toEqual({
      details: ["flatbed and reefer freight", "regional runs", "Midwest to the Southeast"],
      in_our_words: "Family-run since the eighties; dispatch answers the phone.",
    });
    expect(b.claims.some((c) => c.kind === "term" && /flatbed|regional|Midwest/.test(c.term))).toBe(false);
  });

  it("home time that is not a listed term is subject matter; a listed term is a claim and not repeated there", () => {
    expect(openingSubjectMatter({ ...OPENING.facts, home_time: "Out 12 days, home 3" }).details).toContain("Out 12 days, home 3");
    expect(openingSubjectMatter(OPENING.facts).details).not.toContain("Home weekly");
  });

  it("the benefit boxes are every PROMISE_TERMS key except home time and the bonuses — derived, not restated", () => {
    expect(OPENING_BENEFIT_TERMS).toContain("401k");
    expect(OPENING_BENEFIT_TERMS).toContain("dedicated");
    expect(OPENING_BENEFIT_TERMS.some((k) => k.startsWith("home "))).toBe(false);
    expect(OPENING_BENEFIT_TERMS).not.toContain("sign-on bonus");
  });

  it("a version saved before CQ2 still parses, with the new fields empty", () => {
    const parsed = openingFactsSchema.safeParse({ pay: { per: "mile", min_cents: 68, max_cents: null }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ benefits: [], bonus: null, schedule: null, in_our_words: null });
  });

  it("the carrier's own line may not carry a figure or a promise the opening's fields do not hold", () => {
    const base = { pay: { per: "mile" as const, min_cents: 68, max_cents: null }, home_time: "Home weekly", equipment: ["dry_van" as const], lanes: null, start_date: null };
    const bad = openingFactsSchema.safeParse({ ...base, in_our_words: "A $5,000 sign-on bonus and health insurance." });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["in_our_words", '"$5,000" is a figure the pay and bonus fields do not hold; put it there or leave it out.'],
      ["in_our_words", '"sign-on bonus" is a promise; tick it under benefits or leave it out.'],
      ["in_our_words", '"health insurance" is a promise; tick it under benefits or leave it out.'],
    ]);
    const good = openingFactsSchema.safeParse({ ...base, bonus: { kind: "sign-on bonus", cents: 500000 }, benefits: ["health insurance"], in_our_words: "A $5,000 sign-on bonus and health insurance." });
    expect(good.success).toBe(true);
  });
});

describe("openingBrief — figures a person typed into home time or lanes are claims (CQ2)", () => {
  it("'Out 2 weeks, home 4 days' lets the copy say 2 weeks and 4 days, and nothing else", () => {
    const b = openingBrief({ ...OPENING, facts: { ...OPENING.facts, home_time: "Out 2 weeks, home 4 days", lanes: "Within 500 miles of Joliet" } }, req());
    expect(b.claims).toEqual(expect.arrayContaining([{ kind: "quantity", value: 2, unit: "week" }, { kind: "quantity", value: 4, unit: "day" }, { kind: "quantity", value: 500, unit: "mile" }]));
    expect(checkClaims("Out two weeks, home 4 days, within 500 miles.", b).findings).toEqual([]);
    expect(checkClaims("Out 3 weeks.", b).findings.map((f) => f.kind)).toEqual(["quantity_not_in_brief"]);
  });
  it("a listed home-time term is a term claim and its words are not read as quantities", () => {
    const b = openingBrief(OPENING, req());
    expect(b.claims.filter((c) => c.kind === "quantity" && c.unit === "week")).toEqual([]);
  });
});

describe("openingBrief — a typed detail may be repeated word for word (CQ2)", () => {
  it("'Out 10 to 12 days, home 3' is a range of days plus a bare number: the range is claims, the whole phrase is vouched for", () => {
    const b = openingBrief({ ...OPENING, facts: { ...OPENING.facts, home_time: "Out 10 to 12 days, home 3" } }, req());
    expect(b.claims).toEqual(expect.arrayContaining([{ kind: "quantity", value: 10, unit: "day" }, { kind: "quantity", value: 12, unit: "day" }]));
    expect(b.subject_matter.details).toContain("Out 10 to 12 days, home 3");
    // The checker alone still refuses the bare 3; the copywriter's judge, which vouches for the details, does not.
    expect(checkClaims("Out 10 to 12 days, home 3.", b).findings.map((f) => f.text)).toEqual(["3"]);
    expect(checkClaims("Out 10 to 12 days, home 3.", { ...b, exempt_phrases: b.subject_matter.details }).findings).toEqual([]);
    expect(checkClaims("Home 3.", { ...b, exempt_phrases: b.subject_matter.details }).findings.map((f) => f.kind)).toEqual(["unrecognised_number"]);
  });
});
