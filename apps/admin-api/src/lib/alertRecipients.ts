import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who hears a PLATFORM alarm — the release train's outcome, platform checks (0427;
 * RELEASE-TRAIN-PLAN Q-REL4, DATA-LIFECYCLE-PLAN Q9). Kept in the console's Settings so the owners
 * add and remove a phone or an address without a deploy or a repository secret.
 *
 * Read by scripts/release-notify.mjs straight from the database, never through an API: the message
 * that matters most is the one saying an API is broken.
 */
export type AlertChannel = "email" | "sms";

export interface AlertRecipient {
  id: string;
  channel: AlertChannel;
  address: string;
  label: string | null;
  createdAt: string;
}

/**
 * A typed-in phone number as E.164, or null. Pure.
 *
 * Accepts what a person types for a US number — "872 800 8639", "(872) 800-8639", "+1 872-800-8639",
 * "18728008639" — and any number already in international form. Ten bare digits are read as US
 * (+1), the only country this carrier operates in; a number for anywhere else must start with "+".
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{9,14}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return /^[2-9]/.test(digits) ? `+1${digits}` : null;
  if (/^1\d{10}$/.test(digits)) return /^1[2-9]/.test(digits) ? `+${digits}` : null;
  return null;
}

/** A typed-in email address, lower-cased, or null. Pure. The table's check repeats this shape. */
export function normaliseEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export function normaliseAddress(channel: AlertChannel, input: string): string | null {
  return channel === "sms" ? normalisePhone(input) : normaliseEmail(input);
}

/**
 * A phone shown in the console and the audit trail: the last four digits only. The list is visible
 * to every platform role, read-only ones included; the full number is needed by nothing but the
 * sender. Pure.
 */
export function maskAddress(channel: AlertChannel, address: string): string {
  return channel === "sms" ? `•••• ${address.slice(-4)}` : address;
}

const COLUMNS = "id, channel, address, label, created_at";
type Row = { id: string; channel: AlertChannel; address: string; label: string | null; created_at: string };
const toRecipient = (r: Row): AlertRecipient => ({
  id: r.id,
  channel: r.channel,
  address: r.address,
  label: r.label,
  createdAt: r.created_at,
});

export async function listAlertRecipients(admin: SupabaseClient): Promise<AlertRecipient[]> {
  const { data, error } = await admin
    .from("platform_alert_recipients")
    .select(COLUMNS)
    .is("removed_at", null)
    .order("channel")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toRecipient);
}

/** Adds one. Returns "duplicate" when that address is already live on that channel. */
export async function addAlertRecipient(
  admin: SupabaseClient,
  adminId: string,
  input: { channel: AlertChannel; address: string; label: string | null },
): Promise<AlertRecipient | "duplicate"> {
  const { data, error } = await admin
    .from("platform_alert_recipients")
    .insert({ channel: input.channel, address: input.address, label: input.label, added_by: adminId })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate"; // uq_platform_alert_recipients_live
    throw error;
  }
  return toRecipient(data as Row);
}

/** Stamps one removed. Returns the removed row, or null when no LIVE row has that id. */
export async function removeAlertRecipient(
  admin: SupabaseClient,
  adminId: string,
  id: string,
): Promise<AlertRecipient | null> {
  const { data, error } = await admin
    .from("platform_alert_recipients")
    .update({ removed_at: new Date().toISOString(), removed_by: adminId })
    .eq("id", id)
    .is("removed_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toRecipient(data as Row) : null;
}
