import type { SupabaseClient } from "@supabase/supabase-js";
import {
  USER_ROLES,
  alertDefinition,
  resolveAlertRecipients,
  rolesThatManage,
  type AlertChannel,
  type AlertKey,
  type AlertMember,
  type AlertRelation,
  type AlertRoute,
  type NotificationSeverity,
  type UserRole,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { notify } from "./notify.js";

/**
 * Alert routing's server half (NOTIFICATION-ROUTING-PLAN D-NR3, D-NR4; HOME-TIME-PLAN §3.6, D-HT14):
 * read a carrier's routes, resolve who hears an alert, and send it on each person's channels.
 *
 * ── ONE RESOLVER, ONE SENDER ────────────────────────────────────────────────────────────────────
 * `recipientsFor` is the shared rule (`resolveAlertRecipients`) over three reads: the saved routes,
 * the active members, and each member's confirmed mobile number. `sendAlerts` then takes a batch of
 * events for ONE alert and sends each person:
 *   · a bell item per event, through `notify()` — its own dedupe, mutes and quiet hours apply;
 *   · ONE email listing everything new for them, never one per driver (the DQ alerts' rule): queued
 *     with `queue_notification_delivery` (0598), which claims each line's key in the dedupe ledger and
 *     queues only the lines it claimed, then sent, and the outcome written back on the row.
 * SMS is resolved here — who would get a text — and SENT in HT6, with the confirmation and STOP
 * handling a text needs; until then `sms` is in nobody's channels, because nobody has a verified number.
 *
 * ── AN ALERT ADDRESSED TO NOBODY IS A FAILURE ───────────────────────────────────────────────────
 * When the routes resolve to nobody for an event — the truck's fleet has no linked dispatcher, the
 * person who marked it left — the bell goes to everyone who manages the alert's section, and the run
 * says so in the log. A carrier that switched every route off on purpose still gets this: the page
 * says an alert cannot be sent to nobody (HT5).
 *
 * Every query filters on `org_id`: the service role bypasses RLS.
 */

export interface AlertEvent {
  /** One key per fact; the bell, the email and the text each claim it for their own channel. */
  dedupeKey: string;
  /** The sentence about this event: the bell's title and a line of the email. */
  line: string;
  severity: NotificationSeverity;
  entityType: string;
  entityId: string;
  /** Who each relation resolves to for THIS event; absent or null when nobody. */
  relations: Partial<Record<AlertRelation, string | null>>;
}

export interface AlertSendResult {
  /** Bell items actually made (a deduped or muted one is not). */
  bells: number;
  emails: number;
  /** Events whose routes resolved to nobody, sent to the section's managers instead. */
  fellBack: number;
}

export interface Directory {
  members: AlertMember[];
  emailOf: Map<string, string>;
  /** The name the Settings page shows; the login email when no name was ever entered. */
  nameOf: Map<string, string>;
}

/** The carrier's active members with their login email — `org_member_directory` (0301, 0393), one read. */
export async function readDirectory(admin: SupabaseClient, orgId: string): Promise<Directory> {
  const { data, error } = await admin.rpc("org_member_directory", { p_org_id: orgId });
  if (error) throw new Error(`org_member_directory: ${error.message}`);
  const rows = (data ?? []) as Array<{ user_id: string; email: string | null; full_name?: string | null; role: string; suspended_at: string | null }>;
  const members: AlertMember[] = [];
  const emailOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const r of rows) {
    if (r.suspended_at !== null || !(USER_ROLES as readonly string[]).includes(r.role)) continue;
    members.push({ userId: r.user_id, role: r.role as UserRole });
    if (r.email) emailOf.set(r.user_id, r.email);
    nameOf.set(r.user_id, r.full_name?.trim() || r.email || "Unnamed member");
  }
  return { members, emailOf, nameOf };
}

/** The carrier's saved routes for one alert; empty means "the catalogue's defaults" (`routesInForce`). */
export async function readAlertRoutes(admin: SupabaseClient, orgId: string, alert: AlertKey): Promise<AlertRoute[]> {
  const { data, error } = await admin
    .from("notification_routes")
    .select("recipient_kind, recipient_key, channel, enabled")
    .eq("org_id", orgId)
    .eq("alert", alert);
  if (error) throw new Error(`notification_routes: ${error.message}`);
  return ((data ?? []) as Array<{ recipient_kind: AlertRoute["recipientKind"]; recipient_key: string; channel: AlertChannel; enabled: boolean }>).map((r) => ({
    recipientKind: r.recipient_kind,
    recipientKey: r.recipient_key,
    channel: r.channel,
    enabled: r.enabled,
  }));
}

/** The members who can be texted: a number they confirmed and have not stopped (D-NR5). */
async function readTextable(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("notification_contacts")
    .select("user_id")
    .eq("org_id", orgId)
    .not("verified_at", "is", null)
    .is("stopped_at", null);
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

export interface AlertAudience {
  routes: AlertRoute[];
  directory: Directory;
  textable: Set<string>;
}

/** Everything `recipientsFor` needs for one alert, read once per run and reused for every event. */
export async function readAlertAudience(admin: SupabaseClient, orgId: string, alert: AlertKey): Promise<AlertAudience> {
  const [routes, directory, textable] = await Promise.all([readAlertRoutes(admin, orgId, alert), readDirectory(admin, orgId), readTextable(admin, orgId)]);
  return { routes, directory, textable };
}

/**
 * Who hears this event, and how. A channel a person cannot be reached on is dropped here, so the
 * sender never queues what cannot leave: email needs a login address, a text needs a confirmed number.
 */
export function recipientsFor(alert: AlertKey, audience: AlertAudience, relations: AlertEvent["relations"]): Map<string, Set<AlertChannel>> {
  const out = resolveAlertRecipients(alert, audience.routes, audience.directory.members, relations);
  for (const [userId, channels] of out) {
    if (!audience.directory.emailOf.has(userId)) channels.delete("email");
    if (!audience.textable.has(userId)) channels.delete("sms");
    if (channels.size === 0) out.delete(userId);
  }
  return out;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Send a batch of events of one alert. Never throws for one person's failure: the rest are still told. */
export async function sendAlerts(admin: SupabaseClient, env: Env, orgId: string, alert: AlertKey, events: readonly AlertEvent[]): Promise<AlertSendResult> {
  const result: AlertSendResult = { bells: 0, emails: 0, fellBack: 0 };
  if (events.length === 0) return result;
  const def = alertDefinition(alert);
  const audience = await readAlertAudience(admin, orgId, alert);
  const managers = new Set<string>(rolesThatManage(def.section));
  const fallback = audience.directory.members.filter((m) => managers.has(m.role)).map((m) => m.userId);

  /** Per person, the events to email them about. */
  const emailFor = new Map<string, AlertEvent[]>();
  for (const event of events) {
    let recipients = recipientsFor(alert, audience, event.relations);
    if (recipients.size === 0) {
      result.fellBack += 1;
      recipients = new Map(fallback.map((userId) => [userId, new Set<AlertChannel>(["bell"])]));
      if (recipients.size === 0) console.error(`[alerts] org ${orgId}: ${alert} has nobody to tell — no active member manages ${def.section}`);
    }
    for (const [userId, channels] of recipients) {
      if (channels.has("bell")) {
        const id = await notify(admin, {
          orgId,
          userId,
          category: alert,
          title: event.line,
          severity: event.severity,
          entityType: event.entityType,
          entityId: event.entityId,
          dedupeKey: event.dedupeKey,
        });
        if (id) result.bells += 1;
      }
      if (channels.has("email")) emailFor.set(userId, [...(emailFor.get(userId) ?? []), event]);
    }
  }
  if (result.fellBack > 0) console.warn(`[alerts] org ${orgId}: ${result.fellBack} ${alert} event(s) resolved to nobody and went to who manages ${def.section}`);

  for (const [userId, mine] of emailFor) {
    const to = audience.directory.emailOf.get(userId);
    if (!to) continue;
    try {
      if (await emailOne(admin, env, orgId, alert, def, userId, to, mine)) result.emails += 1;
    } catch (e) {
      console.error(`[alerts] org ${orgId}: email of ${alert} failed for one recipient:`, e instanceof Error ? e.message : e);
    }
  }
  return result;
}

/**
 * Queue one person's email — the database claims each line's key and keeps only the new ones — then
 * send it and write the outcome on the row. Returns whether an email left.
 */
async function emailOne(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  alert: AlertKey,
  def: { label: string; action: string },
  userId: string,
  to: string,
  events: readonly AlertEvent[],
): Promise<boolean> {
  const { data: deliveryId, error } = await admin.rpc("queue_notification_delivery", {
    p_org: orgId,
    p_user: userId,
    p_alert: alert,
    p_channel: "email",
    p_destination: to,
    p_title: def.label,
    p_items: events.map((e) => ({ key: e.dedupeKey, line: e.line })),
    p_not_before: null,
  });
  if (error) throw new Error(`queue_notification_delivery: ${error.message}`);
  // Null: every line had already gone to this person by email.
  if (!deliveryId) return false;

  const { data: row, error: readError } = await admin.from("notification_deliveries").select("items").eq("org_id", orgId).eq("id", deliveryId).maybeSingle();
  if (readError) throw new Error(`notification_deliveries: ${readError.message}`);
  const lines = ((row as { items?: { line: string }[] } | null)?.items ?? []).map((i) => i.line);
  if (lines.length === 0) return false;

  const subject = lines.length === 1 ? `${def.label}: ${lines[0]}` : `${def.label}: ${lines.length} drivers`;
  const open = def.action;
  const sent = await sendEmail(env, {
    to: [to],
    subject: subject.slice(0, 200),
    text: [...lines.map((l) => `  • ${l}`), "", open].join("\n"),
    html: [`<ul>`, ...lines.map((l) => `<li>${escapeHtml(l)}</li>`), `</ul>`, `<p>${open}</p>`].join("\n"),
  });
  const { error: writeError } = await admin
    .from("notification_deliveries")
    .update(sent.ok ? { status: "sent", sent_at: new Date().toISOString(), attempts: 1 } : { status: "failed", attempts: 1, last_error: (sent.detail ?? "send failed").slice(0, 500) })
    .eq("org_id", orgId)
    .eq("id", deliveryId);
  if (writeError) console.error(`[alerts] org ${orgId}: could not record the email's outcome: ${writeError.message}`);
  return sent.ok;
}
