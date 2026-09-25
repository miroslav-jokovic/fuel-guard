import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_SEND_WARNS_ON,
  INVITE_TTL_DAYS_DEFAULT,
  renderApplicationSentEmail,
  smsApplicationReady,
  type HiringStepKey,
  type SmsHoldReason,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { carrierName, deliverApplicationMail, type ApplicationInviteDelivery } from "./applicationMail.js";
import { sendApplicationSms, type SmsOutcome } from "./applicationSms.js";

/**
 * The office sends the applicant the application form (AF4, D-AF5, D-AF7).
 *
 * ── WHAT IT DOES, IN ORDER ────────────────────────────────────────────────────────────────────
 * Mints a fresh token and hands it to `send_application_invitation` (0365), which rotates the link
 * in place, stamps `application_sent_at` the first time only, and extends the expiry without ever
 * shortening it — reviving a link that lapsed while the office waited on a lab. Then the audit row,
 * then the text, then the email. The link goes back on screen as well (D-AF7): `MAIL_FROM` is a
 * personal address until the owner's sender arrives, and a text goes only to an applicant who agreed
 * to one on their waiting screen (SMS-OPT-IN-PLAN D-SMS1, D-SMS7) — so the screen is the delivery
 * path that always works.
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
  /** D-SMS7: whether the link also went by text, and if not, the gate that held it. */
  text: ApplicationTextOutcome;
}

/**
 * `no_consent` is the ordinary answer — most applicants will not have agreed — and the panel reads
 * it as "not agreed to texts" rather than as a failure. `quiet_hours` means held, not dropped: the
 * email and the screen already carry the link, so nothing retries it.
 */
export interface ApplicationTextOutcome {
  sent: boolean;
  reason: SmsHoldReason | "send_failed" | null;
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
  // D-SMS7: a text as well, when the applicant agreed to one on their waiting screen. Attempted
  // FIRST and the email goes regardless, as the nudge and the approval notice already do — every
  // gate that can refuse the text leaves the email and the on-screen link untouched.
  const texted = await sendApplicationSms(
    admin, env, orgId, invitation.driver_id, smsApplicationReady(carrier, link), new Date(),
  );
  const delivery = await deliverApplicationMail(
    env, invitation.email, renderApplicationSentEmail(carrier, link, INVITE_TTL_DAYS_DEFAULT),
  );
  return { link, warnings, applicationSentAt: String(sentAt), delivery, text: textOutcome(texted) };
}

/** The office's reading of the text, in the words its panel needs and nothing it does not. */
const textOutcome = (o: SmsOutcome): ApplicationTextOutcome =>
  o.sent ? { sent: true, reason: null } : { sent: false, reason: "held" in o ? o.held : "send_failed" };
