import type { SupabaseClient } from "@supabase/supabase-js";
import type { RenderedEmail } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";

/**
 * Sending an applicant their link — the one mailer for every email that carries one (AF4, D-AF7).
 *
 * ── WHY IT MOVED OUT OF THE INVITATION ROUTE ──────────────────────────────────────────────────
 * It was a private function inside `routes/applicationInvites.ts`, and until AF4 that route was the
 * only one that emailed a link. "Send the application" is a second, and a copy of these twenty lines
 * in the new route would be a second mailer for one kind of message: the next change to how a
 * refused send is reported would be made in one of them. Each caller renders its own words — the
 * invitation and the sent application say different things — and this carries them.
 *
 * ⚠ **Sending never decides whether the act happened.** Both callers commit their write and their
 * audit row BEFORE calling this, and a refused send is an outcome reported beside the link, never
 * raised: the office still has the link on screen and can pass it on any way it likes. The token
 * cannot be re-derived, so an act that rolled back over a rate-limited provider would leave the
 * applicant with nothing and the office with no way to know why.
 */

/** What became of the email. `sent: false` is an outcome to report, never a reason to fail. */
export interface ApplicationInviteDelivery {
  sent: boolean;
  /** Where it went, echoed so the UI can name the address without re-reading the row. */
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed`. null when it went. */
  reason: string | null;
}

/**
 * The carrier's own name, which is what the applicant recognises — they applied to a trucking
 * company, not to this product. Falls back rather than failing: an email that says "the carrier" is
 * worth sending; a link that did not go out because an org row was missing a name is not.
 */
export async function carrierName(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "the carrier";
}

export async function deliverApplicationMail(
  env: Env,
  email: string | null,
  mail: RenderedEmail,
): Promise<ApplicationInviteDelivery> {
  if (!email) return { sent: false, email: null, reason: "no_address" };
  // Checked here rather than left to the mailer so the UI can distinguish "we are not configured to
  // send" from "the provider refused". The first is an admin's problem and the second is the
  // applicant's address; telling a recruiter the wrong one sends them to the wrong person.
  if (env.MAIL_PROVIDER === "none") return { sent: false, email, reason: "mail_disabled" };

  const result = await sendEmail(env, { to: [email], subject: mail.subject, html: mail.html, text: mail.text });
  if (!result.ok) {
    // Loud: the recruiter sees "could not send" and can act, but nobody sees WHY without this.
    console.error("[application-mail] could not send", { subject: mail.subject, detail: result.detail });
  }
  return { sent: result.ok, email, reason: result.ok ? null : "send_failed" };
}
