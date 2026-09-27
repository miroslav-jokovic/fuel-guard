import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SMS_CONSENT,
  SMS_MAX_NUMBERS_PER_LINK,
  canSendSmsAt,
  composeSmsConsent,
  isDraftSmsConsent,
  isHelpMessage,
  isStartMessage,
  isStopMessage,
  siteHostOf,
  smsHelpReply,
  normalisePhone,
  normaliseUsPhone,
  type SmsConsentStatus,
  type SmsHoldReason,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { redactNumber, sendSms } from "../../lib/sms.js";
import { isSuppressed, liftStopSuppressions, suppressNumber } from "./smsSuppressions.js";

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
  if (await isSuppressed(admin, orgId, phone)) return { sent: false, held: "suppressed" };
  if (!canSendSmsAt(now, timeZone)) return { sent: false, held: "quiet_hours" };

  const result = await sendSms(env, { to: phone, body });
  if (!result.ok) {
    console.error("[application-sms] send failed", { to: redactNumber(phone), detail: result.detail });
    return { sent: false, failed: result.detail ?? "send failed" };
  }
  return { sent: true, messageId: result.messageId };
}

/**
 * Where one applicant stands on texts (SMS-OPT-IN-PLAN D-SMS1, D-SMS6).
 *
 * ⚠ Read the way `liveConsent` reads, and that is the whole design: `agreed` means "a send would go
 * to this number" and nothing looser. A driver whose newer number was stopped while an older one is
 * still live IS still texted — to the older one — so that is what this reports, rather than a
 * "stopped" the sender would contradict.
 */
export async function smsConsentStatus(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<SmsConsentStatus> {
  const { data } = await admin
    .from("sms_consents")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("phone, granted_at, revoked_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .order("granted_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Array<{ phone: string; granted_at: string; revoked_at: string | null }>;
  const live = rows.find((r) => r.revoked_at === null);
  const shown = live ?? rows[0];
  return {
    offered: !isDraftSmsConsent(),
    state: live ? "agreed" : shown ? "stopped" : "none",
    // Four digits and never the number (D-SMS3) — this answer is also read on the bare link.
    phoneLast4: shown ? shown.phone.slice(-4) : null,
    grantedAt: shown?.granted_at ?? null,
    revokedAt: live ? null : (shown?.revoked_at ?? null),
  };
}

/**
 * Stop texting one applicant, however they asked (D-SMS6).
 *
 * 47 CFR §64.1200(a)(10), as the FCC's 2024 order amended it: consent may be revoked by any
 * reasonable means. STOP by text reaches `handleInboundSms`; this is every other means — the control
 * on their own card, or a recruiter recording a phone call. It revokes every live consent this
 * applicant holds, number by number, through the same `revoke_sms_consent` a STOP uses, so there is
 * one way a consent ends and the reason says which road it took.
 */
export async function withdrawSmsConsent(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  reason: string,
): Promise<number> {
  const { data } = await admin
    .from("sms_consents")
    .select("phone")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null);
  const phones = [...new Set(((data ?? []) as { phone: string }[]).map((r) => r.phone))];
  let revoked = 0;
  for (const phone of phones) {
    const { data: count } = await admin.rpc("revoke_sms_consent", { p_org: orgId, p_phone: phone, p_reason: reason });
    revoked += Number(count ?? 0);
  }
  return revoked;
}

/**
 * Every number agreed to on this link, revoked or not — counted from the link's own creation, so a
 * driver invited again (Q-AX6) starts a fresh count while one link cannot be cycled through numbers.
 * A link whose creation cannot be read counts every number the driver ever agreed to: the stricter
 * answer, rather than no cap at all.
 */
async function numbersAgreedOnLink(
  admin: SupabaseClient,
  invitation: { org_id: string; driver_id: string; id: string },
): Promise<Set<string>> {
  const { data: link } = await admin
    .from("application_invitations")
    .select("created_at")
    .eq("org_id", invitation.org_id)
    .eq("id", invitation.id)
    .maybeSingle();
  const since = (link as { created_at?: string } | null)?.created_at;
  let query = admin
    .from("sms_consents")
    .select("phone")
    .eq("org_id", invitation.org_id)
    .eq("driver_id", invitation.driver_id);
  if (since) query = query.gte("granted_at", since);
  const { data } = await query;
  return new Set(((data ?? []) as { phone: string }[]).map((r) => r.phone));
}

/**
 * Record an applicant's consent.
 *
 * The text is composed SERVER-side from `SMS_CONSENT` and stored on the row, like every other
 * instrument in this product: what somebody agreed to is a fact we can prove, and a client-authored
 * copy of it is worth nothing in the proceeding it exists for.
 *
 * ⚠ A second press on the same number answers with the consent already live and writes nothing
 * (`created: false`). The table is append-only evidence (0233); a double-tap on a phone must not
 * become two agreements, and must not send a second confirmation text either.
 *
 * G-2 (C2d2) adds three refusals, each because a new consent sends a confirmation text: a number that
 * is not a dialable US one (`normaliseUsPhone`); a number that texted STOP and has not texted START
 * (`number_stopped` — the page cannot undo what was said by text, see `smsSuppressions.ts`); and a
 * fourth different number on one link (`too_many_numbers`, `SMS_MAX_NUMBERS_PER_LINK`).
 */
export async function recordSmsConsent(
  admin: SupabaseClient,
  invitation: { org_id: string; driver_id: string; id: string },
  rawPhone: string,
  carrier: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<{ id: string; created: boolean } | { code: string; message: string }> {
  const { org_id: orgId, driver_id: driverId } = invitation;
  if (isDraftSmsConsent()) {
    return {
      code: "sms_consent_not_final",
      message:
        "This carrier has not published its final text-message wording yet, so it cannot be agreed to "
        + "today. You will still get your application by email.",
    };
  }
  const phone = normaliseUsPhone(rawPhone);
  if (!phone) return { code: "invalid_phone", message: "That does not look like a US mobile number." };

  const current = await liveConsent(admin, orgId, driverId);
  if (current && current.phone === phone) return { id: current.id, created: false };

  if (await isSuppressed(admin, orgId, phone)) {
    return {
      code: "number_stopped",
      message: "This number texted STOP to us. Reply START to any text we sent it, then turn texts on here again.",
    };
  }
  const used = await numbersAgreedOnLink(admin, invitation);
  if (!used.has(phone) && used.size >= SMS_MAX_NUMBERS_PER_LINK) {
    return {
      code: "too_many_numbers",
      message: `Texts can be turned on for ${SMS_MAX_NUMBERS_PER_LINK} different numbers on one application. `
        + "Tell the office if your number has changed.",
    };
  }

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
  return { id: String((data as { id?: string } | null)?.id ?? ""), created: true };
}

/** What an inbound message did: consents revoked, a HELP answered, STOP suppressions lifted by START. */
export interface InboundOutcome { revoked: number; helped: boolean; resumed: number }

/**
 * An inbound message — the opt-out path (A11b), and since C2d2 the way back (START).
 *
 * ⚠ This runs BEFORE anything else looks at the message. What counts as a STOP is `isStopMessage`'s
 * call, and its comment has the two kinds of keyword and why (G-2).
 *
 * The org is resolved FROM the number rather than accepted from the request, which is the same rule
 * every unauthenticated surface in this product follows — an inbound webhook must not be able to name
 * a tenant.
 */
export async function handleInboundSms(
  admin: SupabaseClient,
  env: Env,
  from: string,
  body: string,
  now: Date = new Date(),
): Promise<InboundOutcome> {
  const none: InboundOutcome = { revoked: 0, helped: false, resumed: 0 };
  const phone = normalisePhone(from);
  if (!phone) return none;

  // HELP is answered before anything else and independently of consent — see `smsHelpReply` for
  // why it bypasses every gate `sendApplicationSms` enforces. Checked ahead of STOP only because the
  // two are mutually exclusive by construction; neither keyword matches the other's text.
  if (isHelpMessage(body)) {
    const result = await sendSms(env, { to: phone, body: smsHelpReply(siteHostOf(env.WEB_APP_URL)) });
    if (!result.ok) console.error("[application-sms] HELP reply failed", { to: redactNumber(phone), detail: result.detail });
    return { ...none, helped: result.ok };
  }

  if (isStartMessage(body)) {
    const resumed = await liftStopSuppressions(admin, phone, now);
    if (resumed > 0) console.log("[application-sms] START honoured", { to: redactNumber(phone), resumed });
    return { ...none, resumed };
  }

  if (!isStopMessage(body)) return none;
  return { ...none, revoked: await honourStop(admin, phone, body) };
}

/**
 * A STOP, in every org that ever held a consent on the number (G-2, C2d2).
 *
 * ── EVERY LIVE CONSENT OF THE APPLICANT, NOT ONLY THIS NUMBER'S ────────────────────────────────
 * Until C2d2 a STOP revoked the consents on the number that sent it and nothing else, so an applicant
 * who had agreed on an old number and then on a new one, and texted STOP from the new one, was texted
 * on the old one next: the older consent had become the newest live one. A STOP is "do not text me",
 * so it now revokes every live consent each applicant on that number holds — through
 * `withdrawSmsConsent`, the same road the page's own control takes.
 *
 * ── AND THE NUMBER IS SUPPRESSED, EVEN WHERE NOTHING WAS LIVE ─────────────────────────────────
 * A number whose consent was already withdrawn on the page still said STOP, and agreeing again on the
 * page must not be able to overrule that (`recordSmsConsent`'s `number_stopped`). So every org that
 * ever held a consent on the number records the suppression, whether or not it revoked anything. Only
 * orgs that hold a consent on the number: a number no org knows has no tenant to be suppressed in.
 */
async function honourStop(admin: SupabaseClient, phone: string, body: string): Promise<number> {
  const { data } = await admin
    .from("sms_consents")
    .select("org_id, driver_id, granted_at")
    .eq("phone", phone)
    .order("granted_at", { ascending: false });
  const rows = (data ?? []) as { org_id: string; driver_id: string }[];
  const reason = `inbound: ${body.trim().slice(0, 60)}`;

  let revoked = 0;
  for (const orgId of [...new Set(rows.map((r) => r.org_id))]) {
    const drivers = [...new Set(rows.filter((r) => r.org_id === orgId).map((r) => r.driver_id))];
    for (const driverId of drivers) revoked += await withdrawSmsConsent(admin, orgId, driverId, reason);
    // The newest consent's applicant is the one the suppression names; the number is what it keys on.
    await suppressNumber(admin, orgId, drivers[0] ?? null, phone, "stop");
  }
  if (rows.length > 0) console.log("[application-sms] opt-out honoured", { to: redactNumber(phone), revoked });
  return revoked;
}
