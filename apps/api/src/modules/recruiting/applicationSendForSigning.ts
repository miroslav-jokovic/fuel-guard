import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OPEN_SIGNING_WARNS_ON,
  SIGN_LINK_LIFETIME_HOURS,
  renderSigningLinkEmail,
  type SigningSent,
  type SigningTextOutcome,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { carrierName, deliverApplicationMail } from "./applicationMail.js";
import { recruitingSettings } from "./recruitingSettings.js";
import { sendOrQueueSms, type OutboxOutcome } from "./smsOutbox.js";

/**
 * The office sends the packet for signing, to the driver's own phone, while the driver is there (D-AW14,
 * C3s3a). It replaces AF5's "Open signing on this screen".
 *
 * ── WHAT CHANGED, AND WHY ─────────────────────────────────────────────────────────────────────
 * AF5 (D-AF3, D-AF6) opened the sign link in a new tab on the office's computer and handed the screen
 * over: the press at the desk was the in-person act, and the link went nowhere else. The owner's model
 * of 2026-09-26 keeps the press at the desk and moves the signing onto the driver's phone — *"we will
 * send link to phone and he will sign there"* — so the link now goes by email always and by text where
 * the driver agreed to texts, and NEVER to the office's screen: a bearer link on the office's computer is
 * a second copy with no reason to exist once the driver holds one.
 *
 * ── WHAT IT DOES, IN ORDER ────────────────────────────────────────────────────────────────────
 *   1. Refuses what 0369 would refuse (not approved, revoked, filed), from the row it read, so step 2
 *      never writes on an invitation the function would then turn away.
 *   2. Starts the new link's 72 hours and its unlock count at 0, BEFORE the link exists. A failure here
 *      leaves nothing sent and nothing changed; the reverse order could leave a live link with the
 *      previous send's end, or none — a link with no end is the one outcome this batch exists to stop.
 *   3. Mints the sign token through `open_packet_signing` (0369), which rotates it (the previous emailed
 *      link dies), stamps `signing_opened_at` the first time only, and extends the invitation's expiry.
 *   4. Audits, then sends: the email, then the text. Sending never decides whether the act happened
 *      (`applicationMail.ts`), and both outcomes come back for the office to read.
 *
 * The text carries a link on the invitation's TEXT token, minted when it actually goes (0378): at once
 * when the recipient's window is open — the ordinary case, with the driver in the office — or from the
 * drain when it opens. The resolver holds that door to the same 72 hours (`isSentSignDoor`).
 *
 * ── IT WARNS, IT NEVER REFUSES, ON WHAT IS OUTSTANDING (D-AF6) ────────────────────────────────
 * Unchanged from AF5: the federal gates refuse where they belong — at travel and at hire — and the
 * warning is read from the SAME fold the checklist shows (`OPEN_SIGNING_WARNS_ON`).
 */

export type SendForSigningError = { code: string; message: string };
export const isSendForSigningError = (v: object): v is SendForSigningError => "code" in v && "message" in v;

const NOT_FOUND: SendForSigningError = {
  code: "application_not_found",
  message: "That application is not in this organization.",
};
const NOT_APPROVED: SendForSigningError = {
  code: "application_not_approved",
  message: "Approve the application before sending it for signing.",
};
const REVOKED: SendForSigningError = { code: "invitation_revoked", message: "This invitation was revoked. Nothing was sent." };
const FILED: SendForSigningError = { code: "already_filed", message: "The application is already signed and filed." };

interface InvitationToSend {
  id: string;
  driver_id: string;
  email: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  submitted_at: string | null;
}

/** The outbox's answer, in the terms the office reads. The outbox id stays on the server. */
function textOutcome(o: OutboxOutcome): SigningTextOutcome {
  if (o.sent) return { state: "sent" };
  if ("queued" in o) return { state: "queued", notBefore: o.notBefore };
  if ("held" in o) return { state: "held", reason: o.held };
  return { state: "failed" };
}

export async function sendForSigning(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  actorId: string,
  now: Date,
): Promise<SigningSent | SendForSigningError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id, email, approved_at, revoked_at, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = inv as InvitationToSend | null;
  if (!invitation) return NOT_FOUND;
  if (invitation.revoked_at) return REVOKED;
  if (invitation.submitted_at) return FILED;
  if (!invitation.approved_at) return NOT_APPROVED;

  // Read BEFORE the write, so the warning describes what the office knew when it pressed the button.
  const checklist = await applicantChecklist(admin, orgId, invitation.driver_id);
  const warnings = isChecklistError(checklist)
    ? [...OPEN_SIGNING_WARNS_ON]
    : checklist.steps
        .filter((s) => OPEN_SIGNING_WARNS_ON.includes(s.key) && s.state !== "done")
        .map((s) => s.key);

  const signLinkExpiresAt = new Date(now.getTime() + SIGN_LINK_LIFETIME_HOURS * 3_600_000).toISOString();
  const { data: started, error: startError } = await admin
    .from("application_invitations")
    .update({ sign_link_expires_at: signLinkExpiresAt, unlock_failures: 0 })
    .eq("org_id", orgId)
    .eq("id", invitation.id)
    .is("revoked_at", null)
    .is("submitted_at", null)
    .not("approved_at", "is", null)
    .select("id");
  if (startError) return { code: "send_for_signing_failed", message: startError.message };
  if (((started ?? []) as unknown[]).length !== 1) {
    return { code: "link_changed", message: "That application changed while you were looking at it. Reload and try again." };
  }

  const { invite_ttl_days: days } = await recruitingSettings(admin, orgId); // Q-AW41
  const { token, hash } = mintInvitationToken();
  const { data: openedAt, error } = await admin.rpc("open_packet_signing", {
    p_org: orgId,
    p_invitation: invitation.id,
    p_sign_token_hash: hash,
    p_extend_days: days,
  });
  if (error) {
    if (error.code === "AI006") return NOT_APPROVED;
    if (error.code === "AI002") return REVOKED;
    if (error.code === "AI003") return FILED;
    if (error.code === "AI001") return NOT_FOUND;
    return { code: "send_for_signing_failed", message: error.message };
  }

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "compliance.packet_signing_sent",
    entity: "application_invitations",
    entityId: invitation.id,
    // Never the token or its hash — an audit log is the last place a credential should be recoverable.
    meta: { driverId: invitation.driver_id, warnings, signLinkExpiresAt },
  });

  const link = `${env.WEB_APP_URL}/apply/${token}`;
  const carrier = await carrierName(admin, orgId);
  const email = await deliverApplicationMail(
    env, invitation.email, renderSigningLinkEmail(carrier, link, SIGN_LINK_LIFETIME_HOURS),
  );
  const text = await sendOrQueueSms(admin, env, {
    orgId, driverId: invitation.driver_id, invitationId: invitation.id, template: "signing_link", params: {},
  }, now);

  return { warnings, signingOpenedAt: String(openedAt), signLinkExpiresAt, email, text: textOutcome(text) };
}
