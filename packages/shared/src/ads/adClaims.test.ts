import { describe, expect, it } from "vitest";
import { checkClaims } from "./adClaims.js";
import type { AdClaim } from "./contracts.js";

// The opening: $0.68/mile, $1,500/week minimum, $5,000 sign-on, home every 14 days for 2 days, 23+.
const claims: AdClaim[] = [
  { kind: "money", cents: 68, per: "mile" },
  { kind: "money", cents: 150_000, per: "week" },
  { kind: "money", cents: 500_000, per: null },
  { kind: "quantity", value: 14, unit: "day" },
  { kind: "quantity", value: 2, unit: "day" },
  { kind: "quantity", value: 23, unit: "age" },
  { kind: "quantity", value: 1, unit: "year" },
  { kind: "term", term: "sign-on bonus" },
  { kind: "term", term: "home weekends" },
  { kind: "term", term: "401k" },
];
const brief = { claims };
const kinds = (copy: string) => checkClaims(copy, brief).findings.map((f) => `${f.kind}:${f.text}`);

describe("checkClaims — copy that only says what the opening says passes", () => {
  it.each([
    "Earn $0.68/mile with a $1,500/week minimum.",
    "68 cents per mile. $5,000 sign-on bonus.",
    "Home every 14 days, 2 days at home. Must be 23+.",
    "Gana $0.68 por milla y $1,500 por semana. Bono de contratación de $5,000.",
    "Home weekends and a 401(k).",
    "1 year of Class A experience required.",
    "68 CPM, home weekends.",
  ])("%s", (copy) => {
    expect(kinds(copy)).toEqual([]);
  });
});

describe("checkClaims — a planted figure fails, however it is written", () => {
  it.each([
    ["Earn $0.72/mile!", "money_not_in_brief:$0.72"],
    ["Up to $1,800/week.", "money_not_in_brief:$1,800"],
    ["$75k a year.", "money_not_in_brief:$75k"],
    ["72 cents a mile.", "money_not_in_brief:72 cents"],
    ["$0.68 an hour", "money_not_in_brief:$0.68"],
    ["Home every 10 days.", "quantity_not_in_brief:10 days"],
    ["Home every ten days.", "quantity_not_in_brief:ten days"],
    ["Get two weeks off.", "quantity_not_in_brief:two weeks"],
    ["En casa cada diez días.", "quantity_not_in_brief:diez días"],
    ["Must be 21+.", "age_not_in_brief:21+"],
    ["Run 48 states.", "quantity_not_in_brief:48 states"],
    ["Earn up to 85 on every run.", "unrecognised_number:85"],
    ["Call 815-555-0100 today.", "unrecognised_number:815"],
  ])("%s", (copy, expected) => {
    expect(kinds(copy)).toContain(expected);
  });

  it("every leftover digit is reported, so a figure cannot hide inside an unrecognised shape", () => {
    expect(checkClaims("Call 815-555-0100", brief).findings.map((f) => f.text)).toEqual(["815", "555", "0100"]);
  });
});

describe("checkClaims — promises need the brief", () => {
  it("a listed promise the opening does not make is refused", () => {
    expect(kinds("Paid orientation and health insurance.")).toEqual([
      "term_not_in_brief:Paid orientation",
      "term_not_in_brief:health insurance",
    ]);
  });
  it("the Spanish phrasing of an unlisted promise is refused too", () => {
    expect(kinds("Seguro médico incluido.")).toEqual(["term_not_in_brief:Seguro médico"]);
  });
  it("ordinary words are not policed", () => {
    expect(kinds("Join a team that respects your time.")).toEqual([]);
  });
});

describe("checkClaims — forbidden wording, whatever the brief says", () => {
  it.each([
    ["Looking for young, energetic drivers.", "age"],
    ["Recent graduates welcome!", "age"],
    ["Great job for guys who love the road.", "gender"],
    ["Must be healthy.", "health"],
    ["No criminal record.", "criminal_history"],
    ["US citizens only.", "national_origin"],
    ["Buscamos conductores jóvenes.", "age"],
    ["Sin antecedentes penales.", "criminal_history"],
  ])("%s", (copy, rule) => {
    const f = checkClaims(copy, brief).findings.filter((x) => x.kind === "forbidden_wording");
    expect(f.map((x) => x.rule)).toEqual([rule]);
  });
  it("a longer phrase is reported once, not again as the shorter phrase inside it", () => {
    expect(kinds("No criminal record needed")).toEqual(["forbidden_wording:No criminal record"]);
  });
  it("a forbidden phrase's own digits are not reported a second time", () => {
    expect(kinds("Drivers under 40 preferred")).toEqual(["forbidden_wording:under 40"]);
  });
  it("whole words only — 'youngstown' is a place, not an age preference", () => {
    expect(kinds("Yard in Youngstown, OH.")).toEqual([]);
  });
});

describe("checkClaims — reporting", () => {
  it("findings carry the span as written, in order, for the review screen to mark", () => {
    const r = checkClaims("Earn $0.99/mile, home every 9 days.", brief);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => [f.index, f.text])).toEqual([[5, "$0.99"], [28, "9 days"]]);
  });
});
