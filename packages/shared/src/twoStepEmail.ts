import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";
import { TWO_STEP_CODE_MINUTES, TWO_STEP_DAYS } from "./secondFactorContract.js";

/**
 * The email that carries a two-step sign-in code (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20). Pure, so the copy is
 * testable and the API's mailer only transports it; its own file for `passwordResetEmail.ts`'s reason.
 *
 * NO LINK, on purpose: the recipient's mail security opens every link in a message within a minute of delivery
 * (`docs/EMAIL-LINK-DELIVERY.md`), so a one-click "it's me" would be clicked by Proofpoint, not the person. A code
 * has to be typed by somebody looking at the sign-in page — which is the whole point of it.
 *
 * The code is in the SUBJECT too: a phone's notification shows it without opening the mail, and the subject
 * names nothing but the product, so a locked screen shows a dead-in-ten-minutes number and no account.
 */
export function renderTwoStepCodeEmail(code: string): RenderedEmail {
  const subject = `${code} is your Silvicom 360 sign-in code`;
  const life = `The code works once, for ${TWO_STEP_CODE_MINUTES} minutes. After it, this browser is not asked again for ${TWO_STEP_DAYS} days.`;
  const unasked =
    "If you didn't just sign in, somebody has your password: don't share this code, and change your password from the sign-in page (Forgot password).";
  const spaced = code.split("").join(" ");
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">` +
    `<h2 style="margin:0 0 8px">Your sign-in code</h2>` +
    `<p style="color:#555">Enter this code on the Silvicom 360 sign-in page:</p>` +
    `<p style="margin:20px 0;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,monospace">${esc(code)}</p>` +
    `<p style="color:#888;font-size:12px">${esc(life)}</p>` +
    `<p style="color:#555;font-size:12px"><strong>${esc(unasked)}</strong></p>` +
    `</div>`;
  const text = `Your Silvicom 360 sign-in code: ${spaced}\n\n${life}\n\n${unasked}`;
  return { subject, html, text };
}
