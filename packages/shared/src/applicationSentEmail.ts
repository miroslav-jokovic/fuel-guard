import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";

/**
 * The email the office's "Send the application" act sends (AF4, D-AF7).
 *
 * ── WHY NOT THE INVITATION EMAIL AGAIN ────────────────────────────────────────────────────────
 * Since D-AF1 the link is visited twice: the permissions first, and the application only once the
 * office has screened the applicant and sent it. Sending ROTATES the link (0365, the 0232 pattern:
 * the plaintext was never kept, and a new invitation would open an empty form), so the link in the
 * applicant's first email stops working the moment this one goes. An applicant who found the old
 * email first would be told "this link is not valid" and ring the carrier for a new one. The one
 * sentence that prevents that call is the difference from the invitation's copy.
 *
 * Its own file because `email.ts` sits at 390 of its 500 lines — `passwordResetEmail.ts`'s reason.
 */
export const applicationSentSubject = (carrier: string): string =>
  `${carrier}: your driver application is ready`;

export function renderApplicationSentEmail(
  carrier: string,
  applyUrl: string,
  expiresInDays: number,
): RenderedEmail {
  const subject = applicationSentSubject(carrier);
  const days = `${expiresInDays} ${expiresInDays === 1 ? "day" : "days"}`;
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">`
    + `<h2 style="margin:0 0 8px">Your application with ${esc(carrier)} is ready</h2>`
    + `<p style="color:#555">Thank you for signing the permissions. ${esc(carrier)} has sent you the `
    + `application itself. Your answers save as you go, so you can close the page and come back.</p>`
    + `<p style="margin:20px 0"><a href="${esc(applyUrl)}" style="background:#4f46e5;color:#fff;`
    + `padding:10px 16px;border-radius:6px;text-decoration:none">Open my application →</a></p>`
    + `<p style="color:#888;font-size:12px">If the button doesn't work, paste this link into your `
    + `browser:<br>${esc(applyUrl)}</p>`
    + `<p style="color:#aaa;font-size:12px">Use this link from now on — the one in the earlier email no `
    + `longer works. It is yours alone and stops working in ${days}.</p>`
    + `</div>`;
  const text =
    `Your application with ${carrier} is ready.\n\n`
    + `Thank you for signing the permissions. ${carrier} has sent you the application itself. Your `
    + `answers save as you go, so you can close the page and come back.\n\n`
    + `Open your application: ${applyUrl}\n\n`
    + `Use this link from now on — the one in the earlier email no longer works. It is yours alone `
    + `and stops working in ${days}.`;
  return { subject, html, text };
}
