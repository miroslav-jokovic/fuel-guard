import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALERT_PHONE_CODE_ATTEMPTS,
  ALERT_PHONE_CODE_MINUTES,
  ALERT_PHONE_RESEND_SECONDS,
  ALERT_TEXT_CONSENT,
  alertContactState,
  alertPhoneCodeText,
  isStartMessage,
  isStopMessage,
  normalisePhone,
  type MyAlertContact,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { redactNumber, sendSms, smsConfigured } from "../../lib/sms.js";

/**
 * A person's mobile number for alert texts (HOME-TIME-PLAN D-HT17, HT6; `notification_contacts`, 0598).
 *
 * ── THE CODE IS THE CONSENT ─────────────────────────────────────────────────────────────────────
 * Nobody is texted an alert at a number they did not prove is theirs: the page sends a 6-digit code to
 * the number, and typing it back sets `verified_at` with the words they agreed to. Only the code's hash
 * is stored, it lives ten minutes, and five wrong tries spend it.
 *
 * ── ASKING FOR A CODE UN-CONFIRMS THE ROW ───────────────────────────────────────────────────────
 * A new code may be for a NEW number, and the row holds one number. So asking clears `verified_at`:
 * until the code is typed, no alert goes to a number nobody has proved. The price is that somebody
 * re-confirming the same number misses texts for those minutes.
 *
 * ── STOP ────────────────────────────────────────────────────────────────────────────────────────
 * A reply of STOP sets `stopped_at` on every row holding that number, in every carrier: an inbound text
 * has a number and no org. START clears it. The page's "Stop text alerts" sets the same column, so
 * there is one meaning of stopped. Confirming a number again clears it — and if the mobile carrier is
 * still blocking us after a STOP, the code never arrives, so that cannot overrule a STOP.
 *
 * Every office query filters on `org_id` and `user_id`: the service role bypasses RLS.
 */

interface ContactRow {
  phone: string;
  code_hash: string | null;
  code_expires_at: string | null;
  attempts: number;
  verified_at: string | null;
  stopped_at: string | null;
}
const COLUMNS = "phone, code_hash, code_expires_at, attempts, verified_at, stopped_at";

export type AlertContactRefusal = { code: "invalid" | "unavailable" | "too_soon" | "expired" | "locked" | "wrong" | "send_failed" | "db_error"; message: string };
export const isAlertContactRefusal = (v: unknown): v is AlertContactRefusal => typeof v === "object" && v !== null && "code" in v && "message" in v && !("state" in v);

/** Bound to the person, so a hash copied to another row matches nothing. */
const hashCode = (orgId: string, userId: string, code: string): string => createHash("sha256").update(`${orgId}:${userId}:${code}`).digest("hex");

async function readRow(admin: SupabaseClient, orgId: string, userId: string): Promise<ContactRow | null> {
  const { data, error } = await admin.from("notification_contacts").select(COLUMNS).eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  return (data as ContactRow | null) ?? null;
}

const view = (env: Env, row: ContactRow | null): MyAlertContact => ({ available: smsConfigured(env), state: alertContactState(row), last4: row ? row.phone.slice(-4) : null });

export async function readMyAlertContact(admin: SupabaseClient, env: Env, orgId: string, userId: string): Promise<MyAlertContact> {
  return view(env, await readRow(admin, orgId, userId));
}

/** Text a code to the number. The row is written first: a code that arrives must be one we can check. */
export async function startAlertPhone(admin: SupabaseClient, env: Env, orgId: string, userId: string, rawPhone: string, now: Date): Promise<MyAlertContact | AlertContactRefusal> {
  if (!smsConfigured(env)) return { code: "unavailable", message: "Text alerts are not set up on this server yet." };
  const phone = normalisePhone(rawPhone);
  if (!phone) return { code: "invalid", message: "That is not a mobile number we can text. Use a 10-digit US number." };

  const before = await readRow(admin, orgId, userId);
  if (before?.code_hash && before.code_expires_at) {
    const sentAt = Date.parse(before.code_expires_at) - ALERT_PHONE_CODE_MINUTES * 60_000;
    if (now.getTime() - sentAt < ALERT_PHONE_RESEND_SECONDS * 1000) return { code: "too_soon", message: "A code was just sent. Wait a minute before asking for another." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = {
    org_id: orgId,
    user_id: userId,
    phone,
    code_hash: hashCode(orgId, userId, code),
    code_expires_at: new Date(now.getTime() + ALERT_PHONE_CODE_MINUTES * 60_000).toISOString(),
    attempts: 0,
    verified_at: null,
    // A STOP on this number stays until the code is typed; a different number starts clean.
    stopped_at: before && before.phone === phone ? before.stopped_at : null,
    consent_text: null,
    consent_version: null,
    updated_at: now.toISOString(),
  };
  // The whole row on the table's primary key: insert-or-replace, never a column-group update.
  const { error } = await admin.from("notification_contacts").upsert(row, { onConflict: "org_id,user_id" });
  if (error) return { code: "db_error", message: "Could not save the number." };

  const sent = await sendSms(env, { to: phone, body: alertPhoneCodeText(code) });
  if (!sent.ok) {
    console.error(`[alert-texts] code not sent to=${redactNumber(phone)}: ${sent.detail ?? "send failed"}`);
    return { code: "send_failed", message: "We could not text that number. Check it, and if you once replied STOP, text START to the number our texts come from, then try again." };
  }
  return view(env, { ...row, code_hash: row.code_hash });
}

/** The six digits typed back. Right: the number is confirmed and the consent recorded. */
export async function confirmAlertPhone(admin: SupabaseClient, env: Env, orgId: string, userId: string, code: string, now: Date): Promise<MyAlertContact | AlertContactRefusal> {
  const row = await readRow(admin, orgId, userId);
  if (!row?.code_hash || !row.code_expires_at) return { code: "invalid", message: "Ask for a code first." };
  if (Date.parse(row.code_expires_at) <= now.getTime()) return { code: "expired", message: "That code has expired. Ask for a new one." };
  if (row.attempts >= ALERT_PHONE_CODE_ATTEMPTS) return { code: "locked", message: "Too many wrong tries. Ask for a new code." };

  const given = Buffer.from(hashCode(orgId, userId, code), "hex");
  const stored = Buffer.from(row.code_hash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    // Counted against THIS code only: the filter on the hash means a try cannot be charged to a newer code.
    const { error } = await admin
      .from("notification_contacts")
      .update({ attempts: row.attempts + 1, updated_at: now.toISOString() })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("code_hash", row.code_hash);
    if (error) return { code: "db_error", message: "Could not check the code." };
    const left = ALERT_PHONE_CODE_ATTEMPTS - row.attempts - 1;
    return { code: "wrong", message: left > 0 ? `That is not the code. ${left} ${left === 1 ? "try" : "tries"} left.` : "That is not the code. Ask for a new one." };
  }

  const confirmed = {
    verified_at: now.toISOString(),
    stopped_at: null,
    code_hash: null,
    code_expires_at: null,
    attempts: 0,
    consent_text: ALERT_TEXT_CONSENT.text,
    consent_version: ALERT_TEXT_CONSENT.version,
    updated_at: now.toISOString(),
  };
  const { data, error } = await admin.from("notification_contacts").update(confirmed).eq("org_id", orgId).eq("user_id", userId).eq("code_hash", row.code_hash).select("phone");
  if (error) return { code: "db_error", message: "Could not confirm the number." };
  // No row: a newer code replaced this one between the read and the write.
  if ((data ?? []).length === 0) return { code: "expired", message: "That code has expired. Ask for a new one." };
  return view(env, { ...row, ...confirmed });
}

/** "Stop text alerts" on the page: the same column a reply of STOP sets. The number and its consent record stay. */
export async function stopAlertTexts(admin: SupabaseClient, env: Env, orgId: string, userId: string, now: Date): Promise<MyAlertContact> {
  const { error } = await admin
    .from("notification_contacts")
    .update({ stopped_at: now.toISOString(), code_hash: null, code_expires_at: null, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("stopped_at", null);
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  return view(env, await readRow(admin, orgId, userId));
}

/**
 * An inbound text from a number: STOP switches alert texts off on every row holding it, START back on.
 * No org filter ON PURPOSE — the message carries a number and nothing else, and a person who says STOP
 * means it for every carrier that texts them. Returns the rows changed.
 */
export async function handleAlertInboundSms(admin: SupabaseClient, from: string, body: string, now: Date = new Date()): Promise<{ stopped: number; resumed: number }> {
  const none = { stopped: 0, resumed: 0 };
  const phone = normalisePhone(from);
  if (!phone) return none;
  if (isStopMessage(body)) {
    const { data, error } = await admin.from("notification_contacts").update({ stopped_at: now.toISOString(), updated_at: now.toISOString() }).eq("phone", phone).is("stopped_at", null).select("org_id, user_id");
    if (error) throw new Error(`notification_contacts: ${error.message}`);
    const rows = (data ?? []) as { org_id: string; user_id: string }[];
    // Signed by the person themselves: the reply is their act, and the audit page is where an admin sees it.
    for (const r of rows) await writeAudit(admin, { orgId: r.org_id, actorId: r.user_id, action: "alerts.text_stopped", entity: "notification_contacts", entityId: r.user_id, meta: { by: "reply" } });
    if (rows.length > 0) console.log(`[alert-texts] STOP honoured to=${redactNumber(phone)} rows=${rows.length}`);
    return { ...none, stopped: rows.length };
  }
  if (isStartMessage(body)) {
    // Only a number that was confirmed: START is not a way to confirm one.
    const { data, error } = await admin
      .from("notification_contacts")
      .update({ stopped_at: null, updated_at: now.toISOString() })
      .eq("phone", phone)
      .not("stopped_at", "is", null)
      .not("verified_at", "is", null)
      .select("org_id, user_id");
    if (error) throw new Error(`notification_contacts: ${error.message}`);
    const rows = (data ?? []) as { org_id: string; user_id: string }[];
    for (const r of rows) await writeAudit(admin, { orgId: r.org_id, actorId: r.user_id, action: "alerts.text_resumed", entity: "notification_contacts", entityId: r.user_id, meta: { by: "reply" } });
    return { ...none, resumed: rows.length };
  }
  return none;
}
