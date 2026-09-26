import { z } from "zod";
import { isoDateSchema } from "./rosterContract.js";
import { usdotNumberSchema } from "./recruitmentContract.js";
import { EMPLOYMENT_WINDOW_YEARS, CMV_WINDOW_YEARS, yearsBefore } from "./employmentCoverage.js";

/**
 * §391.21(b)(10)/(b)(11) — one declared employer, and which of the two lists it belongs to.
 *
 * ⚠ **Split out of `applicationContract.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at
 * the 450-line warning and before C2 adds to that file, along the one seam the contract already had:
 * everything here is about an EMPLOYER — its row, and the (b)(10)/(b)(11) windows it is sorted into —
 * and nothing here reads the rest of the application. `applicationContract.ts` imports the schema
 * for its `employers` array and re-exports this whole module, so every existing
 * `import … from "./applicationContract.js"` still resolves, and the package barrel is unchanged.
 * The regulation's numbering and the reasoning for it stay in that file's header.
 */

// ── (b)(10)/(b)(11) employment history ────────────────────────────────────────

/**
 * One declared employer. `operated_cmv` is what sorts an entry into (b)(11), and it is asked of every
 * entry rather than only the old ones — the applicant knows the answer and the boundary is ours to
 * compute, not theirs to remember.
 */
export const applicationEmployerSchema = z
  .object({
    /**
     * A stable id for this employer across every save of the draft (AW1, D-AW8), minted by the client
     * when the entry is first added. The office's phone verification is recorded against it BEFORE
     * filing (`employer_verification_calls.employer_key`, 0376), and `submit_driver_application`
     * copies each call onto the employment row created from the entry with the same key — so the key
     * is what lets a call made in week two meet the row that only exists in week four.
     *
     * ⚠ Optional here, required only for a v2 filing (`applicationV2FilingIssues`): every application
     * filed before AW1 has entries without one, `driver_applications` is append-only, and this base
     * schema must go on parsing them.
     */
    key: z.uuid().nullish(),
    employer_name: z.string().min(1).max(200),
    usdot_number: usdotNumberSchema,
    address_line1: z.string().max(200).nullish(),
    city: z.string().max(120).nullish(),
    state: z.string().max(40).nullish(),
    phone: z.string().max(40).nullish(),
    /**
     * Where a §391.23(a)(2) inquiry is sent. Optional, because an applicant may genuinely not know
     * it and a required field they cannot answer is a form they abandon — the office can add one
     * later, and a posted letter is an equally good contact under §391.23(c)(2).
     */
    email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
    position_held: z.string().max(120).nullish(),
    started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
    ended_on: isoDateSchema,
    /** §391.21(b)(11) — did the applicant operate a commercial motor vehicle in this job? */
    operated_cmv: z.boolean(),
    /** §391.23(a)(2): only a DOT-regulated employer owes a safety-performance inquiry. */
    dot_regulated: z.boolean(),
    /** §391.21(b)(10) asks for it in as many words. */
    reason_for_leaving: z.string().max(500).nullish(),
    /**
     * §391.21(b)(10)(iv)(A): whether the applicant was subject to the FMCSRs while employed by this
     * employer. (This comment described §40.25(j)'s prior-positive question until 2026-09-26 — a
     * different question, asked once per application and not per employer; G-12.)
     */
    subject_to_fmcsr: z.boolean().nullish(),
    /**
     * §391.21(b)(10)(iv)(B): whether the job was a safety-sensitive function in a DOT-regulated mode,
     * subject to 49 CFR part 40 alcohol and controlled-substances testing.
     */
    safety_sensitive: z.boolean().nullish(),
  })
  .strict()
  .refine((v) => typeof v.ended_on !== "string" || v.ended_on >= v.started_on, {
    message: "The end date cannot be before the start date",
    path: ["ended_on"],
  });
export type ApplicationEmployer = z.infer<typeof applicationEmployerSchema>;

// ── a gap in the (b)(10) years, explained ─────────────────────────────────────

/**
 * The applicant's explanation of one stretch of the three (b)(10) years with no employer (AW1, §4).
 *
 * §391.21(b)(10) asks for every employer in the three years and says nothing about the holes between
 * them; the carrier's own page 5 does ("All time periods exceeding 59 days must be verifiable"), and
 * the owner asked for the form to cover what the carrier needs. Q-AW22's default is 30 days — our own
 * coverage rule (`GAP_TOLERANCE_DAYS`), stricter than the carrier's 59, and the office may ignore a
 * short one. The dates are the gap's, as `employmentCoverage` computed it on the driver's screen; the
 * words are theirs ("between jobs", "medical leave", "school").
 */
export const applicationEmploymentGapSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((v) => v.to >= v.from, { message: "The end date cannot be before the start date", path: ["to"] });
export type ApplicationEmploymentGap = z.infer<typeof applicationEmploymentGapSchema>;

// ── which list an entry belongs to ────────────────────────────────────────────

export type EmploymentSegment = "b10" | "b11" | "outside";

/**
 * Sort one declared employer into §391.21(b)(10), (b)(11), or neither.
 *
 * The boundary is ours to compute and the rules differ (HIRING-PLAN.md D-HIRE1):
 *   (b)(10) — overlaps the 3 years before `asOf`. ALL employment, whatever it was.
 *   (b)(11) — overlaps the 7 years before that, and ONLY if the applicant operated a CMV.
 *
 * An entry may span the boundary and belong to both, which is why this returns a set rather than one
 * label: a job from 2018 to 2025 is a (b)(10) employer AND a (b)(11) one, and dropping either half
 * would under-report a list the applicant is required to give in full.
 */
export function employmentSegments(
  employer: Pick<ApplicationEmployer, "started_on" | "ended_on" | "operated_cmv">,
  asOf: string,
): EmploymentSegment[] {
  const aStart = yearsBefore(asOf, EMPLOYMENT_WINDOW_YEARS);
  const bStart = yearsBefore(asOf, CMV_WINDOW_YEARS);
  const from = employer.started_on;
  const to = employer.ended_on ?? asOf;

  const out: EmploymentSegment[] = [];
  // Half-open [aStart, asOf] for (b)(10); [bStart, aStart) for (b)(11). A job that merely touches a
  // boundary instant belongs to the later window and to it alone.
  if (to >= aStart && from <= asOf) out.push("b10");
  if (employer.operated_cmv && to >= bStart && from < aStart) out.push("b11");
  if (out.length === 0) out.push("outside");
  return out;
}

/** Employers the applicant was REQUIRED to list, in the regulation's own terms. */
export function requiredEmployers(
  employers: readonly ApplicationEmployer[],
  asOf: string,
): { b10: ApplicationEmployer[]; b11: ApplicationEmployer[] } {
  const b10: ApplicationEmployer[] = [];
  const b11: ApplicationEmployer[] = [];
  for (const e of employers) {
    const segments = employmentSegments(e, asOf);
    if (segments.includes("b10")) b10.push(e);
    if (segments.includes("b11")) b11.push(e);
  }
  return { b10, b11 };
}
