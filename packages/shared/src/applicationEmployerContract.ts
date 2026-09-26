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
     * §40.25(j): the applicant must be asked whether they have EVER tested positive or refused a
     * test and then failed to complete return-to-duty. Asked here because the answer is the
     * applicant's, not a former employer's — and a "yes" changes what §40.25 obliges us to chase.
     */
    subject_to_fmcsr: z.boolean().nullish(),
    safety_sensitive: z.boolean().nullish(),
  })
  .strict()
  .refine((v) => typeof v.ended_on !== "string" || v.ended_on >= v.started_on, {
    message: "The end date cannot be before the start date",
    path: ["ended_on"],
  });
export type ApplicationEmployer = z.infer<typeof applicationEmployerSchema>;

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
