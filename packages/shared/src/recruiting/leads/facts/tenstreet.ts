import { z } from "zod";
import { ageOn, type LeadFacts, type YearsRange } from "../leadMatch.js";

/**
 * What a Tenstreet application says (LQ7; TENSTREET-INTAKE-PLAN.md TS2 builds the listener that produces this
 * projection from the XML). The INPUT here is `TenstreetProjection` — the parsed, SSN-free shape TS2's parser
 * must produce — defined in shared so TS2 implements what the rules already read. Field names follow Tenstreet's
 * "Receiving Application Data" guide (rev 11/2014) and its three sample XMLs, read 2026-11-09:
 *   `PersonalData/DateOfBirth` (MM/DD/YYYY or M/D/YYYY), `Licenses/License{CommercialDriversLicense,
 *   LicenseClass, OriginalIssueDate, Endorsements/Endorsement}`, `Accidents/Accident{Date, DOTReportable,
 *   Preventable, InCommercialVehicle}` (an empty `<Accidents/>` is "none"), `MotorVehicleRecords/MotorVehicleRecord[@Type @Answer @Date]`
 *   (Types: Suspension, DuringSuspension, ConvictedAlcoholSubstance, ConvictedDrugs, ConvictedReckless,
 *   PositiveTest), `CustomQuestions/CustomQuestion{QuestionId, Answer}`.
 *
 * ── EVIDENCE ─────────────────────────────────────────────────────────────────────────────────────
 * Everything an applicant typed is `self_reported`, the MVR/criminal yes/no answers included. A licence that
 * Tenstreet's DQF marked as received (`DqfData` lists the document) would be `document`; TS2 sets
 * `licence.documented` when it is, and only then does the licence fact carry that level. Nothing here is
 * `verified` — that is an MVR/PSP/Clearinghouse read, after the application.
 *
 * ── WHAT IS DELIBERATELY NOT READ ────────────────────────────────────────────────────────────────
 * No SSN (D-TS4: the parser drops `GovernmentID`), no EEO (D-TS5), no name/address. The date of birth is read
 * into an AGE VERDICT here and never into a lead's `answers` (D-TS6's intent, achieved through a fact):
 * `recordLeadVerdicts` stores `detail.age` as a number. The criminal-record questions are not disqualifiers in
 * Hiring Profile v1 (Q-RA7d names four) and are not read — a recruiter sees them on the application.
 */

const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
/** Tenstreet's `MM/DD/YYYY`, `M/D/YYYY` or `YYYY-MM-DD[ HH:MM:SS]` → `YYYY-MM-DD`, or null. */
export function tenstreetDate(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const us = mdY.exec(v);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const yn = z.enum(["y", "n"]).nullable();

export const tenstreetProjectionSchema = z.object({
  /** `YYYY-MM-DD` after `tenstreetDate`; null when absent or unreadable. */
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  licences: z.array(z.object({
    current: yn,
    cdl: yn,
    class: z.string().trim().max(4).nullable(),
    /** `YYYY-MM-DD` after `tenstreetDate`. */
    original_issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    endorsements: z.array(z.string().trim().max(40)),
    /** TS2 sets this when `DqfData` lists the licence document as received. */
    documented: z.boolean(),
  })),
  /** Whether the post carried an `Accidents` section at all (empty = "none"; absent = not answered). */
  accidents_asked: z.boolean(),
  accidents: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    dot_reportable: yn,
    preventable: yn,
    in_commercial_vehicle: yn,
  })),
  /** `MotorVehicleRecord` by Type: the Answer and the Date (`YYYY-MM-DD` or null). */
  mvr: z.record(z.string(), z.object({ answer: yn, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() })),
  /** `CustomQuestion` by QuestionId → Answer, as sent. */
  custom: z.record(z.string(), z.string().max(2000)),
});
export type TenstreetProjection = z.infer<typeof tenstreetProjectionSchema>;

/** The carrier's custom question ids this reader maps (D-TS9: by id, never by prompt). TS0 asks Tenstreet for them. */
export const TENSTREET_CUSTOM_IDS = {
  /** Yes/no: willing to stay out `HOME_TIME_DAYS` days at a time. */
  home_time_ok: "HomeTimeOk",
} as const;
export const TENSTREET_HOME_TIME_DAYS = 21;

/** Whole years from a date to `asOf`, floored; null for an unreadable date. */
const yearsBetween = (from: string | null, asOf: string): number | null => (from ? ageOn(from, asOf) : null);

const HAZMAT = /^(haz\s*mat|h|x)$/i;

export interface TenstreetFactsResult { facts: LeadFacts; unmapped: string[] }

/** Pure. `asOf` is the calendar day the post was received (YYYY-MM-DD) — the reader holds no clock. */
export function tenstreetFacts(p: TenstreetProjection, asOf: string, daysOut: number = TENSTREET_HOME_TIME_DAYS): TenstreetFactsResult {
  const facts: LeadFacts = {};
  const unmapped: string[] = [];

  if (p.date_of_birth) facts.date_of_birth = { value: p.date_of_birth, evidence: "self_reported" };

  // The current CDL, else the first CDL listed; a licence row with `cdl = n` is not a Class A whatever its class says.
  const cdls = p.licences.filter((l) => l.cdl === "y");
  const licence = cdls.find((l) => l.current === "y") ?? cdls[0];
  if (p.licences.length > 0) {
    const classA = licence !== undefined && (licence.class ?? "").trim().toUpperCase() === "A";
    const evidence = licence?.documented ? "document" : "self_reported";
    facts.class_a_held = { value: classA, evidence };
    if (classA && licence.original_issue_date) {
      const y = yearsBetween(licence.original_issue_date, asOf);
      // Years since issue is a CEILING on Class A experience, stated as an open range from 0: the person may
      // have held the licence without driving. The rule reads a self-reported range the same way as Meta's
      // buckets — entirely below the floor is a miss, straddling it is `unknown` pending verification.
      if (y !== null) facts.class_a_years = { value: { lower: 0, upper: y, upperInclusive: true } satisfies YearsRange, evidence };
    }
    facts.hazmat_endorsement = { value: licence !== undefined && licence.endorsements.some((e) => HAZMAT.test(e.trim())), evidence };
  }

  // DUI (Q-RA7d): Tenstreet's ConvictedAlcoholSubstance is "while operating a motor vehicle"; whether it was a CMV
  // is not asked, so `cmv` is false and the any-vehicle window applies. A "n" is a clean answer; a "y" with no
  // date stays undated (the rule leaves it `unknown`).
  const alc = p.mvr.ConvictedAlcoholSubstance;
  if (alc?.answer === "n") facts.dui = { value: null, evidence: "self_reported" };
  else if (alc?.answer === "y") facts.dui = { value: { cmv: false, years_ago: yearsBetween(alc.date, asOf) }, evidence: "self_reported" };

  // Preventable accident: Tenstreet asks Preventable and DOTReportable per accident. The newest preventable
  // DOT-reportable one counts; none listed, or none preventable, is a clean answer.
  // `accidents_asked` — TS2 sets it when the Accidents section was present in the post (an empty section is a
  // "none" answer; an absent section is no answer). The newest preventable DOT-reportable one counts.
  const prev = p.accidents.filter((a) => a.preventable === "y" && a.dot_reportable === "y");
  if (p.accidents_asked) {
    if (prev.length === 0) facts.preventable_accident = { value: null, evidence: "self_reported" };
    else {
      const dated = prev.map((a) => yearsBetween(a.date, asOf)).filter((y): y is number => y !== null);
      facts.preventable_accident = { value: { years_ago: dated.length ? Math.min(...dated) : null }, evidence: "self_reported" };
    }
  }

  // PositiveTest is Tenstreet's pre-employment positive/refused question (3 years); it is the lead-side proxy for
  // "positive or refused without return-to-duty". Clearinghouse status is not asked by Tenstreet: left unknown.
  const pos = p.mvr.PositiveTest;
  if (pos?.answer === "y" || pos?.answer === "n") facts.drug_alcohol_unresolved = { value: pos.answer === "y", evidence: "self_reported" };

  for (const [id, raw] of Object.entries(p.custom)) {
    if (id === TENSTREET_CUSTOM_IDS.home_time_ok) {
      const t = raw.trim().toLowerCase();
      if (t === "y" || t === "yes") facts.willing_days_out = { value: daysOut, evidence: "self_reported" };
      else if (t === "n" || t === "no") facts.willing_days_out = { value: 0, evidence: "self_reported" };
      else unmapped.push(id);
    } else unmapped.push(id);
  }
  return { facts, unmapped };
}
