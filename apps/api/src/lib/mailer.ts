import type { Env } from "../env.js";

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** A function that delivers an email; returns whether it was sent. Injectable for tests. */
export type Sender = (email: OutgoingEmail) => Promise<boolean>;

/**
 * Provider-agnostic email sender (plain fetch, no SDK). Set MAIL_PROVIDER to 'resend' or 'brevo'
 * (Brevo has the largest free tier ~9k/mo; Resend is simplest). 'none' = no-op so the app still runs.
 *
 * Common Resend failure reasons (check Railway logs):
 *   403 "domain not verified" → go to resend.com/domains, add silvicominc.com and verify DNS records.
 *   422 "Invalid `from` field" → MAIL_FROM must be "Name <email@verified-domain.com>".
 *   401 "Unauthorized" → RESEND_API_KEY is wrong or not set.
 */
export function makeSender(env: Env): Sender {
  return async (email) => {
    try {
      if (env.MAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env.MAIL_FROM, to: email.to, subject: email.subject, html: email.html, text: email.text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => null) as { name?: string; message?: string } | null;
          console.error(`[mailer] resend ${r.status} ${body?.name ?? ""}: ${body?.message ?? "(no message)"} | from=${env.MAIL_FROM} to=${email.to.join(",")}`);
        }
        return r.ok;
      }
      if (env.MAIL_PROVIDER === "brevo" && env.BREVO_API_KEY) {
        const r = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sender: { email: env.MAIL_FROM },
            to: email.to.map((e) => ({ email: e })),
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => null) as { message?: string; code?: string } | null;
          console.error(`[mailer] brevo ${r.status} ${body?.code ?? ""}: ${body?.message ?? "(no message)"} | from=${env.MAIL_FROM} to=${email.to.join(",")}`);
        }
        return r.ok;
      }
      console.warn("[mailer] no provider active (MAIL_PROVIDER=none or API key missing) — email skipped");
      return false;
    } catch (e) {
      console.error("[mailer] send failed (network/timeout):", e);
      return false;
    }
  };
}
