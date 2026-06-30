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
 */
export function makeSender(env: Env): Sender {
  return async (email) => {
    try {
      if (env.MAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env.MAIL_FROM, to: email.to, subject: email.subject, html: email.html, text: email.text }),
        });
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
        });
        return r.ok;
      }
      return false; // no provider configured
    } catch (e) {
      console.error("[mailer] send failed:", e);
      return false;
    }
  };
}
