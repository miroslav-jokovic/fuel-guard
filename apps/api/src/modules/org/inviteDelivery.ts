import { renderInviteEmail } from "@silvicom/shared";
import { makeSender } from "../../lib/mailer.js";
import type { Env } from "../../env.js";

/**
 * Turning an invitation into something that reaches a person.
 *
 * Split out of `routes/invites.ts` on 2026-09-02 when the delete endpoint took that file to 513 of
 * the 500-line budget. The seam is not arbitrary: everything here is about the LINK and the
 * MESSAGE, and nothing here knows what an `invites` row is. The router owns the row; this owns the
 * delivery.
 */
export interface InviteDelivery {
  sent: boolean;
  /** The accept link — always returned when built, so an admin can copy/share it even if email fails. */
  link: string | null;
  /** Why email wasn't sent: mail_disabled | send_failed. null when sent. */
  reason: string | null;
}

/**
 * Build the accept link and send it through OUR mailer (Resend/Brevo).
 *
 * ── WHAT THE LINK CARRIES, AND WHAT IT NO LONGER CARRIES (2026-09-04) ────────────────────────────
 * `token` is the invitation's own credential, minted by the caller (`lib/linkToken.ts`) and stored
 * hashed on the `invites` row. Nothing from GoTrue is in the email any more. Until this date the
 * link carried a Supabase one-time token — first `action_link`, then a `token_hash` of our own —
 * and the header of `lib/linkToken.ts` records the three ways that lost invitations. The short
 * version: a mail-security scanner spent it, its one-hour life contradicted the seven days the
 * email promised, and a resend killed the email already in the inbox.
 *
 * Because the token is inert until a password is submitted to `POST /api/public/invites/redeem`,
 * a scanner that fetches — or fully renders — this link finds a form and nothing else.
 *
 * The link is ALWAYS returned so invites work even when email delivery is misconfigured (the admin
 * can copy + share it directly).
 */
export async function deliverInvite(
  env: Env,
  orgName: string,
  email: string,
  token: string,
): Promise<InviteDelivery> {
  const link = `${env.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  if (env.MAIL_PROVIDER === "none") return { sent: false, link, reason: "mail_disabled" };

  const mail = renderInviteEmail(orgName, link);
  const sent = await makeSender(env)({
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  return { sent, link, reason: sent ? null : "send_failed" };
}
