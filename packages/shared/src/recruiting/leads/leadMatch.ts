import type { HiringRequirements } from "./hiringProfile.js";

/**
 * `leadMatch`: a lead against a hiring profile, requirement by requirement (RECRUITER-AUTOMATION-PLAN 3.1;
 * D-RA3 "rules decide, the model reads"; D-LS2, D-LS3, D-LS4). Pure — no clock (the caller passes `asOf`),
 * no model, no I/O (`lint:boundaries`). Each verdict is one `lead_match_verdicts` row (0553).
 *
 * ── THREE ANSWERS, AND WHAT `unknown` MEANS ──────────────────────────────────────────────────────
 * `meets` / `does_not_meet` stand on a fact, and every fact carries its evidence level
 * (`self_reported | document | verified`; 0553 refuses a non-`unknown` verdict without one). `unknown`
 * is not a fail: it is the next question to ask on the call (D-LS3), and nothing here rejects anybody.
 *
 * ── WHY A META LEAD IS `unknown` ON AGE AND EVERY DISQUALIFIER ───────────────────────────────────
 * Meta's employment rules forbid an Instant Form to ask age, criminal history, licence numbers or health
 * (ADS-AGENT-PLAN §1). Those facts arrive with the application, as documents. So for a META lead the four
 * disqualifiers are `unknown` by construction and age is `unknown` without a date of birth. Since LQ7 the
 * facts come from a per-channel reader (`facts/`): a Tenstreet application carries the applicant's DOB, licence
 * and MVR/criminal answers, and those are judged here when present — the rule is one, the inputs differ.
 *
 * ── WHY SELF-REPORTED EXPERIENCE NEVER MEETS ─────────────────────────────────────────────────────
 * The owner ruled the experience requirement "verifiable" (Q-RA7b): a person's own "2 to 5 years" leaves
 * it `unknown` until an employer reply or the MVR confirms it. One asymmetry, written down: when the
 * person's own answer lies ENTIRELY below the requirement ("less than 1 year" against 2), the verdict is
 * `does_not_meet`, self-reported — they told us, and asking again on the call would be the wrong question.
 * An answer that straddles it ("1 to 2 years" against 2) stays `unknown`.
 */

export const LEAD_REQUIREMENTS = [
  "age", "class_a", "class_a_experience", "hazmat", "home_time",
  "dui", "preventable_accident", "clearinghouse", "drug_alcohol",
] as const;
export type LeadRequirement = (typeof LEAD_REQUIREMENTS)[number];

export const EVIDENCE_LEVELS = ["self_reported", "document", "verified"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type Verdict = "meets" | "does_not_meet" | "unknown";

export interface LeadMatchVerdict {
  requirement: LeadRequirement;
  /** A preference sorts; only a hard requirement decides the first sort key (`compareLeadMatch`). */
  hard: boolean;
  verdict: Verdict;
  evidence: EvidenceLevel | null;
  detail: Record<string, unknown>;
}

/** A stated range of years. `upper` null = open-ended ("more than 5"); `upperInclusive` false = "less than". */
export interface YearsRange {
  lower: number;
  upper: number | null;
  upperInclusive: boolean;
}
interface Fact<T> {
  value: T;
  evidence: EvidenceLevel;
}
/**
 * What a channel's reader could establish about a lead (LQ7: `facts/meta.ts`, `facts/indeed.ts`,
 * `facts/tenstreet.ts` — each pure, each an answer-to-fact translation and nothing more). A fact absent here is
 * `unknown` downstream; a reader never guesses one. Every fact carries its evidence level, so a Tenstreet DQF
 * licence (`document`) and a form tick (`self_reported`) are told apart by the verdict, not by the channel.
 */
export interface LeadFacts {
  date_of_birth?: Fact<string>;
  class_a_held?: Fact<boolean>;
  class_a_years?: Fact<YearsRange>;
  hazmat_endorsement?: Fact<boolean>;
  /** Consecutive days out the person says they will do (Indeed "3 weeks" = 21; a Tenstreet custom question). */
  willing_days_out?: Fact<number>;
  /** An alcohol/substance driving conviction — `null` = none reported; else in a CMV?, and how many years ago (`null` = undated). */
  dui?: Fact<null | { cmv: boolean; years_ago: number | null }>;
  /** A preventable DOT-recordable accident — `null` = none reported; else how many years ago (`null` = undated). */
  preventable_accident?: Fact<null | { years_ago: number | null }>;
  clearinghouse_prohibited?: Fact<boolean>;
  /** A positive or refused test with no return-to-duty on record. */
  drug_alcohol_unresolved?: Fact<boolean>;
}

/** The catalogue's buckets (`META_FORM_CATALOGUE.class_a_years`) as ranges. */
export const CLASS_A_YEAR_BUCKETS: Readonly<Record<string, YearsRange>> = {
  lt1: { lower: 0, upper: 1, upperInclusive: false },
  "1to2": { lower: 1, upper: 2, upperInclusive: true },
  "2to5": { lower: 2, upper: 5, upperInclusive: true },
  "5plus": { lower: 5, upper: null, upperInclusive: false },
};

/** Whole years between two calendar dates (YYYY-MM-DD), birthday-exact; null for an unreadable date. */
export function ageOn(dateOfBirth: string, asOf: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!b || !a) return null;
  const by = Number(b[1]), bm = Number(b[2]), bd = Number(b[3]);
  const ay = Number(a[1]), am = Number(a[2]), ad = Number(a[3]);
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

const unknown = (requirement: LeadRequirement, hard: boolean, detail: Record<string, unknown> = {}): LeadMatchVerdict =>
  ({ requirement, hard, verdict: "unknown", evidence: null, detail });
const judged = (requirement: LeadRequirement, hard: boolean, ok: boolean, evidence: EvidenceLevel,
  detail: Record<string, unknown> = {}): LeadMatchVerdict =>
  ({ requirement, hard, verdict: ok ? "meets" : "does_not_meet", evidence, detail });

/** Entirely below `years`: the range's top is under it (or equal to it, when the top is exclusive). */
const entirelyBelow = (r: YearsRange, years: number): boolean =>
  r.upper !== null && (r.upperInclusive ? r.upper < years : r.upper <= years);

export function leadMatch(req: HiringRequirements, facts: LeadFacts, asOf: string): LeadMatchVerdict[] {
  const out: LeadMatchVerdict[] = [];

  const age = facts.date_of_birth ? ageOn(facts.date_of_birth.value, asOf) : null;
  out.push(age === null || !facts.date_of_birth
    ? unknown("age", true, { min_years: req.min_age.years })
    : judged("age", true, age >= req.min_age.years, facts.date_of_birth.evidence, { min_years: req.min_age.years, age }));

  out.push(facts.class_a_held
    ? judged("class_a", true, facts.class_a_held.value, facts.class_a_held.evidence)
    : unknown("class_a", true));

  const exp = facts.class_a_years;
  const min = req.min_class_a_years.years;
  if (!exp) out.push(unknown("class_a_experience", true, { min_years: min }));
  else if (exp.evidence === "verified") {
    out.push(judged("class_a_experience", true, exp.value.lower >= min, "verified", { min_years: min, stated: exp.value }));
  } else if (entirelyBelow(exp.value, min)) {
    out.push(judged("class_a_experience", true, false, exp.evidence, { min_years: min, stated: exp.value }));
  } else {
    out.push(unknown("class_a_experience", true, { min_years: min, stated: exp.value, needs: "verification" }));
  }

  if (req.hazmat.mode !== "off") {
    const hard = req.hazmat.mode === "required";
    out.push(facts.hazmat_endorsement
      ? judged("hazmat", hard, facts.hazmat_endorsement.value, facts.hazmat_endorsement.evidence)
      : unknown("hazmat", hard));
  }

  if (req.home_time.mode !== "off") {
    const hard = req.home_time.mode === "required";
    const w = facts.willing_days_out;
    out.push(w
      ? judged("home_time", hard, w.value >= req.home_time.min_days_out, w.evidence, { min_days_out: req.home_time.min_days_out, stated: w.value })
      : unknown("home_time", hard, { min_days_out: req.home_time.min_days_out }));
  }

  // The disqualifiers (Q-RA7d). Present only when a channel asked them (Tenstreet's MVR/criminal questions);
  // a Meta lead has none and every one stays `unknown`, as before. A date the person did not give cannot clear
  // a window — a DUI "ever" in a CMV is a miss regardless, and an undated one in any vehicle stays `unknown`.
  const d = req.disqualifiers;
  const dui = facts.dui;
  if (!dui) out.push(unknown("dui", true, { any_vehicle_years: d.dui_any_vehicle_years, cmv: "ever" }));
  else if (dui.value === null) out.push(judged("dui", true, true, dui.evidence, { any_vehicle_years: d.dui_any_vehicle_years, stated: "none" }));
  else if (dui.value.cmv) out.push(judged("dui", true, false, dui.evidence, { any_vehicle_years: d.dui_any_vehicle_years, cmv: true, years_ago: dui.value.years_ago }));
  else if (dui.value.years_ago === null) out.push(unknown("dui", true, { any_vehicle_years: d.dui_any_vehicle_years, stated: "undated" }));
  else out.push(judged("dui", true, dui.value.years_ago >= d.dui_any_vehicle_years, dui.evidence, { any_vehicle_years: d.dui_any_vehicle_years, years_ago: dui.value.years_ago }));

  const acc = facts.preventable_accident;
  if (!acc) out.push(unknown("preventable_accident", true, { years: d.preventable_accident_years }));
  else if (acc.value === null) out.push(judged("preventable_accident", true, true, acc.evidence, { years: d.preventable_accident_years, stated: "none" }));
  else if (acc.value.years_ago === null) out.push(unknown("preventable_accident", true, { years: d.preventable_accident_years, stated: "undated" }));
  else out.push(judged("preventable_accident", true, acc.value.years_ago >= d.preventable_accident_years, acc.evidence, { years: d.preventable_accident_years, years_ago: acc.value.years_ago }));

  const ch = facts.clearinghouse_prohibited;
  out.push(ch ? judged("clearinghouse", true, !ch.value, ch.evidence) : unknown("clearinghouse", true));
  const da = facts.drug_alcohol_unresolved;
  out.push(da ? judged("drug_alcohol", true, !da.value, da.evidence) : unknown("drug_alcohol", true));
  return out;
}


export interface LeadMatchSummary {
  /** Hard requirements the lead's facts say are not met. */
  hardUnmet: number;
  unknown: number;
  met: number;
}
export function summariseLeadMatch(verdicts: readonly LeadMatchVerdict[]): LeadMatchSummary {
  return {
    hardUnmet: verdicts.filter((v) => v.hard && v.verdict === "does_not_meet").length,
    unknown: verdicts.filter((v) => v.verdict === "unknown").length,
    met: verdicts.filter((v) => v.verdict === "meets").length,
  };
}

/**
 * The queue's order (LEAD-SOURCING-PLAN S2): hard requirements met first, then fewest unknowns, then more
 * met (a preference held sorts up). Freshness is the caller's last key. A sort, never a filter (D-LS3).
 */
export function compareLeadMatch(a: LeadMatchSummary, b: LeadMatchSummary): number {
  return a.hardUnmet - b.hardUnmet || a.unknown - b.unknown || b.met - a.met;
}
