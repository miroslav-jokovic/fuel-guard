import type { Env } from "../env.js";

/**
 * Provider-agnostic SMS sender (A11b) — `mailer.ts`'s shape, deliberately.
 *
 * Plain fetch, no SDK; `none` is a no-op so the app runs unchanged with nothing configured, which is
 * how it ships. The one structural difference from the mailer is that this refuses to send at all
 * unless a caller has already proved consent and a civil hour: `sendSms` takes bytes to a number, and
 * every decision about WHETHER lives in `applicationSms.ts` where it can be tested without a provider.
 *
 * ── THE PROVIDER IS TELNYX (2026-09-06) ───────────────────────────────────────────────────────
 * Twilio was the placeholder this file was written against and was never configured — no account,
 * no number, `TWILIO_AUTH_TOKEN` unset in production, so inbound SMS was dormant rather than broken.
 * Its branch was REMOVED rather than kept beside the new one: two transports where one is used is a
 * second way to do this that nobody exercises, and the first thing to rot.
 *
 * ── ⚠ NOTHING HERE HAS EVER TALKED TO A REAL CARRIER ──────────────────────────────────────────
 * Measured 2026-09-06 against the live Telnyx account: the API key authenticates and the balance is
 * real, but the account holds **0 phone numbers and 0 messaging profiles**, so there is nothing to
 * send FROM. That plus 10DLC brand/campaign registration — an owner act with a multi-week lead time
 * (§6), started at A1 and not complete — is why `SMS_PROVIDER` stays `none`. Until then every send is
 * a no-op returning `ok: false`, and the request shape below is written from Telnyx's published v2
 * API rather than from a response anybody has seen. Wired, tested against a stub, unproven against
 * the wire — stated here rather than discovered by whoever turns it on.
 */

export interface OutgoingSms {
  to: string;
  /** The whole message, INCLUDING the sender identification carriers require. */
  body: string;
}

export interface SmsResult {
  ok: boolean;
  provider: "telnyx" | "none";
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
    // A sender is a number OR a messaging profile — Telnyx accepts either, and a profile picks a
    // number from its pool. Requiring one of the two rather than the number specifically is what lets
    // the account move to a pool later without this file changing.
    const sender = env.TELNYX_FROM
      ? { from: env.TELNYX_FROM }
      : env.TELNYX_MESSAGING_PROFILE_ID
        ? { messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID }
        : null;

    if (env.SMS_PROVIDER === "telnyx" && env.TELNYX_API_KEY && sender) {
      const r = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...sender, to: message.to, text: message.body }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await r.json().catch(() => null)) as {
        data?: { id?: string };
        errors?: Array<{ detail?: string; title?: string }>;
      } | null;
      // Telnyx reports failures as an `errors` array; take the first, title included, because
      // "Invalid phone number" and "Insufficient balance" arrive under the same status.
      const err = body?.errors?.[0];
      const detail = err ? [err.title, err.detail].filter(Boolean).join(": ") : undefined;
      if (!r.ok) {
        // Never the message body: it names a driver and carries their link.
        console.error(`[sms] telnyx ${r.status} ${detail ?? ""} | to=${redactNumber(message.to)}`);
      }
      return { ok: r.ok, provider: "telnyx", status: r.status, detail, messageId: body?.data?.id };
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

/**
 * The one inbound shape this product cares about, pulled out of a Telnyx webhook.
 *
 * Defensive on purpose, the way `parseSamsaraFuelEvent` is: a messaging profile emits several event
 * types down the same webhook — `message.sent`, `message.finalized`, delivery receipts — and only
 * `message.received` is a person texting us. Everything else must be recognised as *not a message*
 * rather than parsed into an empty one, because an empty `from` reaching `handleInboundSms` would be
 * a silent no-op that looks identical to an opt-out we failed to honour.
 *
 * ⚠ `to` is an ARRAY in Telnyx's payload and `from` is an object; neither is the flat string Twilio
 * sent. That difference is the whole reason this function exists rather than the route reading two
 * fields inline.
 */
export interface ParsedInboundSms {
  /** True only for a real inbound message — a receipt or profile event is not one. */
  isInbound: boolean;
  /** E.164 as the carrier gave it; `normalisePhone` in `applicationSms.ts` owns the canonical form. */
  from: string;
  text: string;
}

export function parseTelnyxInboundSms(body: unknown): ParsedInboundSms {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  const payload = data?.payload as { from?: { phone_number?: unknown }; text?: unknown } | undefined;
  const from = typeof payload?.from?.phone_number === "string" ? payload.from.phone_number : "";
  const text = typeof payload?.text === "string" ? payload.text : "";
  // The event type is the gate, not the presence of a `from`: `message.sent` carries one too, and
  // treating our OWN outbound message as an inbound STOP would revoke the consent we just used.
  return { isInbound: data?.event_type === "message.received" && from !== "", from, text };
}
