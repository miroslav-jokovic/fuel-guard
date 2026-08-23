import { z } from "zod";

/**
 * Why an application ended without a hire (0238).
 *
 * ── WHAT THIS FIXES ───────────────────────────────────────────────────────────────────────────
 * The applicant pipeline had one exit. `ApplicantStage` runs `not_started` to `ready_to_screen` and
 * stops; `hire_applicant` is the only way out of it, and it goes one way. A recruiter's most common
 * act — deciding not to hire somebody — could not be recorded anywhere.
 *
 * ⚠ **It is also the thing FCRA adverse action has to hang on.** `RECRUITING-SYSTEM-PLAN.md` R10 is
 * blocked on Q-REC8 (does the carrier send the notices from here?) and Q7 (is a PSP report a consumer
 * report?). This is the half owed whatever those answers are: a notice is a consequence of a
 * decision, and there was no decision.
 *
 * ── NO `hired`, AND THAT IS NOT AN OVERSIGHT ──────────────────────────────────────────────────
 * `drivers.status = "active"` plus `hire_date` already record a hire, definitively. A second row
 * saying the same thing is one fact in two places, which ends with the two disagreeing. "Was this
 * person hired?" is a question about `drivers`; "why not?" is a question about this.
 */

export const APPLICANT_DISPOSITIONS = ["declined", "withdrawn", "no_response"] as const;
export type ApplicantDispositionOutcome = (typeof APPLICANT_DISPOSITIONS)[number];

/**
 * ⚠ **Written from the CARRIER's side, and the difference matters on the board.**
 *
 * "Declined" is the carrier's act; "Withdrew" and "No response" are the applicant's, and a recruiter
 * scanning a list needs to see at a glance which of those happened, because only the first is a
 * decision they made and only the first can ever owe anybody a notice.
 */
export const APPLICANT_DISPOSITION_LABELS: Record<ApplicantDispositionOutcome, string> = {
  declined: "Declined",
  withdrawn: "Withdrew",
  no_response: "No response",
};

/** The outcomes that are the CARRIER's decision. The others are things that happened to it. */
export const isCarrierDecision = (outcome: ApplicantDispositionOutcome): boolean =>
  outcome === "declined";

/**
 * `POST /api/recruitment/dispositions`.
 *
 * ⚠ `decided_by` is absent on purpose — it is stamped server-side from the verified JWT. A client
 * that could name the decider could name somebody else, which is the rule every other act in this
 * product follows (`recorded_by` on the seven-day statement, `p_actor` on the security-definer RPCs).
 */
export const applicantDispositionCreateSchema = z.object({
  driver_id: z.uuid(),
  outcome: z.enum(APPLICANT_DISPOSITIONS),
  decided_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date"),
  /**
   * Free text, never a picklist. A reason chosen from a menu is the menu's reason; the question
   * anybody asks about a decline afterwards is "why", not "which category".
   */
  reason: z.string().max(2000).nullish(),
  /**
   * ⚠ Did the decision rest, in whole or in part, on a purchased report — a PSP record, an MVR?
   *
   * Recorded as a fact at the moment of the decision and acting on nothing today. R10 owns the
   * notices. The reason it is captured now rather than with them: whether a recruiter had a bought
   * report in front of them when they said no is knowable at the time and unrecoverable afterwards,
   * and reconstructing it from a timeline of vendor calls would be a guess dressed as a record.
   *
   * ⚠ It is NOT the same question as "is there a report in this file". A driver declined for a
   * three-year gap they wrote down themselves rests on nothing purchased, whatever else sits beside
   * it — which is why this is asked of the person deciding rather than derived.
   */
  rested_on_consumer_report: z.boolean().default(false),
});
export type ApplicantDispositionCreate = z.infer<typeof applicantDispositionCreateSchema>;

export const applicantDispositionRowSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  outcome: z.enum(APPLICANT_DISPOSITIONS),
  decided_on: z.string(),
  reason: z.string().nullable(),
  rested_on_consumer_report: z.boolean(),
  decided_by: z.uuid().nullable(),
  created_at: z.string(),
});
export type ApplicantDispositionRow = z.infer<typeof applicantDispositionRowSchema>;

/**
 * The current disposition of an applicant: the newest one, or none.
 *
 * ⚠ **Newest wins, and nothing is ever edited** — the table is append-only, so a carrier who
 * declines somebody and then changes their mind records a second row rather than rewriting the
 * first. The history is the point: "we decided no on the 3rd and yes on the 9th" is a true account
 * of what happened, and a single mutable row would erase the first half of it.
 */
export const currentDisposition = (
  rows: readonly ApplicantDispositionRow[],
): ApplicantDispositionRow | null =>
  [...rows].sort((a, b) =>
    b.decided_on.localeCompare(a.decided_on) || b.created_at.localeCompare(a.created_at),
  )[0] ?? null;
