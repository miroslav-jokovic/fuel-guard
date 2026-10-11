import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canSendSmsInZones,
  isDraftSmsConsent,
  nextSmsWindow,
  normalisePhone,
  smsApplicationApproved,
  smsApplicationReady,
  smsApplicationReminder,
  smsDrugTestSite,
  smsOptInConfirmation,
  smsSigningLink,
  smsZonesFor,
  SIGN_LINK_UNLOCK_LIMIT,
  SIGN_LINK_LIFETIME_HOURS,
  type DrugTestSiteParams,
  type SmsHoldReason,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { redactNumber, sendSms } from "../../lib/sms.js";
import { readCarrierZone } from "./applicantBoardReads.js";
import { carrierName } from "./applicationMail.js";
import { drugTestStillLive, markDrugTestSent } from "./applicantDrugTest.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { isSuppressed } from "./smsSuppressions.js";

/**
 * Texts that may wait — the outbox (A-11, D-AW12, C2d).
 *
 * ── WHAT A-11 FOUND, AND WHAT THIS CHANGES ────────────────────────────────────────────────────
 * A text outside the recipient's civil hours was "held" and nothing ever sent it: the confirmation of
 * an opt-in pressed at 22:00 and the office's 18:00 drug-test booking both simply did not arrive. Every
 * text that goes through here is now written to `sms_outbox` — sent at once when the window is open
 * (the row is then the record a delivery receipt lands on), otherwise queued with `not_before` at the
 * next opening, and drained by `runSmsOutboxOnce` every five minutes on the api service.
 *
 * ── A LINK IS MINTED WHEN THE TEXT GOES, ON THE TEXT'S OWN TOKEN (Q-AW29 (a), 0378) ────────────
 * 0376 stores a template and its params, never a rendered body, and refuses a URL in the params: a
 * plaintext bearer token in the database is what 0232 and Q-AX5 refused. Until Q-AW29 that meant the
 * texts carrying a link could not wait — minting one rotates a token, and the reminder and the office's
 * Send put the invitation's link on screen and in an email the moment they run (D-AF7), so a queued
 * text that rotated `token_hash` at drain time would kill the link the driver had just been handed.
 *
 * Now the link-bearing templates (`LINK_TEMPLATES`) carry no link in their params at all. `transmit`
 * mints one at the moment of sending — at once, or hours later from the drain — and rotates only the
 * invitation's TEXT token (`rotate_invitation_sms_token`, 0378), which the resolver accepts as a third
 * door. The email's link and the office's screen are untouched; the previous text's link dies, which is
 * what the words have always said. Rotate first, then send, for 0232's reason: a failure between the two
 * costs a text, never a link that does not work yet.
 *
 * `signing_link` (D-AW14, C3s3a) rides the same text token. The office's Send for signing sends it with
 * the driver in the office, so it nearly always goes at once; queued, it is still worth sending only
 * while the sent link is (`stillWanted`), and the resolver ends the text door with the sign door at the
 * send's 72 hours (`isSentSignDoor`).
 *
 * ⚠ Every query org-filters itself. The drain reads each org's queue in turn (`runSmsOutboxOnce`),
 * never the whole table, and a delivery receipt — which names no org — finds its row by the
 * provider's message id and writes back through that row's own org.
 */

export const SMS_TEMPLATES = [
  "consent_confirm", "application_approved", "drug_test_site", "application_sent", "nudge", "signing_link",
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

/** The templates whose words carry the applicant's link — minted at send time, never stored. */
export const LINK_TEMPLATES: ReadonlySet<SmsTemplate> = new Set<SmsTemplate>(["application_sent", "nudge", "signing_link"]);

/** 0376's reasons; `other` is the approval notice, which the CHECK has no word of its own for. */
const REASON: Record<SmsTemplate, string> = {
  consent_confirm: "consent_confirm",
  application_approved: "other",
  drug_test_site: "drug_test_site",
  application_sent: "application_sent",
  nudge: "nudge",
  signing_link: "signing_link",
};

/**
 * How long a queued text stays worth sending. A confirmation or an approval a day late is still true;
 * a drug-test site is worth sending until the window opens and never after it.
 */
const LIFETIME_MS = 36 * 3_600_000;

export interface SmsMessage {
  orgId: string;
  driverId: string;
  invitationId: string | null;
  template: SmsTemplate;
  params: Record<string, unknown>;
}

export type OutboxOutcome =
  | { sent: true; outboxId: string }
  | { sent: false; queued: true; outboxId: string; notBefore: string }
  | { sent: false; held: SmsHoldReason }
  | { sent: false; failed: string };

interface LiveConsent { phone: string }

async function liveConsentPhone(admin: SupabaseClient, orgId: string, driverId: string): Promise<string | null> {
  const { data } = await admin
    .from("sms_consents")
    .select("phone")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LiveConsent | null)?.phone ?? null;
}

/** D-AW12: Part 1's state, the one place this product is told where the applicant lives. */
async function recipientZones(admin: SupabaseClient, orgId: string, invitationId: string | null): Promise<string[]> {
  if (!invitationId) return [];
  const { data } = await admin
    .from("application_intakes")
    .select("state")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return smsZonesFor((data as { state?: string | null } | null)?.state);
}

/** The words, rendered at SEND time from what the row holds — never stored. `link` only for LINK_TEMPLATES. */
async function render(
  admin: SupabaseClient,
  orgId: string,
  template: SmsTemplate,
  params: Record<string, unknown>,
  link: string | null,
): Promise<string> {
  const carrier = await carrierName(admin, orgId);
  if (template === "consent_confirm") return smsOptInConfirmation(carrier);
  if (template === "application_approved") return smsApplicationApproved(carrier);
  if (template === "application_sent") return smsApplicationReady(carrier, String(link));
  if (template === "nudge") return smsApplicationReminder(carrier, String(link));
  if (template === "signing_link") return smsSigningLink(carrier, String(link), SIGN_LINK_LIFETIME_HOURS);
  const zone = await readCarrierZone(admin, orgId);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(String(params.window_start)))
    .find((p) => p.type === "timeZoneName")?.value ?? zone;
  return smsDrugTestSite(carrier, params as unknown as DrugTestSiteParams, zone, label);
}

/**
 * A fresh link on the invitation's TEXT token (0378), or null when the invitation was revoked or lapsed
 * — in which case nothing may be sent, because the only thing the text says is a link.
 */
async function mintTextLink(admin: SupabaseClient, env: Env, orgId: string, invitationId: string | null): Promise<string | null> {
  if (!invitationId) return null;
  const { token, hash } = mintInvitationToken();
  const { data, error } = await admin.rpc("rotate_invitation_sms_token", {
    p_org: orgId,
    p_invitation: invitationId,
    p_token_hash: hash,
  });
  if (error || data !== true) return null;
  return `${env.WEB_APP_URL}/apply/${token}`;
}

type SendingRow = {
  id: string; org_id: string; invitation_id: string | null; phone: string;
  template: SmsTemplate; params: Record<string, unknown>; attempts: number;
};

/** Send one row's text now and record what became of it. The row must already be ours to send. */
async function transmit(
  admin: SupabaseClient,
  env: Env,
  row: SendingRow,
  now: Date,
): Promise<{ ok: boolean; cancelled?: boolean; detail?: string }> {
  let link: string | null = null;
  if (LINK_TEMPLATES.has(row.template)) {
    link = await mintTextLink(admin, env, row.org_id, row.invitation_id);
    if (!link) {
      await admin
        .from("sms_outbox")
        .update({ status: "cancelled", last_error: "the invitation was revoked or lapsed before its text went" })
        .eq("org_id", row.org_id)
        .eq("id", row.id);
      return { ok: false, cancelled: true, detail: "invitation no longer live" };
    }
  }
  const body = await render(admin, row.org_id, row.template, row.params, link);
  const result = await sendSms(env, { to: row.phone, body });
  const stamp = now.toISOString();
  await admin
    .from("sms_outbox")
    .update(result.ok
      ? { status: "sent", sent_at: stamp, attempts: row.attempts + 1, provider_message_id: result.messageId ?? null, last_error: null }
      : { status: "failed", failed_at: stamp, attempts: row.attempts + 1, last_error: (result.detail ?? "send failed").slice(0, 300) })
    .eq("org_id", row.org_id)
    .eq("id", row.id);
  if (!result.ok) console.error("[sms-outbox] send failed", { to: redactNumber(row.phone), detail: result.detail });
  if (result.ok) await afterSent(admin, row.org_id, row.template, row.params, stamp);
  return { ok: result.ok, detail: result.detail };
}

/** A sent drug-test text is the act 0376's `sent_to_driver_at` records (D-AW6), stamped by its owner. */
async function afterSent(admin: SupabaseClient, orgId: string, template: SmsTemplate, params: Record<string, unknown>, at: string): Promise<void> {
  if (template === "drug_test_site" && typeof params.appointment_id === "string") {
    await markDrugTestSent(admin, orgId, params.appointment_id, at);
  }
}

/**
 * Send a text now if its recipient's window is open, otherwise queue it for the drain.
 *
 * The gates are `sendApplicationSms`'s, in its order — draft wording, a live consent, a usable number,
 * a number that has not texted STOP (C2d2) — and the answer to "not now" is a queued row, never a hold
 * that nothing retries. A suppressed number is not "not now": nothing is queued for it.
 */
export async function sendOrQueueSms(admin: SupabaseClient, env: Env, message: SmsMessage, now: Date): Promise<OutboxOutcome> {
  if (isDraftSmsConsent()) return { sent: false, held: "no_consent" };
  const consented = await liveConsentPhone(admin, message.orgId, message.driverId);
  if (!consented) return { sent: false, held: "no_consent" };
  const phone = normalisePhone(consented);
  if (!phone) return { sent: false, held: "no_number" };
  if (await isSuppressed(admin, message.orgId, phone)) return { sent: false, held: "suppressed" };

  const zones = await recipientZones(admin, message.orgId, message.invitationId);
  const open = canSendSmsInZones(now, zones);
  const notBefore = open ? now : nextSmsWindow(now, zones);
  const { data, error } = await admin
    .from("sms_outbox")
    .insert({
      org_id: message.orgId,
      driver_id: message.driverId,
      invitation_id: message.invitationId,
      phone,
      template: message.template,
      params: message.params,
      reason: REASON[message.template],
      not_before: notBefore.toISOString(),
      expires_at: new Date(notBefore.getTime() + LIFETIME_MS).toISOString(),
      // Claimed at insert when it goes now, so the drain can never pick up a row this call is sending.
      status: open ? "sending" : "queued",
    })
    .select("id")
    .maybeSingle();
  const outboxId = (data as { id?: string } | null)?.id;
  if (error || !outboxId) return { sent: false, failed: error?.message ?? "could not queue the text" };
  if (!open) return { sent: false, queued: true, outboxId, notBefore: notBefore.toISOString() };

  const sent = await transmit(admin, env, {
    id: outboxId, org_id: message.orgId, invitation_id: message.invitationId, phone,
    template: message.template, params: message.params, attempts: 0,
  }, now);
  return sent.ok ? { sent: true, outboxId } : { sent: false, failed: sent.detail ?? "send failed" };
}

/**
 * Is what a queued text announces still true?
 *
 *   · the drug-test site — the office moved or cancelled the appointment after the text was queued (a
 *     rebooking cancels the older row), and a text naming a cancelled site sends the applicant to the
 *     wrong place;
 *   · "your application is ready" and the reminder (Q-AW29) — not once the applicant has handed the
 *     application over, had it approved, or filed it overnight: a reminder to somebody waiting on the
 *     office is A1's defect, and "fill it in here" to somebody who has is noise. A revoked or lapsed
 *     invitation is refused by the rotation itself (`mintTextLink`);
 *   · the sign link (C3s3a) — only while the send it belongs to is live: not filed, inside its 72 hours,
 *     and not stopped by five wrong dates of birth. ⚠ The last is the one that matters: the drain mints a
 *     FRESH text token, so a queued text sent after the stop would reopen the door the stop closed.
 */
async function stillWanted(
  admin: SupabaseClient,
  orgId: string,
  template: SmsTemplate,
  params: Record<string, unknown>,
  invitationId: string | null,
  now: Date,
): Promise<boolean> {
  if (template === "drug_test_site") return drugTestStillLive(admin, orgId, String(params.appointment_id ?? ""));
  if (!LINK_TEMPLATES.has(template)) return true;
  if (!invitationId) return false;
  if (template === "signing_link") return signingStillLive(admin, orgId, invitationId, now);
  const { data } = await admin
    .from("application_invitations")
    .select("submitted_at, review_requested_at, approved_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const inv = data as { submitted_at: string | null; review_requested_at: string | null; approved_at: string | null } | null;
  return inv !== null && !inv.submitted_at && !inv.review_requested_at && !inv.approved_at;
}

async function signingStillLive(admin: SupabaseClient, orgId: string, invitationId: string, now: Date): Promise<boolean> {
  const { data } = await admin
    .from("application_invitations")
    .select("submitted_at, sign_link_expires_at, unlock_failures")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const inv = data as { submitted_at: string | null; sign_link_expires_at: string | null; unlock_failures: number } | null;
  return inv !== null && !inv.submitted_at && inv.sign_link_expires_at !== null
    && Date.parse(inv.sign_link_expires_at) > now.getTime() && inv.unlock_failures < SIGN_LINK_UNLOCK_LIMIT;
}

/** How many due rows one org's drain takes per run: 0376's claim bound (§8.5 C2). */
export const DRAIN_BATCH = 50;

export interface DrainResult { sent: number; failed: number; cancelled: number; deferred: number }

/**
 * One org's due texts. For each: too old → cancelled; the consent it was queued under withdrawn or
 * moved to another number → cancelled (the STOP is the newer fact); the number suppressed since it was
 * queued → cancelled (C2d2); the window shut again (a split state, DST) → deferred; otherwise claimed
 * and sent.
 *
 * ⚠ The claim is a conditional UPDATE (`queued` → `sending`), not 0376's `for update skip locked`:
 * this runs in exactly one process fleet-wide (the api service, `docs/WORKER-DEPLOYMENT.md`), so a
 * second drainer is the invariant being broken rather than a case to serve — and the conditional
 * UPDATE still refuses to send a row twice if it ever is.
 */
export async function drainSmsOutboxForOrg(admin: SupabaseClient, env: Env, orgId: string, now: Date): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, failed: 0, cancelled: 0, deferred: 0 };
  const { data } = await admin
    .from("sms_outbox")
    .select("id, org_id, driver_id, invitation_id, phone, template, params, attempts, expires_at")
    .eq("org_id", orgId)
    .eq("status", "queued")
    .lte("not_before", now.toISOString())
    .order("not_before", { ascending: true })
    .limit(DRAIN_BATCH);
  type Row = { id: string; org_id: string; driver_id: string; invitation_id: string | null; phone: string; template: SmsTemplate; params: Record<string, unknown>; attempts: number; expires_at: string };

  const set = (id: string, patch: Record<string, unknown>) =>
    admin.from("sms_outbox").update(patch).eq("org_id", orgId).eq("id", id).eq("status", "queued");

  for (const row of (data ?? []) as Row[]) {
    if (new Date(row.expires_at) <= now) {
      await set(row.id, { status: "cancelled", last_error: "expired before its window opened" });
      out.cancelled += 1;
      continue;
    }
    const live = await liveConsentPhone(admin, orgId, row.driver_id);
    if (isDraftSmsConsent() || !live || normalisePhone(live) !== row.phone) {
      await set(row.id, { status: "cancelled", last_error: "consent withdrawn while queued" });
      out.cancelled += 1;
      continue;
    }
    if (await isSuppressed(admin, orgId, row.phone)) {
      await set(row.id, { status: "cancelled", last_error: "number texted STOP while queued" });
      out.cancelled += 1;
      continue;
    }
    if (!(await stillWanted(admin, orgId, row.template, row.params, row.invitation_id, now))) {
      await set(row.id, { status: "cancelled", last_error: "what it announced was cancelled while queued" });
      out.cancelled += 1;
      continue;
    }
    const zones = await recipientZones(admin, orgId, row.invitation_id);
    if (!canSendSmsInZones(now, zones)) {
      await set(row.id, { not_before: nextSmsWindow(now, zones).toISOString() });
      out.deferred += 1;
      continue;
    }
    const { data: claimed } = await set(row.id, { status: "sending" }).select("id");
    if (((claimed ?? []) as unknown[]).length !== 1) continue;
    const sent = await transmit(admin, env, row, now);
    if (sent.ok) out.sent += 1;
    else if (sent.cancelled) out.cancelled += 1;
    else out.failed += 1;
  }
  return out;
}

/** Every org's queue, one org at a time — the scheduler's whole body. */
export async function runSmsOutboxOnce(admin: SupabaseClient, env: Env, now: Date): Promise<DrainResult> {
  const total: DrainResult = { sent: 0, failed: 0, cancelled: 0, deferred: 0 };
  const { data: orgs } = await admin.from("organizations").select("id");
  for (const o of (orgs ?? []) as Array<{ id: string }>) {
    try {
      const r = await drainSmsOutboxForOrg(admin, env, o.id, now);
      total.sent += r.sent; total.failed += r.failed; total.cancelled += r.cancelled; total.deferred += r.deferred;
    } catch (e) {
      console.error(`[sms-outbox] org ${o.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return total;
}

/**
 * A Telnyx delivery receipt (A-11): "accepted" is not "delivered", and until now a text the carrier
 * refused after accepting read as sent. `message.finalized` carries the final status per recipient.
 */
export async function recordDeliveryReceipt(
  admin: SupabaseClient,
  receipt: { messageId: string; status: string },
  now: Date,
): Promise<boolean> {
  const { data } = await admin
    .from("sms_outbox")
    .select("id, org_id")
    .eq("provider_message_id", receipt.messageId)
    .maybeSingle();
  const row = data as { id: string; org_id: string } | null;
  if (!row) return false;
  const delivered = receipt.status === "delivered";
  const failed = receipt.status === "delivery_failed" || receipt.status === "sending_failed";
  if (!delivered && !failed) return false;
  await admin
    .from("sms_outbox")
    .update(delivered
      ? { status: "delivered", delivered_at: now.toISOString() }
      : { status: "failed", failed_at: now.toISOString(), last_error: `carrier: ${receipt.status}` })
    .eq("org_id", row.org_id)
    .eq("id", row.id);
  return true;
}
