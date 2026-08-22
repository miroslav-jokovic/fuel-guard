import type { Env } from "../env.js";

/**
 * Provider-agnostic SMS sender (A11b) — `mailer.ts`'s shape, deliberately.
 *
 * Plain fetch, no SDK; `none` is a no-op so the app runs unchanged with nothing configured, which is
 * how it ships. The one structural difference from the mailer is that this refuses to send at all
 * unless a caller has already proved consent and a civil hour: `sendSms` takes bytes to a number, and
 * every decision about WHETHER lives in `applicationSms.ts` where it can be tested without a provider.
 *
 * ── ⚠ NOTHING HERE HAS EVER TALKED TO A REAL CARRIER ──────────────────────────────────────────
 * 10DLC brand and campaign registration is an owner + Twilio act with a multi-week lead time (§6),
 * started at A1 and not complete. Until it is, `SMS_PROVIDER` stays `none`, every send is a no-op that
 * returns `ok: false`, and the request shape below is written from Twilio's published REST API rather
 * than from a response anybody has seen. It is wired, tested against a stub, and unproven against the
 * wire — and that is stated here rather than discovered by whoever turns it on.
 */

export interface OutgoingSms {
  to: string;
  /** The whole message, INCLUDING the sender identification carriers require. */
  body: string;
}

export interface SmsResult {
  ok: boolean;
  provider: "twilio" | "none";
  status?: number;
  detail?: string;
  /** The provider's id for the message, for matching a delivery receipt later. */
  messageId?: string;
}

/**
 * Send one message.
 *
 * ⚠ It does NOT check consent, quiet hours or opt-out state. That is not an omission: those checks
 * need the database and the clock, they are the entire risk surface, and burying them behind a
 * transport function would make them untestable without a provider. `applicationSms.ts` owns them and
 * is the only caller.
 */
export async function sendSms(env: Env, message: OutgoingSms): Promise<SmsResult> {
  try {
    if (env.SMS_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: message.to, From: env.TWILIO_FROM, Body: message.body }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = (await r.json().catch(() => null)) as { sid?: string; message?: string } | null;
      if (!r.ok) {
        // Never the message body: it names a driver and carries their link.
        console.error(`[sms] twilio ${r.status} ${body?.message ?? ""} | to=${redactNumber(message.to)}`);
      }
      return { ok: r.ok, provider: "twilio", status: r.status, detail: body?.message, messageId: body?.sid };
    }
    return { ok: false, provider: "none", detail: "No SMS provider configured" };
  } catch (e) {
    return { ok: false, provider: env.SMS_PROVIDER, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A number, in a log.
 *
 * The root CLAUDE.md's rule — never log PII — with a phone number treated as PII, because in this
 * product it is the one identifier that reaches a person directly. The last four are enough to match
 * a complaint to a send and useless to anyone reading a log dump.
 */
export const redactNumber = (phone: string): string =>
  phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
