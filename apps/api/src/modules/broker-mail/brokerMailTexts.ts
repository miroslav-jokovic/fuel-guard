import type { SupabaseClient } from "@supabase/supabase-js";
import { BROKER_MAIL_OPEN_DAYS, type AlertKey } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { drainAlertTexts, sendAlerts, type AlertEvent, type DoorCheck } from "../messaging/index.js";
import { listOfficeMembers, orgTimezone } from "../org/index.js";

/**
 * Broker mail's texts (BROKER-MAIL-READER-PLAN P3, D-BMR10; analysis Q-BM7, Q-BM10–12, Q-BMR7). Runs
 * once a minute in the `mail` scheduler lane, which a database lease gives to exactly one process.
 *
 * ── WHAT ONE MINUTE DOES ───────────────────────────────────────────────────────────────────────
 *  1. The dispatcher's alert (`broker_mail_waiting`, MANDATORY): every email on the page's two open
 *     queues (Waiting, Needs a load) that has had no answer for the company's time. Text and bell,
 *     day and night. Sent only when the gateway checked the thread in the last 3 minutes. If the
 *     gateway is behind, the alert is held up to 10 more minutes, then sent anyway with an alarm in
 *     the log (Q-BMR7: the dispatcher is never left untold because the reader stalled).
 *  2. The backups' notice (`broker_mail_backup`): the same email, still unanswered `backup_after`
 *     minutes later, to the backups an admin chose for that dispatcher (Q-BM10). Only on a FRESH
 *     check, never on a stale one (Q-BMR7). At night it is held to the start of working hours by the
 *     ordinary quiet window (Q-BM12), and the door check below looks at the email again before it leaves.
 *  3. The drain of broker mail's own queued texts (held backup notices, and any a dead run left), with
 *     that door check. Home time's drain never takes these rows (`ownDrain`), so no text is in two drains.
 *
 * ── WHAT IT NEVER DOES ─────────────────────────────────────────────────────────────────────────
 *  · Text about an email received before an admin switched the texts on (`texts_on_since`). Switching
 *    on must not text a week of backlog.
 *  · Text a person who cannot open the Broker mail page (the resolver's rule; the page starts off). And
 *    it never falls back to the section's managers (`noFallback`): an unanswered email is the
 *    dispatcher's, not every admin's bell.
 *  · Run while the gateway is switched off: a stale "waiting" is not a fact.
 *
 * Once only is the dedupe ledger's promise (`queue_notification_delivery` claims each line's key). The
 * `*_alerted_at` stamps (0651) only keep this tick from re-asking the ledger about the whole week every
 * minute. Every query filters `org_id`: the service role bypasses RLS.
 */

export const FRESH_CHECK_MS = 3 * 60_000;
export const STALE_GRACE_MS = 10 * 60_000;
/** A held backup notice older than this is about an email nobody should be woken for any more. */
export const HELD_NOTICE_MAX_MS = 16 * 3_600_000;
const BATCH = 200;
const KEY_RE = /^broker_mail:([0-9a-f-]{36}):(owner|backup)$/;
export const BROKER_MAIL_ALERT_KEYS: readonly AlertKey[] = ["broker_mail_waiting", "broker_mail_backup"];

interface Settings { answer_within_minutes: number; backup_after_minutes: number; texts_on_since: string | null }
interface Row {
  id: string;
  owner_user_id: string;
  received_at: string;
  from_address: string | null;
  from_domain: string | null;
  match_state: string;
  was_candidate: boolean;
  load_id: string | null;
  thread_checked_at: string | null;
  owner_alerted_at: string | null;
}

export interface TextsRun { owner: number; backup: number; heldForGateway: number; drained: { sent: number; failed: number; skipped: number } }

const fresh = (r: Pick<Row, "thread_checked_at">, nowMs: number) => r.thread_checked_at !== null && nowMs - Date.parse(r.thread_checked_at) <= FRESH_CHECK_MS;
const minutes = (from: string, nowMs: number) => Math.max(0, Math.floor((nowMs - Date.parse(from)) / 60_000));

/** "9:40 PM" on the carrier's clock. */
function clockTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso));
}

/** Pure: which rows are due which alert, now. Exported for its test. */
export function dueAlerts(rows: readonly Row[], s: Settings, nowMs: number): { owner: Row[]; ownerLate: Row[]; backup: Row[]; held: number } {
  const ownerAt = nowMs - s.answer_within_minutes * 60_000;
  const backupAt = ownerAt - s.backup_after_minutes * 60_000;
  const out = { owner: [] as Row[], ownerLate: [] as Row[], backup: [] as Row[], held: 0 };
  for (const r of rows) {
    if (r.match_state !== "one" && !r.was_candidate) continue; // the page's two open queues only
    const at = Date.parse(r.received_at);
    if (!r.owner_alerted_at) {
      if (at > ownerAt) continue;
      if (fresh(r, nowMs)) out.owner.push(r);
      else if (at <= ownerAt - STALE_GRACE_MS) out.ownerLate.push(r);
      else out.held += 1;
    } else if (at <= backupAt) {
      if (fresh(r, nowMs)) out.backup.push(r);
      else out.held += 1;
    }
  }
  return out;
}

async function stamp(admin: SupabaseClient, orgId: string, col: "owner_alerted_at" | "backup_alerted_at", ids: readonly string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await admin.from("broker_mail_messages").update({ [col]: now.toISOString() }).eq("org_id", orgId).in("id", [...ids]);
  if (error) throw new Error(`broker_mail_messages: ${error.message}`);
}

/**
 * The door check for broker mail's queued texts: keep the lines whose email is still unanswered. A
 * backup notice also needs a fresh check (`hold` until the gateway has one), and one held too long is
 * dropped. Texts switched off since: skipped.
 */
export function brokerMailDoor(admin: SupabaseClient, orgId: string, textsOn: boolean, now: Date): DoorCheck {
  return async (row) => {
    if (!textsOn) return { skip: "texts_off" };
    if (row.alert === "broker_mail_backup" && row.created_at && now.getTime() - Date.parse(row.created_at) > HELD_NOTICE_MAX_MS) return { skip: "too_old" };
    const ids = row.items.map((i) => KEY_RE.exec(i.key ?? "")?.[1]).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return { skip: "no_email" };
    const { data, error } = await admin.from("broker_mail_messages").select("id, thread_state, thread_checked_at").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`broker_mail_messages: ${error.message}`);
    const state = new Map(((data ?? []) as { id: string; thread_state: string; thread_checked_at: string | null }[]).map((m) => [m.id, m]));
    const open = row.items.filter((i) => state.get(KEY_RE.exec(i.key ?? "")?.[1] ?? "")?.thread_state === "waiting");
    if (open.length === 0) return { skip: "answered" };
    if (row.alert === "broker_mail_backup" && open.some((i) => !fresh(state.get(KEY_RE.exec(i.key ?? "")![1]!)!, now.getTime()))) return "hold";
    return { send: open };
  };
}

export async function runBrokerMailTextsOnce(admin: SupabaseClient, env: Env, now: Date): Promise<TextsRun | null> {
  const run: TextsRun = { owner: 0, backup: 0, heldForGateway: 0, drained: { sent: 0, failed: 0, skipped: 0 } };
  // One gateway per database (D-BMR12): its config row names the org.
  const cfgRes = await admin.from("mail_gateway_config").select("org_id, enabled").limit(1);
  if (cfgRes.error) throw new Error(`mail_gateway_config: ${cfgRes.error.message}`);
  const cfg = ((cfgRes.data ?? []) as { org_id: string; enabled: boolean }[])[0];
  if (!cfg) return null;
  const orgId = cfg.org_id;
  const sRes = await admin.from("broker_mail_settings").select("answer_within_minutes, backup_after_minutes, texts_on_since").eq("org_id", orgId).limit(1);
  if (sRes.error) throw new Error(`broker_mail_settings: ${sRes.error.message}`);
  const settings = ((sRes.data ?? []) as Settings[])[0] ?? null;
  const textsOn = Boolean(settings?.texts_on_since);
  const zone = await orgTimezone(admin, orgId);

  if (settings && textsOn && cfg.enabled) {
    const nowMs = now.getTime();
    const since = new Date(Math.max(Date.parse(settings.texts_on_since!), nowMs - BROKER_MAIL_OPEN_DAYS * 86_400_000)).toISOString();
    const { data, error } = await admin
      .from("broker_mail_messages")
      .select("id, owner_user_id, received_at, from_address, from_domain, match_state, was_candidate, load_id, thread_checked_at, owner_alerted_at")
      .eq("org_id", orgId)
      .eq("thread_state", "waiting")
      // The page's two open queues, in the query, so a week of non-broker mail cannot crowd the batch.
      .or("match_state.eq.one,was_candidate.eq.true")
      .is("backup_alerted_at", null)
      .gte("received_at", since)
      .lte("received_at", new Date(nowMs - settings.answer_within_minutes * 60_000).toISOString())
      .order("received_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`broker_mail_messages: ${error.message}`);
    const due = dueAlerts((data ?? []) as Row[], settings, nowMs);
    run.heldForGateway = due.held;
    if (due.ownerLate.length) console.error(`[broker-mail-texts] org ${orgId}: the mail gateway is behind; texting ${due.ownerLate.length} dispatcher alert(s) without a fresh check (Q-BMR7)`);

    const all = [...due.owner, ...due.ownerLate, ...due.backup];
    const loadIds = [...new Set(all.map((r) => r.load_id).filter((x): x is string => Boolean(x)))];
    const refs = new Map<string, string | null>();
    if (loadIds.length) {
      const l = await admin.from("loads").select("id, ref").eq("org_id", orgId).in("id", loadIds);
      if (l.error) throw new Error(`loads: ${l.error.message}`);
      for (const x of (l.data ?? []) as { id: string; ref: string | null }[]) refs.set(x.id, x.ref);
    }
    const sender = (r: Row) => r.from_domain ?? r.from_address ?? "A broker";
    const load = (r: Row) => (r.load_id ? `load ${refs.get(r.load_id) ?? "?"}` : "no load matched");
    const clock = { zone, now };

    const owners = [...due.owner, ...due.ownerLate];
    if (owners.length) {
      const events: AlertEvent[] = owners.map((r) => ({
        dedupeKey: `broker_mail:${r.id}:owner`,
        line: `${sender(r)}, ${load(r)}, waiting ${minutes(r.received_at, nowMs)} min`,
        severity: "warning",
        entityType: "broker_mail_message",
        entityId: r.id,
        relations: { mailbox_owner: r.owner_user_id },
      }));
      const sent = await sendAlerts(admin, env, orgId, "broker_mail_waiting", events, clock, { noFallback: true });
      run.owner = sent.texts + sent.bells;
      await stamp(admin, orgId, "owner_alerted_at", owners.map((r) => r.id), now);
    }

    if (due.backup.length) {
      const b = await admin.from("broker_mail_backups").select("dispatcher_user_id, backup_user_id").eq("org_id", orgId);
      if (b.error) throw new Error(`broker_mail_backups: ${b.error.message}`);
      const backupsOf = new Map<string, string[]>();
      for (const x of (b.data ?? []) as { dispatcher_user_id: string; backup_user_id: string }[]) {
        backupsOf.set(x.dispatcher_user_id, [...(backupsOf.get(x.dispatcher_user_id) ?? []), x.backup_user_id]);
      }
      const names = new Map((await listOfficeMembers(admin, orgId)).map((m) => [m.userId, m.fullName ?? m.email ?? "a dispatcher"]));
      const withBackups = due.backup.filter((r) => (backupsOf.get(r.owner_user_id) ?? []).length > 0);
      const events: AlertEvent[] = withBackups.map((r) => ({
        dedupeKey: `broker_mail:${r.id}:backup`,
        line: `Waiting since ${clockTime(r.received_at, zone)}: ${sender(r)}, ${load(r)}, dispatcher ${names.get(r.owner_user_id) ?? "unknown"}`,
        severity: "warning",
        entityType: "broker_mail_message",
        entityId: r.id,
        relations: { dispatcher_backup: backupsOf.get(r.owner_user_id) ?? [] },
      }));
      if (events.length) {
        const sent = await sendAlerts(admin, env, orgId, "broker_mail_backup", events, clock, { noFallback: true });
        run.backup = sent.texts + sent.textsHeld;
      }
      // Stamped either way: a dispatcher with no backups has nobody to notice, now or later.
      await stamp(admin, orgId, "backup_alerted_at", due.backup.map((r) => r.id), now);
    }
  }

  run.drained = await drainAlertTexts(admin, env, orgId, now, async () => zone, { only: BROKER_MAIL_ALERT_KEYS, door: brokerMailDoor(admin, orgId, textsOn && cfg.enabled, now) });
  return run;
}

/** The `mail` lane's one scheduler: once a minute, never two runs at once. */
export function startBrokerMailTextScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await runBrokerMailTextsOnce(getSupabaseAdmin(env), env, new Date());
      if (r && r.owner + r.backup + r.drained.sent + r.drained.failed + r.drained.skipped + r.heldForGateway > 0) {
        console.log(`[broker-mail-texts] dispatcher ${r.owner}, backup ${r.backup}, waiting on the gateway ${r.heldForGateway}; drained ${r.drained.sent} sent, ${r.drained.failed} failed, ${r.drained.skipped} skipped`);
      }
    } catch (e) {
      console.error("[broker-mail-texts] run failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref?.();
  console.log("[broker-mail-texts] enabled, every minute");
}
