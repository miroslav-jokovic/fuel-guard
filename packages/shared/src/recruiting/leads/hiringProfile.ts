import { z } from "zod";
import { recordId } from "../../recordId.js";

/**
 * The Hiring Profile: who qualifies (RECRUITER-AUTOMATION-PLAN.md 1.1 and §3a, ruled by the owner
 * 2026-10-26; LEAD-SOURCING-PLAN.md §4). Stored as `hiring_profile_versions.requirements` (0553), which
 * checks only that it is an object: what each requirement MEANS is this file and `leadMatch.ts`, never a
 * CHECK naming keys (D-RA3 — rules decide in one place).
 *
 * Every requirement carries the reason a recruiter (and counsel) is shown. None of them rejects anybody:
 * a requirement sorts and labels (D-LS3), and a fact the system does not hold is `unknown`, not a fail.
 *
 * What is deliberately absent: a hiring area. It belongs to the OPENING (a yard, a radius and a written
 * reason — `opening.ts`), and Q-LS2 / Q-RA4 have not ruled it into the profile.
 */

const reason = z.string().trim().min(5).max(500);

export const HAZMAT_MODES = ["required", "preferred", "off"] as const;
export type HazmatMode = (typeof HAZMAT_MODES)[number];

/**
 * Home time (LQ7, audit F-LA4): the carrier's Indeed screener asks "willing to stay on the road for 3 weeks?"
 * (Joanna, 2026-11-06) — a requirement the carrier already applies that Profile v1 did not name, because the
 * owner was asked about qualifications, not the job. Same three modes as hazmat. DEFAULT `off`: every stored
 * version and `HIRING_PROFILE_V1` parse unchanged, and no verdict row is written until a carrier sets it.
 */
export const HOME_TIME_MODES = HAZMAT_MODES;
export const homeTimeSchema = z.object({
  mode: z.enum(HOME_TIME_MODES),
  /** Consecutive days out the job asks for; the Indeed screener's "3 weeks" is 21. */
  min_days_out: z.number().int().min(1).max(60),
  reason,
});
export const HOME_TIME_OFF = { mode: "off", min_days_out: 21, reason: "Home time is not a requirement of this profile." } as const;

export const hiringRequirementsSchema = z.object({
  /** Carrier policy; the federal interstate floor is 21 (§391.11(b)(1)), so nothing below it is offered. */
  min_age: z.object({ years: z.number().int().min(21).max(99), reason }),
  /** A Class A CDL. Always hard: it is required by law for the equipment hauled (Q-RA7c). */
  class_a: z.object({ reason }),
  /** Verifiable Class A experience. Self-reported years never MEET it (Q-RA7b); see `leadMatch`. */
  min_class_a_years: z.object({ years: z.number().int().min(0).max(40), reason }),
  hazmat: z.object({ mode: z.enum(HAZMAT_MODES), reason }),
  home_time: homeTimeSchema.default(HOME_TIME_OFF),
  /**
   * The four hard disqualifiers (Q-RA7d). Each is judged on a document or a verified record — MVR, PSP,
   * Clearinghouse, an employer's D&A answer. A Meta lead has every one `unknown` by design (its Instant Form
   * may not ask them — ADS-AGENT-PLAN §1); a Tenstreet application carries the applicant's own yes/no answers
   * to them (`facts/tenstreet.ts`, LQ7), judged at `self_reported` like any other form answer.
   */
  disqualifiers: z.object({
    /** DUI/DWI in a CMV ever, and in any vehicle within this many years. */
    dui_any_vehicle_years: z.number().int().min(1).max(20),
    preventable_accident_years: z.number().int().min(1).max(20),
    clearinghouse_prohibited: z.literal(true),
    drug_alcohol_without_return_to_duty: z.literal(true),
    reason,
  }),
});
export type HiringRequirements = z.infer<typeof hiringRequirementsSchema>;

export const hiringProfileSaveSchema = z.object({
  /** Null creates the profile; an id saves its next version (`save_hiring_profile_version`, 0554). */
  profile_id: recordId().nullable(),
  name: z.string().trim().min(1).max(120),
  requirements: hiringRequirementsSchema,
});
export type HiringProfileSave = z.infer<typeof hiringProfileSaveSchema>;

/**
 * One profile as `GET /recruitment/hiring-profiles` answers it (`listHiringProfiles`): the parent and its newest
 * version. The answer also carries `defaults` — this file's `HIRING_PROFILE_V1` — so a first save starts from it.
 */
export interface HiringProfileView {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  current: { id: string; version: number; requirements: HiringRequirements; created_by_name: string; created_at: string } | null;
}
export interface HiringProfileList {
  profiles: HiringProfileView[];
  defaults: HiringRequirements;
}

/**
 * Profile v1 exactly as the owner ruled it on 2026-10-26 (RECRUITER-AUTOMATION-PLAN §3a): the values a
 * carrier's first save starts from. It is not seeded in the database (0553 header): until somebody saves,
 * there is no profile, and nothing claims one.
 */
export const HIRING_PROFILE_V1: HiringRequirements = {
  min_age: { years: 23, reason: "Carrier policy (Q-RA7a); the federal interstate minimum is 21." },
  class_a: { reason: "A Class A CDL is required by law for the tractor-trailers we run (Q-RA7c)." },
  min_class_a_years: {
    years: 2,
    reason: "Two years of Class A experience an employer or the MVR can confirm (Q-RA7b).",
  },
  hazmat: { mode: "preferred", reason: "Hazmat (H) is preferred, not required (Q-RA7c)." },
  home_time: HOME_TIME_OFF,
  disqualifiers: {
    dui_any_vehicle_years: 5,
    preventable_accident_years: 3,
    clearinghouse_prohibited: true,
    drug_alcohol_without_return_to_duty: true,
    reason:
      "DUI/DWI in a CMV ever or in any vehicle within 5 years; a preventable DOT-recordable accident within 3 years; " +
      "Clearinghouse prohibited status; a positive or refused test without return-to-duty (Q-RA7d).",
  },
};
