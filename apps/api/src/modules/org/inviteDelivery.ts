import type { SupabaseClient } from "@supabase/supabase-js";
import { renderInviteEmail } from "@silvicom/shared";
import { makeSender } from "../../lib/mailer.js";
import type { Env } from "../../env.js";

/**
 * Turning an invitation into something that reaches a person.
 *
 * Split out of `routes/invites.ts` on 2026-09-02 when the delete endpoint took that file to 513 of
 * the 500-line budget. The seam is not arbitrary: everything here is about the LINK and the
 * MESSAGE — Supabase token generation and our mailer — and nothing here knows what an `invites` row
 * is. The router owns the row; this owns the delivery.
 */
export interface InviteDelivery {
  sent: boolean;
  /** The action link — always returned when generated, so an admin can copy/share it even if email fails. */
  link: string | null;
  /** Why email wasn't sent: mail_disabled | send_failed | link_failed. null when sent. */
  reason: string | null;
}

/**
 * Deliver an invite through OUR mailer (Resend/Brevo) instead of Supabase's built-in email. We ask
 * Supabase to GENERATE the action link (which also creates the auth user) without sending, then send
 * a branded email ourselves — reliable for external addresses and not subject to Supabase's
 * default-email limits. Falls back to a recovery link when the user already exists.
 *
 * ── WHY WE EMAIL OUR OWN URL AND NOT `action_link` (2026-09-02) ─────────────────────────────────
 * `properties.action_link` is `…/auth/v1/verify?token=…&type=invite&redirect_to=…`, and GoTrue
 * consumes that token on the FIRST HTTP GET — whoever makes it. Corporate mail security fetches
 * every link in an inbound message before the recipient sees it (Defender Safe Links, Proofpoint URL
 * Defense), so on those tenants the scanner spends the invite and the human's click arrives at
 * `/accept-invite#error=access_denied&error_code=otp_expired`. With no session, the SPA's router
 * guard sent them to /login with no explanation — which is the bug this replaces, and the reason
 * "the invite link just goes to the login page" was never reproducible in-house.
 *
 * So we email `${WEB_APP_URL}/accept-invite?token_hash=…&type=…` instead. A scanner's GET on that
 * lands on our own SPA route and consumes nothing; the token is redeemed by `verifyOtp` from the
 * page, which needs JavaScript the scanner does not run. `hashed_token` is the same credential the
 * action link carries — this changes WHO redeems it and when, not what it is.
 *
 * The link is ALWAYS returned so invites work even when email delivery is misconfigured (the admin
 * can copy + share it directly).
 */
export async function deliverInvite(
  admin: SupabaseClient,
  env: Env,
  orgName: string,
  email: string,
): Promise<InviteDelivery> {
  const redirectTo = `${env.WEB_APP_URL}/accept-invite`;
  // `type` travels with the token because the two are not interchangeable: `verifyOtp` must be told
  // which one it is holding, and a re-invite to an already-confirmed address is a RECOVERY token.
  const acceptUrl = (hashedToken: string, type: "invite" | "recovery") =>
    `${redirectTo}?token_hash=${encodeURIComponent(hashedToken)}&type=${type}`;

  let link: string | null = null;
  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (!invite.error && invite.data?.properties?.hashed_token) {
    link = acceptUrl(invite.data.properties.hashed_token, "invite");
  } else {
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (!recovery.error && recovery.data?.properties?.hashed_token)
      link = acceptUrl(recovery.data.properties.hashed_token, "recovery");
    else
      console.error(
        `[invites] generateLink failed for ${email}: ${invite.error?.message ?? ""} ${recovery.error?.message ?? ""}`,
      );
  }
  if (!link) return { sent: false, link: null, reason: "link_failed" };
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
