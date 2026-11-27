import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BROKER_MAIL_ANSWER_DEFAULT,
  BROKER_MAIL_BACKUP_DEFAULT,
  BROKER_MAIL_ANSWERED_HOURS,
  BROKER_MAIL_OPEN_DAYS,
  BROKER_MAIL_PAGE_LIMIT,
  type BrokerMailList,
  type BrokerMailRosterReason,
  type BrokerMailRow,
  type BrokerMailTab,
} from "@silvicom/shared";
import { listOfficeMembers } from "../org/index.js";
import { readBackups, readTextStates } from "./brokerMailBackups.js";

/**
 * The Broker mail page's read (BROKER-MAIL-READER-PLAN P2). Every query here is filtered by org AND —
 * unless the caller holds `dispatch.broker_mail_all` — by `owner_user_id` = the caller: the tables are
 * deny-all and the service role bypasses RLS, so these filters ARE the rule that a dispatcher never
 * sees a colleague's mail (Q-BM9, analysis §6.2). Asserted on every query by `routes.test.ts`, "once turned on, a
 * dispatcher is sent only their own mailbox's rows — every query filters org AND owner".
 *
 * ── WHAT EACH QUEUE IS ─────────────────────────────────────────────────────────────────────────
 *  · waiting    — no answer seen in the owner's mailbox, and the references named exactly one load.
 *  · needs_load — no answer seen, the gateway judged it a broker email (D-BMR6's candidate: a
 *                 reference in the subject, or a sender domain that matched a load before), but the
 *                 references named no load or several. A non-candidate external email (a vendor's
 *                 newsletter) is counted by the measure week and never queued for a person.
 *  · answered   — the owner or a colleague answered in the last day (D-BMR9).
 */

export interface ListInput {
  orgId: string;
  callerId: string;
  tab: BrokerMailTab;
  seesAll: boolean;
  /** Only honoured when `seesAll`: one dispatcher's rows. */
  ownerId: string | null;
  nowMs?: number;
}

interface MessageRow {
  id: string;
  owner_user_id: string;
  received_at: string;
  from_address: string | null;
  from_domain: string | null;
  subject: string | null;
  match_state: BrokerMailRow["matchState"];
  matched_refs: string[] | null;
  load_id: string | null;
  thread_state: BrokerMailRow["threadState"];
  answered_at: string | null;
  addressed_directly: boolean;
}

export interface RosterRow { user_id: string | null; mcleod_logins: string[]; email: string | null; reason: BrokerMailRosterReason | null }

const COLUMNS =
  "id, owner_user_id, received_at, from_address, from_domain, subject, match_state, matched_refs, load_id, thread_state, answered_at, addressed_directly";

/** The roster (0649): every McLeod dispatcher and why their mailbox is or is not read. */
export async function readRoster(admin: SupabaseClient, orgId: string): Promise<RosterRow[]> {
  const { data, error } = await admin.rpc("mailgw_mailbox_roster", { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as RosterRow[];
}

export interface SettingsRow { answerWithinMinutes: number; backupAfterMinutes: number; textsOnSince: string | null }

/** The company row (0649, 0651); the defaults when it has saved none. */
export async function readSettingsRow(admin: SupabaseClient, orgId: string): Promise<SettingsRow> {
  const { data, error } = await admin.from("broker_mail_settings").select("answer_within_minutes, backup_after_minutes, texts_on_since").eq("org_id", orgId).limit(1);
  if (error) throw new Error(error.message);
  const r = ((data ?? []) as { answer_within_minutes: number; backup_after_minutes: number; texts_on_since: string | null }[])[0];
  return {
    answerWithinMinutes: r?.answer_within_minutes ?? BROKER_MAIL_ANSWER_DEFAULT,
    backupAfterMinutes: r?.backup_after_minutes ?? BROKER_MAIL_BACKUP_DEFAULT,
    textsOnSince: r?.texts_on_since ?? null,
  };
}

/** Is mail reading switched on for THIS org (the one config row names it, D-BMR12)? */
export async function readGatewayEnabled(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin.from("mail_gateway_config").select("enabled").eq("org_id", orgId).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { enabled: boolean }[])[0]?.enabled === true;
}

export function myMailbox(enabled: boolean, roster: RosterRow[], callerId: string): BrokerMailList["myMailbox"] {
  if (!enabled) return { read: false, reason: "off" };
  const mine = roster.find((r) => r.user_id === callerId);
  if (!mine) return { read: false, reason: "not_dispatcher" };
  return { read: mine.reason === null, reason: mine.reason };
}

export async function readBrokerMailList(admin: SupabaseClient, input: ListInput): Promise<BrokerMailList> {
  const now = input.nowMs ?? Date.now();
  const openSince = new Date(now - BROKER_MAIL_OPEN_DAYS * 86_400_000).toISOString();
  const answeredSince = new Date(now - BROKER_MAIL_ANSWERED_HOURS * 3_600_000).toISOString();
  const owner = input.seesAll ? input.ownerId : input.callerId;

  // One builder for every query, so no query can leave out the org or the owner filter.
  const scoped = (cols: string, head = false) => {
    const q = admin.from("broker_mail_messages").select(cols, head ? { count: "exact", head: true } : undefined).eq("org_id", input.orgId);
    return owner ? q.eq("owner_user_id", owner) : q;
  };
  const queue = (tab: BrokerMailTab, cols: string, head = false) => {
    const q = scoped(cols, head);
    if (tab === "waiting") return q.eq("thread_state", "waiting").eq("match_state", "one").gte("received_at", openSince);
    if (tab === "needs_load") return q.eq("thread_state", "waiting").neq("match_state", "one").eq("was_candidate", true).gte("received_at", openSince);
    return q.neq("thread_state", "waiting").gte("answered_at", answeredSince);
  };

  const [rowsRes, waiting, needsLoad, handled, settings, roster, enabled, backups, myText] = await Promise.all([
    (input.tab === "handled"
      ? queue("handled", COLUMNS).order("answered_at", { ascending: false })
      : queue(input.tab, COLUMNS).order("received_at", { ascending: true })
    ).limit(BROKER_MAIL_PAGE_LIMIT),
    queue("waiting", "id", true),
    queue("needs_load", "id", true),
    queue("handled", "id", true),
    readSettingsRow(admin, input.orgId),
    readRoster(admin, input.orgId),
    readGatewayEnabled(admin, input.orgId),
    readBackups(admin, input.orgId),
    readTextStates(admin, input.orgId, [input.callerId]),
  ]);
  for (const r of [rowsRes, waiting, needsLoad, handled]) if (r.error) throw new Error(r.error.message);
  const rows = (rowsRes.data ?? []) as unknown as MessageRow[];

  const loadIds = [...new Set(rows.map((r) => r.load_id).filter((x): x is string => Boolean(x)))];
  const refs = new Map<string, string | null>();
  if (loadIds.length) {
    const { data, error } = await admin.from("loads").select("id, ref").eq("org_id", input.orgId).in("id", loadIds);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as { id: string; ref: string | null }[]) refs.set(l.id, l.ref);
  }

  const names = new Map<string, string>();
  const myBackupIds = backups.get(input.callerId) ?? [];
  if (input.seesAll || myBackupIds.length) {
    for (const m of await listOfficeMembers(admin, input.orgId)) names.set(m.userId, m.fullName ?? m.email ?? "Unnamed");
    // A suspended or departed owner is not an office member any more; their sign-in email still names them.
    for (const r of roster) if (r.user_id && !names.has(r.user_id) && r.email) names.set(r.user_id, r.email);
  }

  return {
    tab: input.tab,
    rows: rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      fromAddress: r.from_address,
      fromDomain: r.from_domain,
      subject: r.subject,
      matchState: r.match_state,
      load: r.load_id ? { id: r.load_id, ref: refs.get(r.load_id) ?? null } : null,
      matchedRefs: r.matched_refs ?? [],
      threadState: r.thread_state,
      answeredAt: r.answered_at,
      addressedDirectly: r.addressed_directly,
      ownerUserId: r.owner_user_id,
      ownerName: input.seesAll ? names.get(r.owner_user_id) ?? null : null,
    })),
    counts: { waiting: waiting.count ?? 0, needs_load: needsLoad.count ?? 0, handled: handled.count ?? 0 },
    answerWithinMinutes: settings.answerWithinMinutes,
    seesAll: input.seesAll,
    // The dispatchers whose mailboxes are read — the filter's choices — only for a caller who sees all.
    dispatchers: input.seesAll
      ? roster.filter((r) => r.user_id && r.reason === null)
          .map((r) => ({ userId: r.user_id as string, name: names.get(r.user_id as string) ?? r.email ?? "Unnamed" }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    myMailbox: myMailbox(enabled, roster, input.callerId),
    texts: {
      on: settings.textsOnSince !== null,
      me: myText.get(input.callerId) ?? "none",
      myBackups: myBackupIds.map((u) => names.get(u) ?? "A colleague"),
    },
  };
}
