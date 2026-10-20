import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SMS_OFFICE_INVITE_ATTESTATION,
  composeSmsConsent,
  isDraftSmsConsent,
  normaliseUsPhone,
  type ApplicationInviteTextOutcome,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { smsConfigured } from "../../lib/sms.js";
import { carrierName } from "./applicationMail.js";
import { sendOrQueueSms, type OutboxOutcome } from "./smsOutbox.js";
import { isSuppressed } from "./smsSuppressions.js";

/**
 * An invitation sent by text (APPLICATION-FLOW-V2-PLAN Q-AW55, ruled (a) 2026-10-20; SMS-OPT-IN-PLAN
 * D-SMS11; 0504).
 *
 * ── THE FIRST MESSAGE IS THE FIRST CONTACT ────────────────────────────────────────────────────
 * Every other text this product sends follows a box the applicant ticked on their own link
 * (`recordSmsConsent`). Here nobody has ticked anything: an applicant on the phone asked a recruiter to
 * text them the link. What makes that text lawful is the asking (47 CFR §64.1200(a)(2) — prior express
 * consent, oral is enough for an informational text), and what the carrier must be able to SHOW is
 * that they asked. So the recruiter's attestation — the mandatory checkbox beside the number — is
 * written as an `sms_consents` row under `source = 'office_invite'` and its own wording
 * (`SMS_OFFICE_INVITE_ATTESTATION`), and an audit row names the recruiter and the instant. From that row
 * on, the number is covered by everything 0233 built: an inbound STOP finds it, the suppression lands,
 * and every later text — the application link (D-SMS7), the reminder (A10) — rides the same consent.
 *
 * ── WHAT IS REFUSED, AND WHAT IS RECORDED REGARDLESS ──────────────────────────────────────────
 * The row is NOT written when the number cannot be texted at all: not a dialable US number; a number
 * that texted STOP and has not texted START (`smsSuppressions.ts` — an office cannot overrule what the
 * person said by text, any more than the applicant's own page can); draft wording. The row IS written
 * when texts are switched off for this account or the provider refuses: the attestation is a fact about
 * what the applicant asked, not about whether Telnyx answered, and the next text to that number should
 * not have to ask again. A second invitation on the number already live writes no second row (0233 is
 * append-only evidence; two agreements are not what happened).
 *
 * ── THROUGH THE OUTBOX, NEVER SEND-OR-DROP ───────────────────────────────────────────────────
 * A recruiter at their desk at 08:00 Chicago is inside their day and outside the strict all-US window
 * (`canSendSmsAt`): `sendApplicationSms` would drop the text and the recruiter's own words to the
 * applicant — "we will text you the link" — would be false. `sendOrQueueSms` (Q-AW29) holds it for the
 * window instead and mints the link then, on the invitation's TEXT token (0378), so the email's link and
 * the office's screen are untouched. The drawer says "will be texted at …" for that case.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS. The audit carries the last four
 * digits and never the number (D-SMS3's rule for every surface that is not the row itself).
 */

export interface InviteByTextInput {
  orgId: string;
  /** The recruiter who attested. Named by the audit row; the consent row has no column for a user. */
  userId: string;
  driverId: string;
  invitationId: string;
  /** The link's lifetime, as the text says it. */
  days: number;
  /** As typed in the drawer. Normalised here, refused here. */
  rawPhone: string;
  /** The recruiter's request — the attribution every signature in this product carries (0215, A4). */
  ctx: { ip: string | null; userAgent: string | null };
}

interface LiveConsentRow { id: string; phone: string }

/** The newest live consent for this driver, if any — `applicationSms.ts`'s question, asked here once. */
async function liveConsent(admin: SupabaseClient, orgId: string, driverId: string): Promise<LiveConsentRow | null> {
  const { data } = await admin
    .from("sms_consents")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("id, phone")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LiveConsentRow | null) ?? null;
}

const refused = (reason: ApplicationInviteTextOutcome["reason"], phone: string | null): ApplicationInviteTextOutcome =>
  ({ outcome: "refused", phoneLast4: phone ? phone.slice(-4) : null, notBefore: null, reason });

/** The drawer's reading of the outbox's answer, in the words it needs and nothing it does not. */
const outcomeOf = (o: OutboxOutcome, phone: string): ApplicationInviteTextOutcome => {
  const phoneLast4 = phone.slice(-4);
  if (o.sent) return { outcome: "sent", phoneLast4, notBefore: null, reason: null };
  if ("queued" in o) return { outcome: "queued", phoneLast4, notBefore: o.notBefore, reason: null };
  // A hold here is a consent the row above should have satisfied — reported as a failure, never hidden.
  return { outcome: "failed", phoneLast4, notBefore: null, reason: "send_failed" };
};

/**
 * Record the attestation, audit it, and send (or queue) the invitation text.
 *
 * Called AFTER the invitation row, its Part 1 row and its own audit are committed and the email has
 * gone (`createApplicationInvite`): the text never decides whether the invitation exists, and a refusal
 * here is an outcome reported beside the link, never an error — the recruiter still has the link on
 * screen and can pass it on any way they like.
 */
export async function inviteByText(
  admin: SupabaseClient,
  env: Env,
  input: InviteByTextInput,
  now: Date = new Date(),
): Promise<ApplicationInviteTextOutcome> {
  if (isDraftSmsConsent(SMS_OFFICE_INVITE_ATTESTATION)) return refused("sms_consent_not_final", null);
  const phone = normaliseUsPhone(input.rawPhone);
  if (!phone) return refused("invalid_phone", null);
  if (await isSuppressed(admin, input.orgId, phone)) return refused("number_stopped", phone);

  const current = await liveConsent(admin, input.orgId, input.driverId);
  let consentId = current?.phone === phone ? current.id : null;
  if (!consentId) {
    const doc = composeSmsConsent(SMS_OFFICE_INVITE_ATTESTATION, await carrierName(admin, input.orgId));
    const { data, error } = await admin
      .from("sms_consents")
      .insert({
        org_id: input.orgId,
        driver_id: input.driverId,
        phone,
        consent_text: doc.body,
        consent_version: doc.version,
        intent_statement: doc.intent,
        source: "office_invite",
        granted_ip: input.ctx.ip,
        granted_user_agent: input.ctx.userAgent,
      })
      .select("id")
      .maybeSingle();
    consentId = (data as { id?: string } | null)?.id ?? null;
    if (error || !consentId) {
      console.error("[invite-text] could not record the attestation", { detail: error?.message ?? "no row" });
      return refused("consent_failed", phone);
    }
  }

  await writeAudit(admin, {
    orgId: input.orgId,
    actorId: input.userId,
    action: "compliance.applicant_invited_by_text",
    entity: "sms_consents",
    entityId: consentId,
    // The ids, the wording's version and the last four digits. Never the number, never the link.
    meta: {
      driverId: input.driverId,
      invitationId: input.invitationId,
      attestationVersion: SMS_OFFICE_INVITE_ATTESTATION.version,
      phoneLast4: phone.slice(-4),
      reusedConsent: current?.phone === phone,
    },
  });

  // Asked here, not left to the transport, so the drawer can say "switched off for this account"
  // rather than "the text did not go" — `deliverApplicationMail`'s reason for `mail_disabled`.
  if (!smsConfigured(env)) return { outcome: "failed", phoneLast4: phone.slice(-4), notBefore: null, reason: "sms_disabled" };

  const sent = await sendOrQueueSms(admin, env, {
    orgId: input.orgId,
    driverId: input.driverId,
    invitationId: input.invitationId,
    template: "invite",
    params: { days: input.days },
  }, now);
  return outcomeOf(sent, phone);
}
