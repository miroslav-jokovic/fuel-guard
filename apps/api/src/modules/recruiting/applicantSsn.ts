import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSsn, maskSsn } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { open, secretAad } from "../../lib/secretBox.js";
import { loadCarrierWording } from "./carrierWording.js";
import { editRowsRefusal, editsParam, signingStarted, SIGNING_STARTED as EDIT_SIGNING_STARTED } from "./applicationEditLog.js";
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

/** What the office's review is told: the last four, or null. The sealed envelope stays here. */
export async function ssnLast4View(admin: SupabaseClient, orgId: string, invitationId: string): Promise<{ last4: string } | null> {
  const held = await ssnOnFile(admin, orgId, invitationId);
  return held ? { last4: held.last4 } : null;
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

// ── The office's side (Q-AM17): replace it, or — with "See the full SSN" — read it ───────────────────

export interface OfficeSsnError {
  code: string;
  message: string;
}
export const isOfficeSsnError = (v: unknown): v is OfficeSsnError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

const NOT_FOUND: OfficeSsnError = { code: "application_not_found", message: "That application is not in this organization." };

async function officeInvitation(admin: SupabaseClient, orgId: string, invitationId: string) {
  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  return data as { id: string; driver_id: string; submitted_at: string | null } | null;
}

/**
 * The office replaces the number (Q-AM17: everyone who works the application may, whoever may read it).
 * Like every correction: refused once the driver has started signing (F3, E7), and logged so the driver is
 * shown it on 3.1 and accepts it — WITHHELD (0586), so the edit row records that it changed and never the
 * digits, before or after.
 */
export async function replaceApplicantSsn(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  ssn: string,
  actorId: string,
): Promise<{ ok: true; last4: string } | OfficeSsnError> {
  const invitation = await officeInvitation(admin, orgId, invitationId);
  if (!invitation) return NOT_FOUND;
  if (invitation.submitted_at) {
    return { code: "application_not_editable", message: "This application is signed and filed, so what it says is fixed now." };
  }
  if (await signingStarted(admin, orgId, invitation.id)) return EDIT_SIGNING_STARTED;

  const sealed = sealSsn(env, orgId, ssn);
  const { error } = await admin.rpc("correct_applicant_ssn", {
    // The number and its withheld edit row in one transaction (Q-AM14, 0593); entered by the office.
    p_org: orgId,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_last4: sealed.last4,
    p_sealed: sealed.sealed,
    p_edits: editsParam([{ path: ["ssn"], before: null, after: null, withheld: true }]),
    p_edited_by: actorId,
  });
  const unrecorded = editRowsRefusal(error);
  if (unrecorded) return unrecorded;
  if (error) return { code: error.code === "SN003" ? "application_not_editable" : "ssn_not_saved", message: refusalOf(error).message };

  await writeAudit(admin, {
    orgId, actorId, action: "application.ssn_replaced", entity: "application_invitation", entityId: invitation.id,
  });
  return { ok: true, last4: sealed.last4! };
}

/**
 * All nine digits, for a holder of "See the full SSN" — the route checks the permission, this does the
 * read. Every read is audited (who, which application; never the number). Null when the number was kept
 * as its last four only (no secret box configured, 0220's rule) or none was given.
 */
export async function revealApplicantSsn(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  actorId: string,
): Promise<{ ssn: string | null; last4: string | null } | OfficeSsnError> {
  const invitation = await officeInvitation(admin, orgId, invitationId);
  if (!invitation) return NOT_FOUND;
  const held = await ssnOnFile(admin, orgId, invitation.id);
  if (!held) return { ssn: null, last4: null };
  const ssn = held.sealed ? open(env, held.sealed, secretAad(orgId, "driver_ssn")) : null;
  await writeAudit(admin, {
    orgId, actorId, action: "application.ssn_viewed", entity: "application_invitation", entityId: invitation.id,
  });
  return { ssn, last4: held.last4 };
}

/**
 * The SSN as one rendering of the packet prints it (Q-AM20 (a)): all nine for `whole` — the driver
 * reading what they are about to sign, or an office holder of "See the full SSN" — else the last four
 * masked. Null when none is on file. An office reader's whole read is audited like `revealApplicantSsn`;
 * the driver's own is not, since it is their number. Kept as the last four only (no secret box): masked.
 */
export async function ssnForPacket(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  whole: { reader: "applicant" } | { reader: "office"; actorId: string } | null,
): Promise<string | null> {
  const held = await ssnOnFile(admin, orgId, invitationId);
  if (!held) return null;
  if (!whole || !held.sealed) return maskSsn(held.last4);
  if (whole.reader === "office") {
    await writeAudit(admin, {
      orgId, actorId: whole.actorId, action: "application.ssn_viewed", entity: "application_invitation", entityId: invitationId,
      meta: { in: "packet_preview" },
    });
  }
  return formatSsn(open(env, held.sealed, secretAad(orgId, "driver_ssn")));
}
