import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";
import { PASSWORD_RESET_TTL_MINUTES } from "./passwordResetContract.js";

/**
 * The two emails a password reset sends. Pure — no I/O — so the copy is testable and the API's
 * mailer only transports it. Their own file because `email.ts` was 388 lines of a 500-line budget.
 *
 * Both say plainly what to do when the person did NOT ask. That is the one line of the reset email
 * that matters when somebody else typed the address into the form, and the whole point of the second
 * email: a password changed by an attacker is announced to the owner, who can act on it.
 */

/**
 * The link. `sentByAdmin` changes the opening sentence only — the person should know whether they
 * asked or their administrator did, because "I didn't ask for this" means something different in
 * each case.
 */
export function renderPasswordResetEmail(resetUrl: string, sentByAdmin: boolean): RenderedEmail {
  const subject = "Reset your Silvicom 360 password";
  const opening = sentByAdmin
    ? "Your administrator sent you a link to choose a new Silvicom 360 password."
    : "Somebody asked to reset the password for this Silvicom 360 account.";
  const unasked = sentByAdmin
    ? "If you weren't expecting this, ask your administrator before using the link."
    : "If it wasn't you, ignore this email. Your password stays the same until the link is used.";
  const life = `The link works once, for ${PASSWORD_RESET_TTL_MINUTES} minutes. A newer reset email replaces this one.`;
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">` +
    `<h2 style="margin:0 0 8px">Reset your password</h2>` +
    `<p style="color:#555">${esc(opening)}</p>` +
    `<p style="margin:20px 0"><a href="${esc(resetUrl)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choose a new password →</a></p>` +
    `<p style="color:#888;font-size:12px">If the button doesn't work, paste this link into your browser:<br>${esc(resetUrl)}</p>` +
    `<p style="color:#aaa;font-size:12px">${esc(life)} ${esc(unasked)}</p>` +
    `</div>`;
  const text = `Reset your password\n\n${opening}\n\nChoose a new password: ${resetUrl}\n\n${life}\n${unasked}`;
  return { subject, html, text };
}

/** The notice after the fact. Carries no link that changes anything — only where to sign in. */
export function renderPasswordChangedEmail(loginUrl: string): RenderedEmail {
  const subject = "Your Silvicom 360 password was changed";
  const body =
    "The password for this Silvicom 360 account was just changed, and every device that was signed in has been signed out.";
  const unasked =
    "If you didn't do this, contact your administrator now — somebody else may have access to your email.";
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">` +
    `<h2 style="margin:0 0 8px">Your password was changed</h2>` +
    `<p style="color:#555">${esc(body)}</p>` +
    `<p style="color:#555"><strong>${esc(unasked)}</strong></p>` +
    `<p style="margin-top:16px"><a href="${esc(loginUrl)}" style="color:#4f46e5">Sign in to Silvicom 360 →</a></p>` +
    `</div>`;
  const text = `Your password was changed\n\n${body}\n\n${unasked}\n\nSign in: ${loginUrl}`;
  return { subject, html, text };
}
