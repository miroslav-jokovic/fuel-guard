import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BROKER_MAIL_WEEK_MATCH_PASS,
  BROKER_MAIL_WEEK_SAMPLE,
  BROKER_MAIL_WEEK_TOP_DOMAINS,
  alertTextNotBefore,
  brokerMailTokensIn,
  todayInZone,
  dayRangeInstants,
  inAlertTextQuiet,
  shiftDay,
  type AlertTextQuiet,
  type BrokerMailMatchState,
  type BrokerMailThreadState,
  type BrokerMailWeek,
  type BrokerMailWeekStats,
} from "@silvicom/shared";
import { readAlertTextQuiet } from "../messaging/index.js";
import { listOfficeMembers, orgTimezone } from "../org/index.js";
import { readFleetDispatchers } from "../mcleod/index.js";
import { readSettingsRow } from "./brokerMailList.js";

/**
 * The measure-only week's report (BROKER-MAIL-READER-PLAN §8; contract and the rule behind every
 * number: `brokerMailWeekContract.ts`). Read by an admin on Settings › Broker mail › Measure week.
 *
 * `buildBrokerMailWeek` is pure — rows in, report out — so each §8 line is a unit test. The reader
 * pages through the range with the service role, org-filtered on every query (it bypasses RLS);
 * asserted in `routes.test.ts` by "reads the range org-scoped, page by page, and answers the contract".
 */

export interface WeekMessage {
  id: string;
  owner_user_id: string;
  received_at: string;
  from_address: string | null;
  from_domain: string | null;
  conversation_id: string | null;
  subject: string | null;
  addressed_directly: boolean;
  was_candidate: boolean;
  body_was_read: boolean;
  matched_refs: string[] | null;
  match_state: BrokerMailMatchState;
  load_id: string | null;
  thread_state: BrokerMailThreadState;
  answered_at: string | null;
}
export interface WeekCycle { started_at: string; counts: Record<string, unknown> | null }

export interface WeekInput {
  from: string;
  to: string;
  zone: string;
  nowMs: number;
  quiet: AlertTextQuiet;
  answerWithinMinutes: number;
  backupAfterMinutes: number;
  messages: readonly WeekMessage[];
  /** null: the range is older than the cycle rows' 14 days. */
  cycles: readonly WeekCycle[] | null;
  names: ReadonlyMap<string, string>;
  /** load id → its ref and the 360 user of its McLeod dispatcher (null when unlinked). */
  loads: ReadonlyMap<string, { ref: string | null; dispatcherUserId: string | null }>;
}

const MIN = 60_000;
const emptyStats = (): BrokerMailWeekStats => ({
  external: 0, candidates: 0, bodiesRead: 0,
  match: { one: 0, several: 0, none: 0, not_tried: 0 },
  oneBySubject: 0, oneOwnersLoad: 0, viaList: 0,
  answeredByOwner: 0, answeredByColleague: 0, stillWaiting: 0,
  replyMinutesMedian: null, replyMinutesP90: null,
  wouldText: { dispatcherDay: 0, dispatcherNight: 0, backupDay: 0, backupHeldToMorning: 0 },
  followUpNewConversation: 0,
});

/** Nearest-rank percentile of a sorted list. */
const pct = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! : null);

/** Is the email still unanswered at `atMs`? (Answered before it = no text.) */
const openAt = (m: WeekMessage, atMs: number) => m.answered_at === null || Date.parse(m.answered_at) > atMs;

function addOne(s: BrokerMailWeekStats, m: WeekMessage, input: WeekInput, replies: number[]): void {
  s.external++;
  if (m.was_candidate) s.candidates++;
  if (m.body_was_read) s.bodiesRead++;
  s.match[m.match_state]++;
  if (m.match_state === "one") {
    const subjectTokens = new Set(brokerMailTokensIn(m.subject));
    if ((m.matched_refs ?? []).some((t) => subjectTokens.has(t))) s.oneBySubject++;
    if (m.load_id && input.loads.get(m.load_id)?.dispatcherUserId === m.owner_user_id) s.oneOwnersLoad++;
  }
  if (!m.addressed_directly) s.viaList++;
  if (m.thread_state === "answered_by_owner") s.answeredByOwner++;
  else if (m.thread_state === "answered_by_colleague") s.answeredByColleague++;
  else s.stillWaiting++;
  const at = Date.parse(m.received_at);
  if (m.answered_at) replies.push(Math.max(0, (Date.parse(m.answered_at) - at) / MIN));

  // P3 replayed: only the page's two open queues text, and only once the moment has passed.
  if (m.match_state !== "one" && !m.was_candidate) return;
  const ownerAt = at + input.answerWithinMinutes * MIN;
  if (ownerAt > input.nowMs || !openAt(m, ownerAt)) return;
  if (inAlertTextQuiet(new Date(ownerAt), input.zone, input.quiet)) s.wouldText.dispatcherNight++;
  else s.wouldText.dispatcherDay++;
  const backupAt = ownerAt + input.backupAfterMinutes * MIN;
  if (backupAt > input.nowMs || !openAt(m, backupAt)) return;
  const morning = alertTextNotBefore(new Date(backupAt), input.zone, input.quiet);
  if (!morning) s.wouldText.backupDay++;
  else if (morning.getTime() <= input.nowMs && openAt(m, morning.getTime())) s.wouldText.backupHeldToMorning++;
}

function finish(s: BrokerMailWeekStats, replies: number[], rows: readonly WeekMessage[]): BrokerMailWeekStats {
  replies.sort((a, b) => a - b);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  s.replyMinutesMedian = round(pct(replies, 0.5));
  s.replyMinutesP90 = round(pct(replies, 0.9));
  const convs = new Map<string, Set<string>>();
  for (const m of rows) {
    if (!m.load_id || !m.from_address || !m.conversation_id) continue;
    const k = `${m.owner_user_id}|${m.from_address}|${m.load_id}`;
    convs.set(k, (convs.get(k) ?? new Set()).add(m.conversation_id));
  }
  for (const c of convs.values()) s.followUpNewConversation += c.size - 1;
  return s;
}

function statsOf(rows: readonly WeekMessage[], input: WeekInput): BrokerMailWeekStats {
  const s = emptyStats();
  const replies: number[] = [];
  for (const m of rows) addOne(s, m, input, replies);
  return finish(s, replies, rows);
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

export function buildBrokerMailWeek(input: WeekInput): BrokerMailWeek {
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = shiftDay(d, 1)) days.push(d);
  const byDay = groupBy(input.messages, (m) => todayInZone(new Date(m.received_at), input.zone));
  const runsByDay = input.cycles ? groupBy(input.cycles, (c) => todayInZone(new Date(c.started_at), input.zone)) : null;
  const num = (c: WeekCycle, k: string) => (typeof c.counts?.[k] === "number" ? (c.counts[k] as number) : 0);

  const total = statsOf(input.messages, input);
  const noRef = new Map<string, number>();
  for (const m of input.messages) if (m.match_state === "not_tried" && m.from_domain) noRef.set(m.from_domain, (noRef.get(m.from_domain) ?? 0) + 1);

  // A fixed pick for a fixed range: rows that were waiting at some point, ordered by a hash of their id.
  const hash = (s: string) => createHash("sha256").update(`${input.from}|${s}`).digest("hex");
  const sample = input.messages
    .filter((m) => (m.match_state === "one" || m.was_candidate))
    .map((m) => ({ m, h: hash(m.id) }))
    .sort((a, b) => (a.h < b.h ? -1 : 1))
    .slice(0, BROKER_MAIL_WEEK_SAMPLE)
    .map(({ m }) => m)
    .sort((a, b) => a.received_at.localeCompare(b.received_at));

  return {
    from: input.from,
    to: input.to,
    zone: input.zone,
    settings: { answerWithinMinutes: input.answerWithinMinutes, backupAfterMinutes: input.backupAfterMinutes },
    runCountsKept: input.cycles !== null,
    total,
    days: days.map((day) => {
      const runs = runsByDay?.get(day) ?? [];
      const { start, endExclusive } = dayRangeInstants(day, day, input.zone);
      const passed = Math.max(0, Math.min(input.nowMs, Date.parse(endExclusive)) - Date.parse(start));
      return {
        day,
        stats: statsOf(byDay.get(day) ?? [], input),
        runs: runsByDay ? {
          runs: runs.length,
          runsExpected: Math.floor(passed / MIN),
          messagesRead: runs.reduce((a, c) => a + num(c, "messages_in"), 0),
          bodiesRead: runs.reduce((a, c) => a + num(c, "bodies_read"), 0),
          throttled: runs.reduce((a, c) => a + num(c, "graph_throttled"), 0),
          errors: runs.reduce((a, c) => a + num(c, "errors"), 0),
        } : null,
      };
    }),
    mailboxes: [...groupBy(input.messages, (m) => m.owner_user_id)]
      .map(([userId, rows]) => ({ userId, name: input.names.get(userId) ?? "A former member", stats: statsOf(rows, input) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    noReferenceDomains: [...noRef].map(([domain, emails]) => ({ domain, emails }))
      .sort((a, b) => b.emails - a.emails || a.domain.localeCompare(b.domain)).slice(0, BROKER_MAIL_WEEK_TOP_DOMAINS),
    passMarks: {
      matchedOneShare: total.candidates ? total.match.one / total.candidates : null,
      matchedOnePass: total.candidates ? total.match.one / total.candidates >= BROKER_MAIL_WEEK_MATCH_PASS : null,
    },
    sample: sample.map((m) => ({
      id: m.id,
      ownerName: input.names.get(m.owner_user_id) ?? "A former member",
      receivedAt: m.received_at,
      fromAddress: m.from_address,
      subject: m.subject,
      matchState: m.match_state,
      loadRef: m.load_id ? input.loads.get(m.load_id)?.ref ?? null : null,
      threadState: m.thread_state,
      answeredAt: m.answered_at,
    })),
  };
}

const PAGE = 1000;
/** Every row of a ranged query, a page at a time (PostgREST caps one response). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await page(i, i + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const MSG_COLUMNS =
  "id, owner_user_id, received_at, from_address, from_domain, conversation_id, subject, addressed_directly, was_candidate, body_was_read, matched_refs, match_state, load_id, thread_state, answered_at";
/** `mail_gateway_cycles` is kept 14 days (0643). */
export const CYCLES_KEPT_DAYS = 14;

export async function readBrokerMailWeek(admin: SupabaseClient, orgId: string, from: string, to: string, now: Date = new Date()): Promise<BrokerMailWeek> {
  const zone = await orgTimezone(admin, orgId);
  const { start, endExclusive } = dayRangeInstants(from, to, zone);
  const cyclesKept = Date.parse(start) >= now.getTime() - CYCLES_KEPT_DAYS * 86_400_000;
  const [messages, cycles, settings, quiet, members, dispatchers] = await Promise.all([
    allPages<WeekMessage>((a, b) => admin.from("broker_mail_messages").select(MSG_COLUMNS).eq("org_id", orgId)
      .gte("received_at", start).lt("received_at", endExclusive).order("received_at", { ascending: true }).order("id", { ascending: true }).range(a, b)),
    cyclesKept
      ? allPages<WeekCycle>((a, b) => admin.from("mail_gateway_cycles").select("started_at, counts").eq("org_id", orgId)
          .gte("started_at", start).lt("started_at", endExclusive).order("started_at", { ascending: true }).order("id", { ascending: true }).range(a, b))
      : Promise.resolve(null),
    readSettingsRow(admin, orgId),
    readAlertTextQuiet(admin, orgId),
    listOfficeMembers(admin, orgId),
    readFleetDispatchers(admin, orgId),
  ]);

  const loadIds = [...new Set(messages.map((m) => m.load_id).filter((x): x is string => Boolean(x)))];
  const loads = new Map<string, { ref: string | null; dispatcherUserId: string | null }>();
  const userOfLogin = new Map(dispatchers.dispatchers.map((d) => [d.id, d.userId]));
  for (let i = 0; i < loadIds.length; i += 200) {
    const { data, error } = await admin.from("loads").select("id, ref, dispatcher_external_id").eq("org_id", orgId).in("id", loadIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as { id: string; ref: string | null; dispatcher_external_id: string | null }[]) {
      loads.set(l.id, { ref: l.ref, dispatcherUserId: l.dispatcher_external_id ? userOfLogin.get(l.dispatcher_external_id) ?? null : null });
    }
  }
  const names = new Map(members.map((m) => [m.userId, m.fullName ?? m.email ?? "Unnamed"]));

  return buildBrokerMailWeek({
    from, to, zone, nowMs: now.getTime(), quiet,
    answerWithinMinutes: settings.answerWithinMinutes,
    backupAfterMinutes: settings.backupAfterMinutes,
    messages, cycles, names, loads,
  });
}
