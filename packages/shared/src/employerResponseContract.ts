import { z } from "zod";
import { applicationAccidentSchema } from "./applicationContract.js";

/**
 * What a previous employer sent back (EMPLOYER-INQUIRY-PLAN E4).
 *
 * ── THE STRUCTURED FIELDS ARE EXACTLY WHAT §391.23(d) ASKED FOR, AND NOTHING ELSE ──────────────
 * Employment verification, and the §390.15(b)(1) accident elements: the date, the city or town and
 * state, the number of fatalities and injuries, and whether hazardous material other than fuel
 * spilled. Every DOT verification form in the wild also asks "eligible for rehire" — that is carrier
 * practice, not §391.23, and it is deliberately NOT a structured field here. A shape that mixes what
 * the regulation requires with what the industry habitually asks makes the file harder to defend,
 * not easier; anything extra the employer volunteered goes in the note, where it reads as what it is.
 *
 * ── THE ACCIDENT SHAPE IS THE APPLICANT'S OWN ──────────────────────────────────────────────────
 * `applicationAccidentSchema` is reused rather than restated, because §391.21(b)(7) asks the
 * APPLICANT for the same three years of accidents that §391.23(d) asks the EMPLOYER about. Two
 * answers to one question, in one shape — which is what makes comparing them possible later
 * (HIRING-PLAN §4's second cross-match). Two near-identical schemas would have made that comparison
 * a data-cleaning exercise instead.
 */

export const employerResponseSchema = z.object({
  /** Did they confirm the driver worked there at all? A "no" is a finding, not an empty answer. */
  employment_confirmed: z.boolean(),
  /** The dates as the EMPLOYER gives them — which may not be the dates the applicant declared. */
  verified_started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  verified_ended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  position_held: z.string().max(120).nullish(),
  /** §390.15(b)(1), as reported by the employer. */
  accidents: z.array(applicationAccidentSchema).default([]),
  /**
   * An empty list is ambiguous — it means "they reported none" or "we have not asked yet" depending
   * on who is reading. This makes the employer's nil return an ANSWER, the same rule
   * `declares_no_accidents` follows on the application.
   */
  reports_no_accidents: z.boolean(),
  /** Whatever else they volunteered, in their words. */
  note: z.string().max(2000).nullish(),
})
  .refine((v) => v.accidents.length > 0 || v.reports_no_accidents, {
    message: "Record the accidents they reported, or that they reported none",
    path: ["accidents"],
  });
export type EmployerResponse = z.infer<typeof employerResponseSchema>;

/** Registering the returned letter or fax before it is uploaded. The kind is not the client's to
 *  choose — the route forces `previous_employer_response`, which carries the §391.23(k)(2) read
 *  restriction, exactly as the PSP import does. */
export const employerResponseDocumentSchema = z.object({
  document_id: z.uuid(),
  content_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  bytes: z.number().int().positive().nullish(),
});
export type EmployerResponseDocument = z.infer<typeof employerResponseDocumentSchema>;

/**
 * Where the employer's answer and the applicant's own declaration disagree about the dates.
 *
 * Reported, never resolved. A former employer's payroll system and a driver's memory routinely
 * differ by days at either end, and a product that "corrected" the application from the employer's
 * reply would be editing a document somebody certified as true — which is the one thing a §391.21
 * application may never have done to it. So this returns something to ASK ABOUT.
 *
 * The tolerance is deliberate and generous: a difference of a few days is how people remember jobs,
 * and flagging it would teach a recruiter to ignore the flag.
 */
export const DATE_DISCREPANCY_TOLERANCE_DAYS = 31;

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

export interface DateDiscrepancy {
  field: "started_on" | "ended_on";
  declared: string;
  reported: string;
  days: number;
}

export function dateDiscrepancies(
  declared: { started_on: string; ended_on: string | null },
  response: Pick<EmployerResponse, "verified_started_on" | "verified_ended_on">,
): DateDiscrepancy[] {
  const out: DateDiscrepancy[] = [];
  if (response.verified_started_on) {
    const days = daysApart(declared.started_on, response.verified_started_on);
    if (days > DATE_DISCREPANCY_TOLERANCE_DAYS) {
      out.push({
        field: "started_on",
        declared: declared.started_on,
        reported: response.verified_started_on,
        days: Math.round(days),
      });
    }
  }
  if (response.verified_ended_on && declared.ended_on) {
    const days = daysApart(declared.ended_on, response.verified_ended_on);
    if (days > DATE_DISCREPANCY_TOLERANCE_DAYS) {
      out.push({
        field: "ended_on",
        declared: declared.ended_on,
        reported: response.verified_ended_on,
        days: Math.round(days),
      });
    }
  }
  return out;
}
