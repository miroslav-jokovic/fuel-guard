import { z } from "zod";
import type { ApplicationEmploymentGap } from "./applicationEmployerContract.js";

/**
 * Employment gaps on a driver's record AFTER the application is signed (HW5c, HIRING-WORKFLOW-AUDIT
 * §3.4 EM-7, §4.5; the table is 0538 `driver_employment_gaps`).
 *
 * ── TWO SOURCES, SHOWN SIDE BY SIDE, NEVER MERGED ─────────────────────────────────────────────
 * The applicant's own explanations live in the filed application (`driver_applications.payload.
 * employment_gaps`, frozen at signing). What the office learns later — on the phone, or from an
 * employer's dates — is recorded in 0538, in the driver's words, with who took it down and when.
 * The record shows both ("The applicant said … / Added by {name} on {date}, after signing"); neither
 * is copied into the other, because a copy is a second store of one fact (§3.4's complaint).
 *
 * A recorded gap is never edited: a mistake is WITHDRAWN (once) and a corrected one recorded.
 */
export const EMPLOYMENT_GAP_EXPLANATION_MAX = 2000;

export const employmentGapCreateSchema = z
  .object({
    started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date"),
    ended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date"),
    explanation: z.string().trim().min(1, "Say what they were doing in this time").max(EMPLOYMENT_GAP_EXPLANATION_MAX),
  })
  .strict()
  .refine((v) => v.ended_on >= v.started_on, { message: "The end date cannot be before the start date.", path: ["ended_on"] });
export type EmploymentGapCreate = z.infer<typeof employmentGapCreateSchema>;

/** One gap the office recorded after signing. */
export interface RecordedEmploymentGap {
  id: string;
  startedOn: string;
  endedOn: string;
  explanation: string;
  recordedByName: string;
  createdAt: string;
  withdrawnAt: string | null;
}

/** `GET /api/recruitment/applicants/:driverId/employment-gaps`. */
export interface EmploymentGapsView {
  /** The office's, newest first, withdrawn ones included (shown struck through, never hidden). */
  recorded: RecordedEmploymentGap[];
  /** What the applicant wrote in the signed application; empty before filing. */
  applicant: ApplicationEmploymentGap[];
}

/**
 * Do two date ranges share a day? A recorded gap EXPLAINS a gap the timeline draws when it overlaps
 * it — the office records the dates the driver gave, which need not match the computed gap to the
 * day, and a gap drawn from edited jobs moves.
 */
export const rangesOverlap = (a: { from: string; to: string }, b: { from: string; to: string }): boolean =>
  a.from <= b.to && b.from <= a.to;
