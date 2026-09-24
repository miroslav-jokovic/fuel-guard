import type { SupabaseClient } from "@supabase/supabase-js";
import { carrierName } from "./applicationMail.js";
import { renderApplicationApprovedEmail } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { sendApplicationSms } from "./applicationSms.js";

/**
 * Telling the applicant they have been approved (Q-AX4, D-AX14; since AF5, D-AF3).
 *
 * ── THE SEAM THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * F4 made the application a two-visit document: the driver hands it over, the office reads and
 * corrects it, the driver comes back and certifies what now stands. Nothing carried the middle step.
 * The office approved days later and the only thing that told the driver was reopening their own link
 * on the off-chance — so the waiting screen promised nothing, and the recruiter's drawer said "the
 * applicant has been asked to sign it" when nobody had asked them anything.
 *
 * Q-AX4's candidates were (a) send it from the approval, (b) a separate "tell them it is ready"
 * button, (c) nothing and the recruiter phones. (a), because the office has already made its decision
 * by then and a step that can be forgotten is a step that will be forgotten.
 *
 * ── ⚠ WHY NOTHING HERE ROTATES A TOKEN ────────────────────────────────────────────────────────
 * There is no link to send. 0220 stores a SHA-256 and the plaintext is returned once at mint. The
 * abandonment sweep's answer is to rotate the hash and email the new token (0232), and that answer is
 * REJECTED here: `APPLY_FLOW_COPY.handoff` told this applicant "keep this link — it is where you will
 * sign, and it still works", and approval is the moment they act on it. Rotating would break the
 * product's one promise to them at the one moment it is load-bearing, and would open a lockout this
 * flow cannot afford — a nudge that fails to send costs a driver an unfinished form, an approval that
 * fails to send would cost them a COMPLETED application they can no longer reach.
 *
 * ── ⚠ AND SINCE AF5 NOTHING HERE MINTS ONE EITHER ─────────────────────────────────────────────
 * A5b (0345) minted a second, sign-only token here so this email could carry a link to sign from.
 * D-AF3 moved signing into the office, and 0369 refuses every mark until the office opens signing at
 * the desk — so a link sent now would open a packet that refuses every place on it. The sign link is
 * minted by the office's Open signing (`applicationOpenSigning.ts`), on the office's own screen, and
 * this notice tells the applicant the carrier will be in touch about the visit. No link, because
 * there is nothing on the link for them to do until then.
 *
 * ── A REFUSAL IS AN OUTCOME, NEVER A FAILURE ─────────────────────────────────────────────────
 * Same rule the invitation route set: the approval is committed and audited before this is called,
 * and whatever this returns is reported beside it rather than raised. An approval that rolled back
 * because a mail provider was rate-limited would strand a driver who is allowed to sign behind a
 * state that says they are not.
 */

/** What became of the notice. `sent: false` is a sentence for the recruiter, not an error. */
export interface ApprovalNotice {
  sent: boolean;
  /** Where it went, echoed so the drawer can name the address without re-reading the row. */
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed` | `already_notified`. null when it went. */
  reason: string | null;
  /** Whether a text also went out. Always false until 10DLC registration completes (A11b). */
  texted: boolean;
}

/**
 * The text, inside one 160-character segment.
 *
 * Carrier identification and a discoverable `STOP` are both required in the body by every US
 * messaging programme — see `smsBody` in the nudge sweep for the full reasoning. What is left says
 * the one thing this message exists to say. ⚠ No link, and since AF5 not even a pointer to one:
 * there is nothing to do on the application link until the office opens signing in person (D-AF3).
 */
export const approvedSmsBody = (carrier: string): string =>
  `${carrier}: your driver application has been approved. We will contact you about coming to our `
  + `office to sign it. Reply STOP to opt out.`;

/**
 * Tell one applicant their application has been approved, and that signing happens in the office.
 *
 * ⚠ The text is attempted FIRST and the email goes regardless, exactly as the nudge does. Every gate
 * that can refuse a message — no consent, draft wording, quiet hours, an opt-out — leaves the email
 * untouched, so a refused text is never an applicant hearing nothing.
 */
export async function notifyApplicationApproved(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverId: string,
  email: string | null,
  now: Date,
): Promise<ApprovalNotice> {
  if (!email) return { sent: false, email: null, reason: "no_address", texted: false };
  // Asked here rather than left to the mailer so the drawer can separate "we are not configured to
  // send" from "the provider refused it". The first is an administrator's problem and the second is
  // the applicant's address; sending a recruiter after the wrong one wastes the call.
  if (env.MAIL_PROVIDER === "none") return { sent: false, email, reason: "mail_disabled", texted: false };

  const carrier = await carrierName(admin, orgId);
  const texted = await sendApplicationSms(admin, env, orgId, driverId, approvedSmsBody(carrier), now);

  const mail = renderApplicationApprovedEmail(carrier);
  const result = await sendEmail(env, {
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!result.ok) {
    // Loud: the recruiter is told "could not send" and can pick up the phone, but nobody learns WHY
    // without this — and an approved applicant who has heard nothing is waiting on a call that
    // nobody knows they are waiting for.
    console.error("[application-approval] could not send", { detail: result.detail });
  }
  return { sent: result.ok, email, reason: result.ok ? null : "send_failed", texted: texted.sent };
}
