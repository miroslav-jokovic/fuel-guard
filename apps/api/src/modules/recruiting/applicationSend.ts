import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_SEND_WARNS_ON,
  INVITE_TTL_DAYS_DEFAULT,
  renderApplicationSentEmail,
  type HiringStepKey,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { carrierName, deliverApplicationMail, type ApplicationInviteDelivery } from "./applicationMail.js";

/**
 * The office sends the applicant the application form (AF4, D-AF5, D-AF7).
 *
 * ── WHAT IT DOES, IN ORDER ────────────────────────────────────────────────────────────────────
 * Mints a fresh token and hands it to `send_application_invitation` (0365), which rotates the link
 * in place, stamps `application_sent_at` the first time only, and extends the expiry without ever
 * shortening it — reviving a link that lapsed while the office waited on a lab. Then the audit row,
 * then the email. The link goes back on screen as well as by email (D-AF7): SMS cannot carry it
 * (memo Q12), and `MAIL_FROM` is a personal address until the owner's sender arrives, so the screen
 * is the delivery path that always works.
 *
 * ── IT WARNS, IT NEVER REFUSES, ON SCREENING (D-AF5) ──────────────────────────────────────────
 * Nothing in law puts screening before the application; the owner's order does, and an office that
 * sends early has chosen to. So the answer names what is still outstanding — read from the SAME
 * fold the checklist shows (`applicantChecklist`), so the warning and the row beside the button
 * cannot disagree — and sends anyway. The refusals are the database's: no permissions yet (AI005),
 * revoked (AI002), already filed (AI003).
 *
 * ⚠ A second press rotates and re-sends — the email was lost, or went to the wrong address — and
 * the stamp keeps its FIRST date, which is the one the checklist shows. The previous link dies, and
 * the email says so.
 */

export type ApplicationSendError = { code: string; message: string };
export const isApplicationSendError = (v: object): v is ApplicationSendError => "code" in v && "message" in v;

export interface ApplicationSent {
  /** The only copy of the new link. Not stored, not re-derivable, not returned again. */
  link: string;
  /** The screening steps not done yet (D-AF5). Step KEYS — the screen reads their words from the catalogue. */
  warnings: HiringStepKey[];
  applicationSentAt: string;
  delivery: ApplicationInviteDelivery;
}

const NOT_FOUND: ApplicationSendError = {
  code: "application_not_found",
  message: "That application is not in this organization.",
};

export async function sendApplication(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  actorId: string,
): Promise<ApplicationSent | ApplicationSendError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id, email")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = inv as { id: string; driver_id: string; email: string | null } | null;
  if (!invitation) return NOT_FOUND;

  // Read BEFORE the write, so the warning describes what the office knew when it pressed Send.
  const checklist = await applicantChecklist(admin, orgId, invitation.driver_id);
  const warnings = isChecklistError(checklist)
    ? [...APPLICATION_SEND_WARNS_ON]
    : checklist.steps
        .filter((s) => APPLICATION_SEND_WARNS_ON.includes(s.key) && s.state !== "done")
        .map((s) => s.key);

  const { token, hash } = mintInvitationToken();
  const { data: sentAt, error } = await admin.rpc("send_application_invitation", {
    p_org: orgId,
    p_invitation: invitation.id,
    p_token_hash: hash,
    p_extend_days: INVITE_TTL_DAYS_DEFAULT,
  });
  if (error) {
    if (error.code === "AI005") {
      return {
        code: "permissions_incomplete",
        message: "The applicant has not signed every permission yet, so there is nothing to send.",
      };
    }
    if (error.code === "AI002") {
      return { code: "invitation_revoked", message: "This invitation was revoked. Nothing was sent." };
    }
    if (error.code === "AI003") {
      return { code: "already_filed", message: "The application is already filed." };
    }
    if (error.code === "AI001") return NOT_FOUND;
    return { code: "send_failed", message: error.message };
  }

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "compliance.application_sent",
    entity: "application_invitations",
    entityId: invitation.id,
    // Never the token or its hash — an audit log is the last place a credential should be recoverable.
    meta: { driverId: invitation.driver_id, warnings },
  });

  const link = `${env.WEB_APP_URL}/apply/${token}`;
  const carrier = await carrierName(admin, orgId);
  const delivery = await deliverApplicationMail(
    env, invitation.email, renderApplicationSentEmail(carrier, link, INVITE_TTL_DAYS_DEFAULT),
  );
  return { link, warnings, applicationSentAt: String(sentAt), delivery };
}
