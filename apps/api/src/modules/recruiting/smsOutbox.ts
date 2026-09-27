import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canSendSmsInZones,
  isDraftSmsConsent,
  nextSmsWindow,
  normalisePhone,
  smsApplicationApproved,
  smsDrugTestSite,
  smsOptInConfirmation,
  smsZonesFor,
  type DrugTestSiteParams,
  type SmsHoldReason,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { redactNumber, sendSms } from "../../lib/sms.js";
import { readCarrierZone } from "./applicantBoardReads.js";
import { carrierName } from "./applicationMail.js";
import { drugTestStillLive, markDrugTestSent } from "./applicantDrugTest.js";

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
 * ── ONLY TEXTS WITHOUT A LINK ─────────────────────────────────────────────────────────────────
 * 0376 stores a template and its params, never a rendered body, and refuses a URL in the params: a
 * plaintext bearer token in the database is what 0232 and Q-AX5 refused. A link can only be minted by
 * rotating the invitation's token, and the nudge and the office's Send put that same link on screen and
 * in an email at the moment they are pressed (D-AF7) — so a queued text that rotated again at drain
 * time would kill the link the driver was just handed. The texts that carry a link (`nudge`,
 * `application_sent`, `signing_link`) therefore still go at once or not at all, with the email as
 * their delivery path; what lets them wait too is plan §11 Q-AW29 (a text-only token), not a detour
 * here. The three templates below carry none.
 *
 * ⚠ Every query org-filters itself. The drain reads each org's queue in turn (`runSmsOutboxOnce`),
 * never the whole table, and a delivery receipt — which names no org — finds its row by the
 * provider's message id and writes back through that row's own org.
 */

export const SMS_TEMPLATES = ["consent_confirm", "application_approved", "drug_test_site"] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

/** 0376's reasons; `other` is the approval notice, which the CHECK has no word of its own for. */
const REASON: Record<SmsTemplate, string> = {
  consent_confirm: "consent_confirm",
  application_approved: "other",
  drug_test_site: "drug_test_site",
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

/** The words, rendered at SEND time from what the row holds — never stored. */
async function render(admin: SupabaseClient, orgId: string, template: SmsTemplate, params: Record<string, unknown>): Promise<string> {
  const carrier = await carrierName(admin, orgId);
  if (template === "consent_confirm") return smsOptInConfirmation(carrier);
  if (template === "application_approved") return smsApplicationApproved(carrier);
  const zone = await readCarrierZone(admin, orgId);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(String(params.window_start)))
    .find((p) => p.type === "timeZoneName")?.value ?? zone;
  return smsDrugTestSite(carrier, params as unknown as DrugTestSiteParams, zone, label);
}

/** Send one row's text now and record what became of it. The row must already be ours to send. */
async function transmit(
  admin: SupabaseClient,
  env: Env,
  row: { id: string; org_id: string; phone: string; template: SmsTemplate; params: Record<string, unknown>; attempts: number },
  now: Date,
): Promise<{ ok: boolean; detail?: string }> {
  const body = await render(admin, row.org_id, row.template, row.params);
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
 * The gates are `sendApplicationSms`'s, in its order — draft wording, a live consent, a usable number —
 * and the answer to "not now" is a queued row, never a hold that nothing retries.
 */
export async function sendOrQueueSms(admin: SupabaseClient, env: Env, message: SmsMessage, now: Date): Promise<OutboxOutcome> {
  if (isDraftSmsConsent()) return { sent: false, held: "no_consent" };
  const consented = await liveConsentPhone(admin, message.orgId, message.driverId);
  if (!consented) return { sent: false, held: "no_consent" };
  const phone = normalisePhone(consented);
  if (!phone) return { sent: false, held: "no_number" };

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
    id: outboxId, org_id: message.orgId, phone, template: message.template, params: message.params, attempts: 0,
  }, now);
  return sent.ok ? { sent: true, outboxId } : { sent: false, failed: sent.detail ?? "send failed" };
}

/**
 * Is what a queued text announces still true? Only the drug-test site can stop being: the office moved
 * or cancelled the appointment after the text was queued (a rebooking cancels the older row), and a
 * text naming a cancelled site sends the applicant to the wrong place.
 */
async function stillWanted(admin: SupabaseClient, orgId: string, template: SmsTemplate, params: Record<string, unknown>): Promise<boolean> {
  if (template !== "drug_test_site") return true;
  return drugTestStillLive(admin, orgId, String(params.appointment_id ?? ""));
}

/** How many due rows one org's drain takes per run: 0376's claim bound (§8.5 C2). */
export const DRAIN_BATCH = 50;

export interface DrainResult { sent: number; failed: number; cancelled: number; deferred: number }

/**
 * One org's due texts. For each: too old → cancelled; the consent it was queued under withdrawn or
 * moved to another number → cancelled (the STOP is the newer fact); the window shut again (a split
 * state, DST) → deferred; otherwise claimed and sent.
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
    if (!(await stillWanted(admin, orgId, row.template, row.params))) {
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
