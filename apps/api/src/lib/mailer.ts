import type { Env } from "../env.js";

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** A function that delivers an email; returns whether it was sent. Injectable for tests. */
export type Sender = (email: OutgoingEmail) => Promise<boolean>;

export interface SendResult {
  ok: boolean;
  provider: "resend" | "brevo" | "none";
  status?: number;
  detail?: string;
}

/** Split a "Name <email@x.com>" MAIL_FROM into parts (Brevo needs a bare email; Resend takes the string). */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2]!.trim() };
  return { email: from.trim() };
}

/**
 * Provider-agnostic email sender (plain fetch, no SDK). Set MAIL_PROVIDER to 'resend' or 'brevo'
 * (Brevo has the largest free tier ~9k/mo; Resend is simplest). 'none' = no-op so the app still runs.
 *
 * Common Resend failure reasons (check Railway logs):
 *   403 "domain not verified" → go to resend.com/domains, add silvicominc.com and verify DNS records.
 *   422 "Invalid `from` field" → MAIL_FROM must be "Name <email@verified-domain.com>".
 *   401 "Unauthorized" → RESEND_API_KEY is wrong or not set.
 *
 * ── ⚠ THE PROVIDER CHOICE IS A SECURITY DECISION, NOT A PRICING ONE (2026-09-14) ───────────────
 * **Brevo rewrites every link in every message for click tracking, and keeps the destination URL in
 * its event log.** Some of the links this file carries are credentials — an application invitation
 * is a 256-bit bearer token in a URL, and `applicationIntake.ts` goes to some trouble to keep it out
 * of the database, out of every later API response, and out of the audit row, on the stated ground
 * that "an audit log is the last place a credential should be recoverable from".
 *
 * Measured, not suspected: on 2026-09-14 a live invitation link was read back out of
 * `GET /v3/smtp/statistics/events` in plaintext, and `sha256(token)` matched that invitation's
 * `token_hash` byte for byte. Anyone holding `BREVO_API_KEY` can enumerate live applicant links.
 *
 * It cannot be switched off here: Brevo's staff have said disabling transactional tracking is not
 * planned and is offered to Enterprise plans on request, and this account reports
 * `enterprise: false`. The `X-Mailin-Track` headers that circulate as a workaround are not in
 * Brevo's API reference and are not confirmed by them — do not ship one on the strength of a forum
 * post. **Resend disables open and click tracking by default on every domain**, which is why
 * `env.ts` now prefers it and warns on every boot that chooses Brevo.
 *
 * ⚠ The same measurement explains why mail to this carrier looks unread: across a month of events
 * NOT ONE `opened` was recorded for any `@silvicominc.com` address while external mailboxes opened
 * normally, and every link is machine-clicked within ~15 seconds of delivery, at any hour. Their
 * gateway strips the pixel and follows the links. On that domain "delivered" is evidence and
 * "clicked" is not.
 */
/** Send one email and return the provider's outcome (status + error detail) for diagnostics. */
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<SendResult> {
  try {
    if (env.MAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: email.to, subject: email.subject, html: email.html, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = r.ok ? null : ((await r.json().catch(() => null)) as { name?: string; message?: string } | null);
      const detail = body ? `${body.name ?? ""}: ${body.message ?? "(no message)"}` : undefined;
      if (!r.ok) console.error(`[mailer] resend ${r.status} ${detail} | from=${env.MAIL_FROM} to=${email.to.join(",")}`);
      return { ok: r.ok, provider: "resend", status: r.status, detail };
    }
    if (env.MAIL_PROVIDER === "brevo" && env.BREVO_API_KEY) {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: parseSender(env.MAIL_FROM), // { name?, email } — Brevo rejects a "Name <email>" string
          to: email.to.map((e) => ({ email: e })),
          subject: email.subject,
          htmlContent: email.html,
          textContent: email.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = r.ok ? null : ((await r.json().catch(() => null)) as { message?: string; code?: string } | null);
      const detail = body ? `${body.code ?? ""}: ${body.message ?? "(no message)"}` : undefined;
      if (!r.ok) console.error(`[mailer] brevo ${r.status} ${detail} | from=${env.MAIL_FROM} to=${email.to.join(",")}`);
      return { ok: r.ok, provider: "brevo", status: r.status, detail };
    }
    console.warn("[mailer] no provider active (MAIL_PROVIDER=none or API key missing) — email skipped");
    return { ok: false, provider: "none", detail: "No mail provider configured" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "network/timeout";
    console.error("[mailer] send failed:", detail);
    return { ok: false, provider: env.MAIL_PROVIDER, detail };
  }
}

export function makeSender(env: Env): Sender {
  return async (email) => (await sendEmail(env, email)).ok;
}
