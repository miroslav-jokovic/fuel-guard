import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INTAKE_CAPTURE_SLOTS,
  type ApplicantIntake,
  type ApplicantIntakeLicence,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { loadCarrierWording } from "./carrierWording.js";
import { promoteCaptures } from "./applicationCapture.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * Part 1 of the applicant's link — "get started" (APPLICATION-FLOW-V2-PLAN.md §6.2, AW2, D-AW1..D-AW4).
 *
 * ── ONE WRITER, AS IDENTITY HAD ONE ───────────────────────────────────────────────────────────
 * Every Part 1 fact goes through `record_applicant_intake` (0376), which replaces
 * `record_applicant_identity` as the single identity writer (D-AW3, amends D-AF8) and calls it from
 * inside for the date of birth and the current licence — so the licence PSP runs against, the one on
 * `drivers` and the one in the draft stay one fact. The applicant's calls are FILL-ONLY
 * (`p_overwrite = false`): a value the carrier already holds wins, and the answer names which fields
 * kept it, never what they hold (0365's rule, D-APP16).
 *
 * ── PART 1 ENDS ONCE ──────────────────────────────────────────────────────────────────────────
 * `complete_applicant_intake` stamps `intake_completed_at` and files Part 1's photographs as
 * `documents` (D-AW4) — weeks before the application, because the draft and its captures are pruned
 * at 90 days (§2.3.2) and screening outlives that. After it, the applicant's writes are refused
 * (AI008): the office screened on those answers, and only the office corrects them now.
 *
 * ── LEGACY INVITATIONS ────────────────────────────────────────────────────────────────────────
 * All eight production invitations predate Part 1 and have no `application_intakes` row (plan §7's
 * legacy rule). Nothing here creates one for them: a row appears only when an applicant posts to
 * these routes, which only C3's Part 1 screens do. `intakeState` is how every other path asks which
 * kind of invitation it is looking at.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS, and the org comes from a resolved
 * token, never from the request.
 */

export const INTAKE_FROZEN: IntakeError = {
  code: "intake_frozen",
  message: "You have already finished this part. If something is wrong, tell the carrier and they will correct it.",
};

/** AI009 (D-AW13) — the §40.25(j) question comes before every other Part 1 answer is stored. */
export const PRIOR_POSITIVE_REQUIRED: IntakeError = {
  code: "prior_positive_required",
  message:
    "Answer the question about drug and alcohol tests in the past two years first. Nothing you typed is lost.",
};

export const INTAKE_INCOMPLETE: IntakeError = {
  code: "intake_incomplete",
  message:
    "Before you go on: photograph both sides of your licence, photograph your medical card or say you "
    + "don't have one yet, and read the summary of your rights.",
};

const INVALID_LINK: IntakeError = {
  code: "invalid_link",
  message: "This application link is not valid. Ask for a new one.",
};

/** The Part 1 answers as `record_applicant_intake` reads them — present keys written, absent kept. */
function intakePayload(body: ApplicantIntake): Record<string, unknown> {
  const { endorsements: _endorsements, ...fields } = body;
  return fields;
}

/** Map the function's refusals to this surface's answers, one table for both writers. */
function refusalOf(error: { code?: string; message: string }): IntakeError {
  switch (error.code) {
    case "AI001":
    case "AI002":
      return INVALID_LINK;
    case "AI003":
      return ALREADY_SUBMITTED;
    case "AI004":
      return { code: "invalid_request", message: "Some of that could not be saved. Check it and try again." };
    case "AI007":
      return INTAKE_INCOMPLETE;
    case "AI008":
      return INTAKE_FROZEN;
    case "AI009":
      return PRIOR_POSITIVE_REQUIRED;
    default:
      return { code: "intake_failed", message: error.message };
  }
}

/** The live, consented, unfiled session every Part 1 write needs — or the refusal that stops it. */
async function openIntake(admin: SupabaseClient, token: string, now: Date) {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // §390.32(d): nothing is written before the 7001(c) consent, and a date of birth is among the first
  // things this path writes — the carrier's published wording, never the placeholders.
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  // The cheap refusal; the function checks it again under its lock.
  if (invitation.intake_completed_at) return INTAKE_FROZEN;
  return invitation;
}

/**
 * One Part 1 screen's answers, and/or the licence list — both through the one function.
 *
 * `licences` replaces the stored list whole, in the order given: position 0 is the current CDL.
 */
export async function recordIntake(
  admin: SupabaseClient,
  token: string,
  body: { intake?: ApplicantIntake; licences?: ApplicantIntakeLicence[] },
  now: Date,
): Promise<{ keptExisting: string[]; licenceCount: number } | IntakeError> {
  const invitation = await openIntake(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const { data, error } = await admin.rpc("record_applicant_intake", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_intake: body.intake ? intakePayload(body.intake) : {},
    p_licences: body.licences
      ? body.licences.map((l, position) => ({
          position,
          state_code: l.state_code,
          agency: l.agency ?? null,
          licence_number: l.licence_number,
          expires_on: l.expires_on ?? null,
          source: "intake",
        }))
      : null,
    p_endorsements: body.intake?.endorsements ?? null,
    p_overwrite: false,
  });
  if (error) return refusalOf(error);
  const row = data as { kept_existing?: unknown; licence_count?: unknown } | null;
  return {
    keptExisting: Array.isArray(row?.kept_existing) ? (row.kept_existing as string[]) : [],
    licenceCount: Number(row?.licence_count ?? 0),
  };
}

/**
 * Finish Part 1: file its photographs, stamp `intake_completed_at`. Idempotent — a second press
 * answers with the first stamp and files nothing (0376).
 *
 * The bytes are copied into the evidence bucket BEFORE the transaction, for the reason
 * `promoteCaptures` states: a row citing bytes that are not there is the one state 0146 exists to
 * prevent, and orphaned bytes after a refused transaction are collected by the nightly sweep.
 */
export async function completeIntake(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ intakeCompletedAt: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  if (invitation.intake_completed_at) return { intakeCompletedAt: invitation.intake_completed_at };

  const captures = await promoteCaptures(
    admin, invitation.org_id, invitation.id, invitation.driver_id, INTAKE_CAPTURE_SLOTS,
  );
  if (isIntakeError(captures)) return captures;

  const { data, error } = await admin.rpc("complete_applicant_intake", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_captures: captures,
  });
  if (error) return refusalOf(error);
  const intakeCompletedAt = String(data ?? now.toISOString());

  // The invitation and the driver, never an answer: Part 1 holds a date of birth and an address.
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "application_intake_completed",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, documentsFiled: captures.length },
  });
  return { intakeCompletedAt };
}

/**
 * Which kind of invitation is this — v2 (it has a Part 1 row) or legacy — and is Part 1 finished?
 *
 * ⚠ "Has an `application_intakes` row" is the whole of the legacy test until C3 merges: plan §7 adds
 * "created before C3's merge", and until then no invitation can have a row without its applicant
 * having begun Part 1 on these routes. C3 widens this, in this one place.
 */
export async function intakeState(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<{ v2: boolean }> {
  const { data } = await admin
    .from("application_intakes")
    .select("id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return { v2: Boolean(data) };
}
