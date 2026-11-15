import type { SupabaseClient } from "@supabase/supabase-js";
import { renderApplicationQuestionEmail } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { carrierName } from "./applicationMail.js";

/**
 * Telling the applicant the office has a question (APPLICATION-FIX-PLAN.md F5, stage 3).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * A question on a link nobody opens is not asked. After their Send the applicant's page is a wait
 * screen and they have no reason to come back; this is the reason.
 *
 * ── ONE NOTICE FOR A ROUND OF QUESTIONS ───────────────────────────────────────────────────────
 * Sent when a question is asked and none was already waiting (`askAgain` decides). An office that asks
 * three things in a minute has sent one e-mail, and the applicant finds all three on the link.
 *
 * ── A REFUSAL IS AN OUTCOME, NEVER A FAILURE ──────────────────────────────────────────────────
 * `notifyApplicationApproved`'s rule: the question is stored and audited before this is called, and
 * what this returns is said to the office beside it — "not e-mailed, text or call them" — never
 * raised. A question that rolled back because a mail provider was rate-limited would be lost work.
 *
 * ⚠ **No text message yet.** A new kind of text needs its wording in the SMS programme's own
 * catalogue (`smsConsentContract.ts`, SMS-OPT-IN-PLAN §6) and the consent it is sent under; that is
 * its own change, and the office is told plainly that only an e-mail went.
 */
export interface AskAgainNotice {
  sent: boolean;
  /** Where it went, so the office reads the address without re-reading the application. */
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed`; null when it went. */
  reason: string | null;
}

export async function notifyAskAgain(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  email: string | null,
): Promise<AskAgainNotice> {
  if (!email) return { sent: false, email: null, reason: "no_address" };
  if (env.MAIL_PROVIDER === "none") return { sent: false, email, reason: "mail_disabled" };
  const mail = renderApplicationQuestionEmail(await carrierName(admin, orgId));
  const result = await sendEmail(env, { to: [email], subject: mail.subject, html: mail.html, text: mail.text });
  if (!result.ok) console.error("[application-ask-again] could not send", { detail: result.detail });
  return { sent: result.ok, email, reason: result.ok ? null : "send_failed" };
}
