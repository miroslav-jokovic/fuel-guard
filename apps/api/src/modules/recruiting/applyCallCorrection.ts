import type { SupabaseClient } from "@supabase/supabase-js";
import { callCorrectionValues, isRecordId, type ApplyCallCorrection } from "@silvicom/shared";
import { readLiveInvitation } from "./applicantChecklist.js";
import { readCall } from "./applicantEmployerCalls.js";
import { editApplication, isReviewError, type ReviewError } from "./applicationReview.js";

/**
 * HW5d — a previous employer's correction, written into the application (HIRING-WORKFLOW-AUDIT
 * §4.5: *"Call results: 'dates differ — employer said 02/2023–11/2024' carries an Apply button that
 * writes the dates (logged as an office edit)"*; EM-8: the corrections were "never applied; the
 * recruiter re-types them").
 *
 * ── THROUGH THE OFFICE'S ONE EDIT DOOR ────────────────────────────────────────────────────────
 * Every write is `editApplication`'s — the same window (the office's send until the first packet
 * mark, §9 P5), the same revision check (DA041: the applicant's newer typing is never overwritten),
 * the same draft parse and the same `application_edits` row and audit. This file only decides WHICH
 * fields: the call names its employer by key and the question names the fields
 * (`CALL_CORRECTION_FIELDS`), so a caller can never aim a correction at another job or another field.
 *
 * ⚠ The dates are two edits, the second carrying the revision the first returned. Not one
 * transaction: if the second is refused (the window closed between them) the start date stands
 * and the answer says so — each half is a logged, reversible office edit, which is the same
 * guarantee a person typing them one at a time gets.
 *
 * The service role bypasses RLS: the call and invitation reads are org-filtered here, and
 * `editApplication` filters its own.
 */
export type ApplyError = ReviewError;

export async function applyCallCorrection(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  driverId: string,
  callId: string,
  input: ApplyCallCorrection,
): Promise<{ revision: number | null; applied: string[]; employerKey: string } | ApplyError> {
  if (!isRecordId(callId)) return { code: "call_not_found", message: "That call is not on this application." };
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "application_not_found", message: "This applicant has no live invitation." };
  if (invitation.submitted_at) {
    return {
      code: "already_filed",
      message: "The application is filed — correct the job on the employment list instead.",
    };
  }
  const call = await readCall(admin, orgId, invitation.id, callId);
  if (!call) return { code: "call_not_found", message: "That call is not on this application." };
  if (call.outcomes[input.question] !== "corrected") {
    return { code: "nothing_to_apply", message: "The employer did not correct that answer on this call." };
  }

  let revision: number | null = input.revision;
  const applied: string[] = [];
  for (const [field, value] of callCorrectionValues(input)) {
    const result = await editApplication(
      admin, orgId, invitation.id,
      { op: "set", path: ["employers", call.employerKey, field], value, revision: revision ?? 0 },
      { actorId },
    );
    if (isReviewError(result)) {
      if (applied.length === 0) return result;
      return { code: result.code, message: `Only part of it was written (${applied.join(", ")}). ${result.message}` };
    }
    revision = result.revision;
    applied.push(field);
  }
  return { revision, applied, employerKey: call.employerKey };
}
