import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALERT_TEXT_QUIET_DEFAULT,
  OWN_DRAIN_ALERTS,
  alertIsMandatory,
  alertTextBody,
  alertTextNotBefore,
  inAlertTextQuiet,
  type AlertKey,
  type AlertTextQuiet,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { redactNumber, sendSms } from "../../lib/sms.js";
import { ALERT_TEXT_LINE } from "./alertContacts.js";

/**
 * Alert texts: queued, held overnight, sent, and their outcome recorded (HOME-TIME-PLAN HT6, D-HT16,
 * D-HT18, D-HT19).
 *
 * ── ONE ROAD OUT ────────────────────────────────────────────────────────────────────────────────
 * Every text is a `notification_deliveries` row first (`queue_notification_delivery`, 0598, which
 * claims each line's key so a fact is texted once) and leaves through `sendQueuedText`. A text queued
 * outside the quiet window is sent at once by the same function the drain uses, so a run that dies
 * between "queued" and "sent" leaves a row the next drain sends — not a claimed key and no text.
 *
 * ── CHECKED AGAIN AT THE DOOR ───────────────────────────────────────────────────────────────────
 * A text can wait ten hours. Before it leaves, the drain asks again: is this still the person's
 * confirmed number, and have they not stopped? If not, the row is `skipped` with the reason. It also
 * asks the clock again (`inAlertTextQuiet`), because `not_before` was computed by adding minutes and a
 * clock change can make it an hour early.
 *
 * ── ONE PROCESS ─────────────────────────────────────────────────────────────────────────────────
 * The drain is called from the home-time job's tick, which the scheduler lease runs in exactly one
 * process (`docs/WORKER-DEPLOYMENT.md`); a row has no "sending" state, so two drains could text twice.
 * It is not a scheduler of its own for that reason, and must not become one without a claim step.
 * The one exception keeps that promise by splitting the rows instead: an alert the catalogue marks
 * `ownDrain` (broker mail's two, BROKER-MAIL-READER-PLAN P3) is drained ONLY by its module, in its own
 * lease-held lane, with `only`. Every other caller's drain leaves those rows alone. Two drains, no row
 * in both.
 *
 * Every query filters on `org_id`: the service role bypasses RLS. The receipt is the exception — a
 * provider's message id is all it carries — and it can only touch the row that id was written on.
 */

export const ALERT_TEXT_DRAIN_BATCH = 50;

/** The carrier's quiet window; the default when it has saved none. Throws on a read error: a silent default could text at night. */
export async function readAlertTextQuiet(admin: SupabaseClient, orgId: string): Promise<AlertTextQuiet> {
  const { data, error } = await admin.from("notification_channel_settings").select("sms_quiet_start_min, sms_quiet_end_min").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`notification_channel_settings: ${error.message}`);
  const row = data as { sms_quiet_start_min: number; sms_quiet_end_min: number } | null;
  return row ? { startMin: row.sms_quiet_start_min, endMin: row.sms_quiet_end_min } : ALERT_TEXT_QUIET_DEFAULT;
}

export async function saveAlertTextQuiet(admin: SupabaseClient, orgId: string, actorId: string, quiet: AlertTextQuiet, now: Date): Promise<void> {
  // The whole row on the table's primary key: insert-or-replace, never a column-group update.
  const { error } = await admin
    .from("notification_channel_settings")
    .upsert({ org_id: orgId, sms_quiet_start_min: quiet.startMin, sms_quiet_end_min: quiet.endMin, updated_by: actorId, updated_at: now.toISOString() }, { onConflict: "org_id" });
  if (error) throw new Error(`notification_channel_settings: ${error.message}`);
}

interface QueuedText {
  id: string;
  user_id: string;
  alert: string;
  destination: string;
  title: string;
  items: { key?: string; line: string }[];
  created_at?: string;
}

/**
 * The owning module's last word before a held text leaves (D-BMR10's door hook): the items still worth
 * sending (others dropped from the text), `skip` with a reason, or `hold` to leave the row queued and
 * ask again on the next drain.
 */
export type DoorVerdict = { send: QueuedText["items"] } | { skip: string } | "hold";
export type DoorCheck = (row: Readonly<QueuedText>) => Promise<DoorVerdict>;

export interface DrainOptions {
  /** Drain only these alerts (an `ownDrain` module's own); absent = every alert that is not `ownDrain`. */
  only?: readonly AlertKey[];
  door?: DoorCheck;
}

export type TextOutcome = "sent" | "failed" | "skipped";

/** Send one queued row and write what happened on it. Never throws for a provider failure. */
async function sendQueuedText(admin: SupabaseClient, env: Env, orgId: string, row: QueuedText, now: Date): Promise<TextOutcome> {
  const settle = async (patch: Record<string, unknown>): Promise<void> => {
    // Only a row still queued: an outcome is written once.
    const { error } = await admin.from("notification_deliveries").update(patch).eq("org_id", orgId).eq("id", row.id).eq("status", "queued");
    if (error) console.error(`[alert-texts] org ${orgId}: could not record a text's outcome: ${error.message}`);
  };

  const { data, error } = await admin.from("notification_contacts").select("phone, verified_at, stopped_at").eq("org_id", orgId).eq("user_id", row.user_id).maybeSingle();
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  const contact = data as { phone: string; verified_at: string | null; stopped_at: string | null } | null;
  const why = !contact ? "no_number" : contact.stopped_at ? "stopped" : !contact.verified_at ? "not_confirmed" : contact.phone !== row.destination ? "number_changed" : null;
  if (why) {
    await settle({ status: "skipped", skip_reason: why });
    return "skipped";
  }

  const sent = await sendSms(env, { to: row.destination, body: alertTextBody(row.title, row.items.map((i) => i.line)), line: ALERT_TEXT_LINE });
  if (sent.ok) {
    await settle({ status: "sent", sent_at: now.toISOString(), attempts: 1, provider_message_id: sent.messageId ?? null });
    return "sent";
  }
  console.error(`[alert-texts] org ${orgId}: text not sent to=${redactNumber(row.destination)}: ${sent.detail ?? "send failed"}`);
  await settle({ status: "failed", attempts: 1, last_error: (sent.detail ?? "send failed").slice(0, 500) });
  return "failed";
}

export interface AlertTextClock {
  /** The carrier's IANA zone: the quiet window is on its clock. */
  zone: string;
  now: Date;
}

/**
 * Queue ONE text for a person listing everything new, and send it unless the quiet window holds it.
 * Returns what happened: `held` when it waits for morning, `null` when every line had already been texted.
 */
export async function textOne(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  alert: AlertKey,
  label: string,
  userId: string,
  phone: string,
  items: readonly { key: string; line: string }[],
  quiet: AlertTextQuiet,
  clock: AlertTextClock,
): Promise<TextOutcome | "held" | null> {
  // A mandatory alert is sent at night too (Q-BM11); STOP is still honoured at the door.
  const notBefore = alertIsMandatory(alert) ? null : alertTextNotBefore(clock.now, clock.zone, quiet);
  const { data: deliveryId, error } = await admin.rpc("queue_notification_delivery", {
    p_org: orgId,
    p_user: userId,
    p_alert: alert,
    p_channel: "sms",
    p_destination: phone,
    p_title: label,
    p_items: items,
    p_not_before: notBefore ? notBefore.toISOString() : null,
  });
  if (error) throw new Error(`queue_notification_delivery: ${error.message}`);
  if (!deliveryId) return null;
  if (notBefore) return "held";

  const { data: row, error: readError } = await admin.from("notification_deliveries").select("id, user_id, alert, destination, title, items").eq("org_id", orgId).eq("id", deliveryId).maybeSingle();
  if (readError) throw new Error(`notification_deliveries: ${readError.message}`);
  return row ? sendQueuedText(admin, env, orgId, row as QueuedText, clock.now) : null;
}

export interface AlertTextDrain {
  sent: number;
  failed: number;
  skipped: number;
}

/** Send the carrier's texts that are due: held ones whose morning has come, and any a dead run left queued. */
export async function drainAlertTexts(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date,
  zoneOf: () => Promise<string>,
  options: DrainOptions = {},
): Promise<AlertTextDrain> {
  const result: AlertTextDrain = { sent: 0, failed: 0, skipped: 0 };
  let q = admin
    .from("notification_deliveries")
    .select("id, user_id, alert, destination, title, items, not_before, created_at")
    .eq("org_id", orgId)
    .eq("channel", "sms")
    .eq("status", "queued");
  q = options.only ? q.in("alert", [...options.only]) : OWN_DRAIN_ALERTS.length ? q.not("alert", "in", `(${OWN_DRAIN_ALERTS.join(",")})`) : q;
  const { data, error } = await q.order("created_at", { ascending: true }).limit(ALERT_TEXT_DRAIN_BATCH);
  if (error) throw new Error(`notification_deliveries: ${error.message}`);
  const due = ((data ?? []) as (QueuedText & { not_before: string | null })[]).filter((r) => r.not_before === null || Date.parse(r.not_before) <= now.getTime());
  if (due.length === 0) return result;
  // The zone and the window are read only when something is due: a carrier with nothing queued costs the one read above.
  // A mandatory alert's row is never held by the window (Q-BM11), so it is sent even while the window holds the rest.
  const quietNow = due.some((r) => !alertIsMandatory(r.alert as AlertKey)) && inAlertTextQuiet(now, await zoneOf(), await readAlertTextQuiet(admin, orgId));
  for (const row of due) {
    if (quietNow && !alertIsMandatory(row.alert as AlertKey)) continue;
    const verdict = options.door ? await options.door(row) : { send: row.items };
    if (verdict === "hold") continue;
    if ("skip" in verdict) {
      const { error: e } = await admin.from("notification_deliveries").update({ status: "skipped", skip_reason: verdict.skip.slice(0, 80) }).eq("org_id", orgId).eq("id", row.id).eq("status", "queued");
      if (e) console.error(`[alert-texts] org ${orgId}: could not skip a text: ${e.message}`);
      result.skipped += 1;
      continue;
    }
    result[await sendQueuedText(admin, env, orgId, { ...row, items: verdict.send }, now)] += 1;
  }
  return result;
}

/** Telnyx's verdict on a text after it accepted it. Statuses that mean the phone did not get it. */
const UNDELIVERED = new Set(["delivery_failed", "sending_failed", "delivery_unconfirmed"]);

/**
 * A delivery receipt for one of OUR alert texts: a text the mobile carrier refused is `failed`, with the
 * carrier's word for it. Returns whether the id was ours — the webhook answers 200 either way.
 */
export async function recordAlertTextReceipt(admin: SupabaseClient, receipt: { messageId: string; status: string }): Promise<boolean> {
  if (!UNDELIVERED.has(receipt.status)) {
    const { data, error } = await admin.from("notification_deliveries").select("id").eq("provider_message_id", receipt.messageId).limit(1);
    if (error) throw new Error(`notification_deliveries: ${error.message}`);
    return (data ?? []).length > 0;
  }
  const { data, error } = await admin
    .from("notification_deliveries")
    .update({ status: "failed", last_error: `carrier: ${receipt.status}` })
    .eq("provider_message_id", receipt.messageId)
    .eq("channel", "sms")
    .select("id");
  if (error) throw new Error(`notification_deliveries: ${error.message}`);
  return (data ?? []).length > 0;
}
