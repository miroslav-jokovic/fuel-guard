import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SMS_CONSENT,
  canSendSmsAt,
  composeSmsConsent,
  isDraftSmsConsent,
  isStopMessage,
  normalisePhone,
  type SmsHoldReason,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { redactNumber, sendSms } from "../lib/sms.js";

/**
 * Whether a text may be sent, and to whom (A11b, D-APP13).
 *
 * ── EVERY REFUSAL LIVES HERE, NONE OF THEM IN THE TRANSPORT ───────────────────────────────────
 * `lib/sms.ts` takes bytes to a number and asks no questions. This file asks all of them: is there a
 * live consent, is the wording published, is it a civil hour where they are, has the number been
 * revoked. That division is the point — the checks are the entire risk surface, they need the database
 * and the clock, and putting them behind the transport would make them untestable without a provider
 * we do not have. Turning `SMS_PROVIDER` on cannot bypass a single one of them.
 *
 * ── A HELD MESSAGE IS NEVER A DROPPED ONE ─────────────────────────────────────────────────────
 * Quiet hours return a hold, not a failure. The sweep that produced the message runs every six hours
 * and the send window is five wide, so a nudge held at 03:00 goes out the same day. Dropping would
 * mean a driver who agreed to be texted silently getting nothing, which is the outcome a consent
 * regime is least able to explain to the person who agreed.
 */

export type SmsOutcome =
  | { sent: true; messageId?: string }
  | { sent: false; held: SmsHoldReason }
  | { sent: false; failed: string };

interface LiveConsent {
  id: string;
  phone: string;
  driver_id: string;
}

/**
 * The one live consent for this driver, or null.
 *
 * Keyed on the DRIVER and filtered to un-revoked rows. A driver with two numbers and one `STOP` has
 * one live consent, and the send goes to that number — which is the shape `revoke_sms_consent`
 * assumes, because an inbound opt-out names a number and revokes every live consent on it.
 */
async function liveConsent(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<LiveConsent | null> {
  const { data } = await admin
    .from("sms_consents")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("id, phone, driver_id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LiveConsent | null) ?? null;
}

/**
 * Send one message to a driver, if every gate opens.
 *
 * ⚠ `timeZone` is very nearly always null: nothing in this product asks a driver where they live, and
 * `smsQuietHours.ts` explains at length why an area-code table would be a confident wrong answer
 * rather than a missing one. The strict all-US fallback is the normal path, not the exception.
 */
export async function sendApplicationSms(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverId: string,
  body: string,
  now: Date,
  timeZone: string | null = null,
): Promise<SmsOutcome> {
  // ⚠ Draft wording gates the SEND and not just the grant. A consent recorded under placeholder text
  // is not consent to anything, so a row that predates counsel's pass must not authorise a message —
  // the same reasoning that makes `recordRelease` refuse a signature under `v0-draft` (A0, Q-H3).
  if (isDraftSmsConsent()) return { sent: false, held: "no_consent" };

  const consent = await liveConsent(admin, orgId, driverId);
  if (!consent) return { sent: false, held: "no_consent" };
  const phone = normalisePhone(consent.phone);
  if (!phone) return { sent: false, held: "no_number" };
  if (!canSendSmsAt(now, timeZone)) return { sent: false, held: "quiet_hours" };

  const result = await sendSms(env, { to: phone, body });
  if (!result.ok) {
    console.error("[application-sms] send failed", { to: redactNumber(phone), detail: result.detail });
    return { sent: false, failed: result.detail ?? "send failed" };
  }
  return { sent: true, messageId: result.messageId };
}

/**
 * Record an applicant's consent.
 *
 * The text is composed SERVER-side from `SMS_CONSENT` and stored on the row, like every other
 * instrument in this product: what somebody agreed to is a fact we can prove, and a client-authored
 * copy of it is worth nothing in the proceeding it exists for.
 */
export async function recordSmsConsent(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  rawPhone: string,
  carrier: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<{ id: string } | { code: string; message: string }> {
  if (isDraftSmsConsent()) {
    return {
      code: "sms_consent_not_final",
      message:
        "This carrier has not published its final text-message wording yet, so it cannot be agreed to "
        + "today. You will still get your application by email.",
    };
  }
  const phone = normalisePhone(rawPhone);
  if (!phone) return { code: "invalid_phone", message: "That does not look like a US mobile number." };

  const doc = composeSmsConsent(SMS_CONSENT, carrier);
  const { data, error } = await admin
    .from("sms_consents")
    .insert({
      org_id: orgId,
      driver_id: driverId,
      phone,
      consent_text: doc.body,
      consent_version: doc.version,
      intent_statement: doc.intent,
      source: "application",
      granted_ip: ctx.ip,
      granted_user_agent: ctx.userAgent,
    })
    .select("id")
    .maybeSingle();
  if (error) return { code: "consent_failed", message: error.message };
  return { id: String((data as { id?: string } | null)?.id ?? "") };
}

/**
 * An inbound message — the opt-out path (A11b).
 *
 * ⚠ This runs BEFORE anything else looks at the message, and it revokes on a keyword match rather
 * than on an exact equality, because the asymmetry is not close: honouring "please stop" costs a
 * message nobody wanted to send, and missing it costs $500 to $1,500 and a complaint to a carrier
 * that can shut the number off.
 *
 * The org is resolved FROM the number rather than accepted from the request, which is the same rule
 * every unauthenticated surface in this product follows — an inbound webhook must not be able to name
 * a tenant.
 */
export async function handleInboundSms(
  admin: SupabaseClient,
  from: string,
  body: string,
): Promise<{ revoked: number }> {
  const phone = normalisePhone(from);
  if (!phone || !isStopMessage(body)) return { revoked: 0 };

  const { data } = await admin
    .from("sms_consents")
    .select("org_id")
    .eq("phone", phone)
    .is("revoked_at", null);
  const orgs = [...new Set(((data ?? []) as { org_id: string }[]).map((r) => r.org_id))];

  let revoked = 0;
  for (const orgId of orgs) {
    const { data: count } = await admin.rpc("revoke_sms_consent", {
      p_org: orgId,
      p_phone: phone,
      p_reason: `inbound: ${body.trim().slice(0, 60)}`,
    });
    revoked += Number(count ?? 0);
  }
  if (revoked > 0) console.log("[application-sms] opt-out honoured", { to: redactNumber(phone), revoked });
  return { revoked };
}
