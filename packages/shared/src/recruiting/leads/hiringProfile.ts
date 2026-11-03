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

export const hiringRequirementsSchema = z.object({
  /** Carrier policy; the federal interstate floor is 21 (§391.11(b)(1)), so nothing below it is offered. */
  min_age: z.object({ years: z.number().int().min(21).max(99), reason }),
  /** A Class A CDL. Always hard: it is required by law for the equipment hauled (Q-RA7c). */
  class_a: z.object({ reason }),
  /** Verifiable Class A experience. Self-reported years never MEET it (Q-RA7b); see `leadMatch`. */
  min_class_a_years: z.object({ years: z.number().int().min(0).max(40), reason }),
  hazmat: z.object({ mode: z.enum(HAZMAT_MODES), reason }),
  /**
   * The four hard disqualifiers (Q-RA7d). Each is judged on a document or a verified record — MVR, PSP,
   * Clearinghouse, an employer's D&A answer — so for a lead every one is `unknown` by design: Meta's
   * Instant Form may not ask them (ADS-AGENT-PLAN §1, "Meta employment rules").
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
