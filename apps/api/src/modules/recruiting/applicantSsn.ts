import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { loadCarrierWording } from "./carrierWording.js";
import { signingStarted } from "./applicationEditLog.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  sealSsn,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * The applicant's Social Security number before signing (APPLICATION-FIX-PLAN item 3; owner rulings
 * Q-AM3, Q-AM17 and Q-AM20, 2026-11-11).
 *
 * ── WHY IT HAS ITS OWN DOOR ───────────────────────────────────────────────────────────────────
 * The driver enters it in the FORM now, where the office can review it and replace it, instead of only
 * on the sign-off screen, where it went straight into the filed row. The draft still refuses it
 * (`applicationDraftSaveSchema`, D-APP3): `application_drafts` is prunable plain jsonb. So it is posted
 * on its own and written by `record_applicant_ssn` (0589) into `application_ssns`, in 0220's shapes —
 * the last four in the clear, the whole number only sealed (secretBox, purpose `driver_ssn`). Filing
 * copies those two values onto `driver_applications` and deletes this row (`takeSsnForFiling`).
 *
 * ── THE WINDOW ────────────────────────────────────────────────────────────────────────────────
 * Like every other answer: open until the driver's first packet mark (F3, E7), then fixed, because the
 * document they are signing must not change under them. Filed is SN003 in the function as well.
 *
 * ⚠ Nothing here returns, logs or audits the number. The applicant is told the last four back, which
 * they typed a moment ago; nobody else is told anything by this module.
 */

/** What the driver is told after saving: the four digits that may be shown (Q-AM17). */
export interface ApplicantSsnSaved {
  last4: string;
}

const SIGNING_STARTED: IntakeError = {
  code: "application_not_editable",
  message: "You have started signing, so your application can no longer change.",
};

/** 0589's refusals, in the applicant's words. SN001/SN002 say nothing a stranger could use. */
function refusalOf(error: { code?: string; message: string }): IntakeError {
  switch (error.code) {
    case "SN001":
    case "SN002":
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    case "SN003":
      return ALREADY_SUBMITTED;
    default:
      return { code: "ssn_not_saved", message: "Your Social Security number could not be saved. Try again." };
  }
}

/** The applicant's own entry, from the form. */
export async function recordApplicantSsn(
  admin: SupabaseClient,
  env: Env,
  token: string,
  ssn: string,
  now: Date,
): Promise<ApplicantSsnSaved | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  if (await signingStarted(admin, invitation.org_id, invitation.id)) return SIGNING_STARTED;

  const sealed = sealSsn(env, invitation.org_id, ssn);
  const { error } = await admin.rpc("record_applicant_ssn", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_last4: sealed.last4,
    p_sealed: sealed.sealed,
    p_entered_by: "applicant",
  });
  if (error) return refusalOf(error);
  return { last4: sealed.last4! };
}

/** What `application_ssns` holds for one invitation, or null. The sealed envelope never leaves the api. */
export interface SsnOnFile {
  last4: string;
  sealed: string | null;
  enteredBy: "applicant" | "office";
}

export async function ssnOnFile(admin: SupabaseClient, orgId: string, invitationId: string): Promise<SsnOnFile | null> {
  const { data } = await admin
    .from("application_ssns")
    .select("ssn_last4, ssn_sealed, entered_by")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const row = data as { ssn_last4: string; ssn_sealed: string | null; entered_by: "applicant" | "office" } | null;
  return row ? { last4: row.ssn_last4, sealed: row.ssn_sealed, enteredBy: row.entered_by } : null;
}

/**
 * The two values filing writes onto `driver_applications`: the number typed at sign-off if one was
 * (a page served before this change still asks it there), else the one on file. Null for none.
 */
export async function ssnForFiling(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  typedAtSignOff: string | null | undefined,
): Promise<{ last4: string | null; sealed: string | null }> {
  if (typedAtSignOff) return sealSsn(env, orgId, typedAtSignOff);
  const held = await ssnOnFile(admin, orgId, invitationId);
  return held ? { last4: held.last4, sealed: held.sealed } : { last4: null, sealed: null };
}

/**
 * After filing, the pre-signing copy goes: the number now lives on the filed row (D-HIRE6), and a
 * second copy is a second place to protect. A failure leaves a row the invitation's cascade removes
 * with the applicant; it never refuses a filing that has already committed.
 */
export async function dropPreSigningSsn(admin: SupabaseClient, orgId: string, invitationId: string): Promise<void> {
  await admin.from("application_ssns").delete().eq("org_id", orgId).eq("invitation_id", invitationId);
}
