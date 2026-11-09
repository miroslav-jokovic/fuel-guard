import { describe, expect, it } from "vitest";
import { HIRING_PROFILE_V1, hiringRequirementsSchema } from "../hiringProfile.js";
import { leadMatch, summariseLeadMatch, type LeadMatchVerdict } from "../leadMatch.js";
import { factsFor } from "./index.js";
import { indeedFacts, HOME_TIME_SCREENER_DAYS } from "./indeed.js";
import { metaFacts } from "./meta.js";
import { tenstreetDate, tenstreetFacts, tenstreetProjectionSchema, type TenstreetProjection } from "./tenstreet.js";

/**
 * LQ7 (audit F-LA4): one rule, three readers. Before LQ7 every channel was read through Meta's three catalogue
 * keys, so an Indeed or Tenstreet lead judged as all-unknown. These tests hold each reader to "a fact only when
 * the channel said it, at the evidence the channel earns", and `leadMatch` to judging the new facts the way it
 * judges the old ones.
 */
const AS_OF = "2026-11-09";
const verdict = (vs: LeadMatchVerdict[], r: string) => vs.find((v) => v.requirement === r)!;
const REQ_HOME = hiringRequirementsSchema.parse({ ...HIRING_PROFILE_V1, home_time: { mode: "required", min_days_out: 21, reason: "OTR means three weeks out." } });

const projection = (over: Partial<TenstreetProjection> = {}): TenstreetProjection => tenstreetProjectionSchema.parse({
  date_of_birth: null, licences: [], accidents_asked: false, accidents: [], mvr: {}, custom: {}, ...over,
});

describe("the profile", () => {
  it("home_time defaults to off, so every stored version and v1 parse unchanged and write no home_time verdict", () => {
    const stored = { ...HIRING_PROFILE_V1 } as Record<string, unknown>;
    delete stored.home_time;
    const parsed = hiringRequirementsSchema.parse(stored);
    expect(parsed.home_time.mode).toBe("off");
    expect(leadMatch(parsed, {}, AS_OF).some((v) => v.requirement === "home_time")).toBe(false);
  });
});

describe("metaFacts — today's reader, moved", () => {
  it("reads the three catalogue keys and nothing else", () => {
    const f = metaFacts({ class_a_held: "yes", class_a_years: "2to5", hazmat_endorsement: "No", full_name: "Ray", eligible: "yes" });
    expect(Object.keys(f).sort()).toEqual(["class_a_held", "class_a_years", "hazmat_endorsement"]);
    expect(f.class_a_years).toEqual({ value: { lower: 2, upper: 5, upperInclusive: true }, evidence: "self_reported" });
    expect(f.hazmat_endorsement).toEqual({ value: false, evidence: "self_reported" });
  });
});

describe("indeedFacts — by question id, never by prompt (Q-AD67)", () => {
  it("reads the carrier's screeners: Class A yes/no, hazmat, home time as days out, Class A years as a range", () => {
    const { facts, unmapped } = indeedFacts({ class_a_held: "Yes", hazmat_endorsement: "no", home_time_ok: "yes", class_a_years: "5+" });
    expect(facts.class_a_held).toEqual({ value: true, evidence: "self_reported" });
    expect(facts.hazmat_endorsement).toEqual({ value: false, evidence: "self_reported" });
    expect(facts.willing_days_out).toEqual({ value: HOME_TIME_SCREENER_DAYS, evidence: "self_reported" });
    expect(facts.class_a_years).toEqual({ value: { lower: 5, upper: null, upperInclusive: false }, evidence: "self_reported" });
    expect(unmapped).toEqual([]);
  });

  it("a no to home time is 0 days out, a plain number is an exact range, and an unknown id or unreadable answer is left unmapped", () => {
    const { facts, unmapped } = indeedFacts({ home_time_ok: "No", class_a_years: "3 years", otr_years: "4", class_a_held: "maybe" });
    expect(facts.willing_days_out).toEqual({ value: 0, evidence: "self_reported" });
    expect(facts.class_a_years!.value).toEqual({ lower: 3, upper: 3, upperInclusive: true });
    expect(facts.class_a_held).toBeUndefined();
    expect(unmapped.sort()).toEqual(["class_a_held", "otr_years"]);
  });

  it("the days-out screener takes the opening's own figure when the posting was built with one", () => {
    expect(indeedFacts({ home_time_ok: "yes" }, 14).facts.willing_days_out!.value).toBe(14);
  });
});

describe("tenstreetFacts — the applicant's own answers, DOB into an age, licence at document level when the DQF has it", () => {
  it("reads Tenstreet's US dates and ISO stamps", () => {
    expect([tenstreetDate("10/10/1960"), tenstreetDate("1/9/2010"), tenstreetDate("2011-04-08 14:36:02"), tenstreetDate(""), tenstreetDate("yesterday")])
      .toEqual(["1960-10-10", "2010-01-09", "2011-04-08", null, null]);
  });

  it("a current Class A CDL with HazMat and a 2010 issue date: held, hazmat, and at most 16 years of experience — self-reported unless the DQF has the licence", () => {
    const p = projection({ licences: [{ current: "y", cdl: "y", class: "A", original_issue_date: "2010-10-01", endorsements: ["Tanker", "HazMat", "DoublesTriples"], documented: false }] });
    const { facts } = tenstreetFacts(p, AS_OF);
    expect(facts.class_a_held).toEqual({ value: true, evidence: "self_reported" });
    expect(facts.hazmat_endorsement).toEqual({ value: true, evidence: "self_reported" });
    expect(facts.class_a_years).toEqual({ value: { lower: 0, upper: 16, upperInclusive: true }, evidence: "self_reported" });
    const doc = tenstreetFacts(projection({ licences: [{ ...p.licences[0]!, documented: true }] }), AS_OF).facts;
    expect([doc.class_a_held!.evidence, doc.hazmat_endorsement!.evidence]).toEqual(["document", "document"]);
  });

  it("a non-CDL licence, or a CDL of class B, is not a Class A; no licence section is no fact", () => {
    expect(tenstreetFacts(projection({ licences: [{ current: "y", cdl: "n", class: "A", original_issue_date: null, endorsements: [], documented: false }] }), AS_OF).facts.class_a_held!.value).toBe(false);
    expect(tenstreetFacts(projection({ licences: [{ current: "y", cdl: "y", class: "B", original_issue_date: null, endorsements: [], documented: false }] }), AS_OF).facts.class_a_held!.value).toBe(false);
    expect(tenstreetFacts(projection(), AS_OF).facts.class_a_held).toBeUndefined();
  });

  it("the date of birth becomes an age verdict in leadMatch and is never a stored answer", () => {
    const { facts } = tenstreetFacts(projection({ date_of_birth: "2005-11-10" }), AS_OF);
    const age = verdict(leadMatch(HIRING_PROFILE_V1, facts, AS_OF), "age");
    expect([age.verdict, age.detail.age, age.evidence]).toEqual(["does_not_meet", 20, "self_reported"]);
    expect(verdict(leadMatch(HIRING_PROFILE_V1, tenstreetFacts(projection({ date_of_birth: "1990-01-01" }), AS_OF).facts, AS_OF), "age").verdict).toBe("meets");
  });

  it("MVR answers: a 'n' is a clean fact, a dated 'y' is judged against the window, an undated 'y' stays unknown", () => {
    const clean = tenstreetFacts(projection({ mvr: { ConvictedAlcoholSubstance: { answer: "n", date: null }, PositiveTest: { answer: "n", date: null } } }), AS_OF).facts;
    expect(clean.dui).toEqual({ value: null, evidence: "self_reported" });
    expect(clean.drug_alcohol_unresolved).toEqual({ value: false, evidence: "self_reported" });
    const vs = leadMatch(HIRING_PROFILE_V1, clean, AS_OF);
    expect([verdict(vs, "dui").verdict, verdict(vs, "drug_alcohol").verdict, verdict(vs, "clearinghouse").verdict]).toEqual(["meets", "meets", "unknown"]);

    const old = tenstreetFacts(projection({ mvr: { ConvictedAlcoholSubstance: { answer: "y", date: "2019-03-01" } } }), AS_OF).facts;
    expect(old.dui).toEqual({ value: { cmv: false, years_ago: 7 }, evidence: "self_reported" });
    expect(verdict(leadMatch(HIRING_PROFILE_V1, old, AS_OF), "dui").verdict).toBe("meets");
    const recent = tenstreetFacts(projection({ mvr: { ConvictedAlcoholSubstance: { answer: "y", date: "2023-03-01" } } }), AS_OF).facts;
    expect(verdict(leadMatch(HIRING_PROFILE_V1, recent, AS_OF), "dui").verdict).toBe("does_not_meet");
    const undated = tenstreetFacts(projection({ mvr: { ConvictedAlcoholSubstance: { answer: "y", date: null } } }), AS_OF).facts;
    const u = verdict(leadMatch(HIRING_PROFILE_V1, undated, AS_OF), "dui");
    expect([u.verdict, u.detail.stated]).toEqual(["unknown", "undated"]);
  });

  it("accidents: an empty section is 'none'; a preventable DOT-reportable one is dated to its newest; a non-preventable one is not counted", () => {
    const none = tenstreetFacts(projection({ accidents_asked: true }), AS_OF).facts;
    expect(none.preventable_accident).toEqual({ value: null, evidence: "self_reported" });
    expect(verdict(leadMatch(HIRING_PROFILE_V1, none, AS_OF), "preventable_accident").verdict).toBe("meets");
    const mixed = tenstreetFacts(projection({ accidents_asked: true, accidents: [
      { date: "2008-03-01", dot_reportable: "n", preventable: null, in_commercial_vehicle: "n" },
      // DOT-reportable but NOT preventable, and the newest: must not be the one counted.
      { date: "2026-02-01", dot_reportable: "y", preventable: "n", in_commercial_vehicle: "y" },
      { date: "2021-06-01", dot_reportable: "y", preventable: "y", in_commercial_vehicle: "y" },
      { date: "2025-01-15", dot_reportable: "y", preventable: "y", in_commercial_vehicle: "y" },
    ] }), AS_OF).facts;
    expect(mixed.preventable_accident).toEqual({ value: { years_ago: 1 }, evidence: "self_reported" });
    // Preventable but not DOT-reportable is not the rule's accident either.
    expect(tenstreetFacts(projection({ accidents_asked: true, accidents: [{ date: "2025-06-01", dot_reportable: "n", preventable: "y", in_commercial_vehicle: "y" }] }), AS_OF).facts.preventable_accident)
      .toEqual({ value: null, evidence: "self_reported" });
    expect(verdict(leadMatch(HIRING_PROFILE_V1, mixed, AS_OF), "preventable_accident").verdict).toBe("does_not_meet");
    expect(tenstreetFacts(projection(), AS_OF).facts.preventable_accident).toBeUndefined();
  });

  it("the carrier's home-time custom question maps by id; any other custom question is unmapped", () => {
    const { facts, unmapped } = tenstreetFacts(projection({ custom: { HomeTimeOk: "y", EligibleToWorkInUS: "y" } }), AS_OF);
    expect(facts.willing_days_out).toEqual({ value: 21, evidence: "self_reported" });
    expect(unmapped).toEqual(["EligibleToWorkInUS"]);
  });
});

describe("leadMatch judges home_time like hazmat", () => {
  it("off writes nothing; required judges hard; preferred judges soft; absent fact is unknown", () => {
    expect(leadMatch(HIRING_PROFILE_V1, { willing_days_out: { value: 21, evidence: "self_reported" } }, AS_OF).some((v) => v.requirement === "home_time")).toBe(false);
    const hard = verdict(leadMatch(REQ_HOME, { willing_days_out: { value: 0, evidence: "self_reported" } }, AS_OF), "home_time");
    expect([hard.verdict, hard.hard, hard.detail]).toEqual(["does_not_meet", true, { min_days_out: 21, stated: 0 }]);
    expect(verdict(leadMatch(REQ_HOME, { willing_days_out: { value: 21, evidence: "self_reported" } }, AS_OF), "home_time").verdict).toBe("meets");
    expect(verdict(leadMatch(REQ_HOME, {}, AS_OF), "home_time").verdict).toBe("unknown");
    const soft = hiringRequirementsSchema.parse({ ...REQ_HOME, home_time: { ...REQ_HOME.home_time, mode: "preferred" } });
    expect(verdict(leadMatch(soft, { willing_days_out: { value: 0, evidence: "self_reported" } }, AS_OF), "home_time").hard).toBe(false);
  });

  it("a Meta lead is unchanged: the same eight verdicts as before LQ7, every disqualifier unknown", () => {
    const vs = leadMatch(HIRING_PROFILE_V1, metaFacts({ class_a_held: "yes" }), AS_OF);
    expect(vs.map((v) => v.requirement)).toEqual(["age", "class_a", "class_a_experience", "hazmat", "dui", "preventable_accident", "clearinghouse", "drug_alcohol"]);
    expect(vs.filter((v) => v.verdict === "unknown").map((v) => v.requirement)).toEqual(["age", "class_a_experience", "hazmat", "dui", "preventable_accident", "clearinghouse", "drug_alcohol"]);
  });
});

describe("factsFor — the channel picks the reader", () => {
  it("meta and simulator read the catalogue; indeed the screeners; tenstreet its projection; a manual or unknown channel nothing", () => {
    expect(factsFor("meta", { class_a_held: "yes" }, AS_OF).class_a_held?.value).toBe(true);
    expect(factsFor("simulator", { class_a_held: "no" }, AS_OF).class_a_held?.value).toBe(false);
    expect(factsFor("indeed", { home_time_ok: "yes" }, AS_OF).willing_days_out?.value).toBe(21);
    const p = projection({ date_of_birth: "1980-05-05" });
    expect(factsFor("tenstreet", { projection: JSON.stringify(p) }, AS_OF).date_of_birth?.value).toBe("1980-05-05");
    expect(factsFor("phone_call", { class_a_held: "yes" }, AS_OF)).toEqual({});
    expect(factsFor("craigslist", { class_a_held: "yes" }, AS_OF)).toEqual({});
  });

  it("a tenstreet lead whose projection is missing, not JSON, or off the schema yields no facts — never a guess", () => {
    expect(factsFor("tenstreet", {}, AS_OF)).toEqual({});
    expect(factsFor("tenstreet", { projection: "{not json" }, AS_OF)).toEqual({});
    expect(factsFor("tenstreet", { projection: JSON.stringify({ date_of_birth: "10/10/1960" }) }, AS_OF)).toEqual({});
  });

  it("a Tenstreet applicant with a clean MVR, a documented Class A and 21 days out meets more than any form lead can", () => {
    const p = projection({
      date_of_birth: "1985-02-02", accidents_asked: true,
      licences: [{ current: "y", cdl: "y", class: "A", original_issue_date: "2015-01-01", endorsements: ["HazMat"], documented: true }],
      mvr: { ConvictedAlcoholSubstance: { answer: "n", date: null }, PositiveTest: { answer: "n", date: null } }, custom: { HomeTimeOk: "y" },
    });
    const s = summariseLeadMatch(leadMatch(REQ_HOME, factsFor("tenstreet", { projection: JSON.stringify(p) }, AS_OF), AS_OF));
    // age, class_a, hazmat, home_time, dui, preventable_accident, drug_alcohol meet; class_a_experience needs verification; clearinghouse unknown.
    expect(s).toEqual({ hardUnmet: 0, unknown: 2, met: 7 });
  });
});
