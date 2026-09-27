import { z } from "zod";
import { carrierWallTimeSchema } from "./applicantScreeningContract.js";

/**
 * The office's phone verification of a previous employer BEFORE filing — D-AW8, AW12
 * (APPLICATION-FLOW-V2-PLAN §6.5, C2b3).
 *
 * ── WHY A RECORD OF ITS OWN, AND NOT AN `employer_inquiries` ROW ──────────────────────────────
 * §391.23's record is `employer_inquiries`, and each of its rows names an `employment_id` — a
 * `driver_employment_history` row that only exists once the application is FILED (plan §2.2). The
 * office rings employers weeks before that. So the call is kept against the draft employer's stable
 * `key` (AW1, `applicationEmployerSchema.key`) in `employer_verification_calls` (0376, append-only), and
 * filing copies each call into `employer_inquiries` against the row made from the same key — so after
 * filing §391.23 is one record, and nothing typed in week two is retyped in week four.
 *
 * ⚠ **`body_sent` is NOT NULL and means "the exact wording sent"** (0223). A phone call sends no
 * letter, so the copy's body is the SUMMARY rendered here (`verificationCallSummary`), under its own
 * wording version — 0376 writes `'phone-call-v1'` beside it, and `PHONE_CALL_WORDING_VERSION` is pinned
 * to that string by a test. The filing refuses (DA043) a call with no summary rather than file a
 * §391.23 record with invented wording.
 */

/**
 * The five things a previous employer is asked to confirm — 0376's `employer_verification_calls_
 * outcomes_check`, in its order. All five on every call, nothing else: a call that skipped one says so
 * with `not_confirmed`, never by omission.
 */
export const VERIFICATION_QUESTIONS = ["dates", "position", "reason", "cmv", "dot_tested"] as const;
export type VerificationQuestion = (typeof VERIFICATION_QUESTIONS)[number];

export const VERIFICATION_QUESTION_LABELS: Record<VerificationQuestion, string> = {
  dates: "Dates of employment",
  position: "Position held",
  reason: "Reason for leaving",
  cmv: "Drove a commercial motor vehicle",
  dot_tested: "Subject to DOT drug and alcohol testing",
};

export const VERIFICATION_OUTCOMES = ["confirmed", "corrected", "not_confirmed"] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

export const VERIFICATION_OUTCOME_LABELS: Record<VerificationOutcome, string> = {
  confirmed: "Confirmed",
  corrected: "Corrected",
  not_confirmed: "Not confirmed",
};

/** 0376 writes this beside every copied call; the summary below is the text it versions. */
export const PHONE_CALL_WORDING_VERSION = "phone-call-v1";

export const VERIFICATION_ANSWERED_BY_MAX_LENGTH = 200;
export const VERIFICATION_CORRECTION_MAX_LENGTH = 500;

/**
 * `POST /recruitment/applicants/:driverId/employer-calls` — one call to one employer.
 *
 * ⚠ The employer is named by its KEY and nothing else. Its name is read from the draft by the server,
 * so a call cannot be filed under a name the applicant never wrote, and a key the draft does not hold
 * is refused (`employer_not_on_application`).
 *
 * ⚠ A `corrected` answer carries what the employer said instead — a correction with no content is a
 * record that something was wrong and no record of what.
 */
export const employerVerificationCallSchema = z
  .object({
    employer_key: z.uuid(),
    answered_by: z.string().trim().min(1).max(VERIFICATION_ANSWERED_BY_MAX_LENGTH),
    called_at: carrierWallTimeSchema,
    outcomes: z.object(
      Object.fromEntries(VERIFICATION_QUESTIONS.map((q) => [q, z.enum(VERIFICATION_OUTCOMES)])) as Record<
        VerificationQuestion,
        z.ZodEnum<{ [K in VerificationOutcome]: K }>
      >,
    ).strict(),
    corrections: z
      .partialRecord(z.enum(VERIFICATION_QUESTIONS), z.string().trim().min(1).max(VERIFICATION_CORRECTION_MAX_LENGTH))
      .nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const q of VERIFICATION_QUESTIONS) {
      const said = v.corrections?.[q];
      if (v.outcomes[q] === "corrected" && !said) {
        ctx.addIssue({ code: "custom", path: ["corrections", q], message: "Say what the employer corrected it to." });
      }
      if (v.outcomes[q] !== "corrected" && said) {
        ctx.addIssue({ code: "custom", path: ["corrections", q], message: "Only a corrected answer takes a correction." });
      }
    }
  });
export type EmployerVerificationCallInput = z.infer<typeof employerVerificationCallSchema>;

/** One recorded call, as the drawer reads it. */
export interface EmployerVerificationCall {
  id: string;
  employerKey: string;
  employerName: string;
  outcomes: Record<VerificationQuestion, VerificationOutcome>;
  corrections: Partial<Record<VerificationQuestion, string>> | null;
  answeredBy: string;
  calledAt: string;
  /** Set when filing copied it into `employer_inquiries` — from then on it is §391.23's record. */
  copiedInquiryId: string | null;
}

/** One employer on the live draft, as the drawer offers it to call. */
export interface VerifiableEmployer {
  /** Null for an entry typed before AW1 minted keys — it cannot take a call until the draft is saved. */
  key: string | null;
  name: string;
  startedOn: string | null;
  endedOn: string | null;
  phone: string | null;
  dotRegulated: boolean | null;
}

/** `GET …/employer-calls`. */
export interface EmployerVerificationList {
  employers: VerifiableEmployer[];
  calls: EmployerVerificationCall[];
  /**
   * Filed: the calls are §391.23 records now, and a new one goes through the inquiry queue, whose
   * rows have an employment row to name.
   */
  filed: boolean;
  timeZone: string;
}

/**
 * The text a copied call files as `body_sent` (see the header). Plain lines in the questions' order,
 * with the carrier-zone time the office entered, so the record reads the same in 2029 as on the day.
 *
 * ⚠ Pure and deterministic: filing renders it from the stored row, never from what a client sent.
 */
export function verificationCallSummary(call: {
  employerName: string;
  answeredBy: string;
  calledAtLocal: string;
  timeZone: string;
  outcomes: Record<VerificationQuestion, VerificationOutcome>;
  corrections: Partial<Record<VerificationQuestion, string>> | null;
}): string {
  const lines = VERIFICATION_QUESTIONS.map((q) => {
    const outcome = VERIFICATION_OUTCOME_LABELS[call.outcomes[q]];
    const said = call.outcomes[q] === "corrected" ? call.corrections?.[q] : undefined;
    return `${VERIFICATION_QUESTION_LABELS[q]}: ${outcome}${said ? ` — "${said}"` : ""}.`;
  });
  return [
    `Telephone verification of employment with ${call.employerName}.`,
    `Called ${call.calledAtLocal} (${call.timeZone}); answered by ${call.answeredBy}.`,
    ...lines,
  ].join("\n");
}
