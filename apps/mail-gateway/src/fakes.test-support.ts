import type { BrokerMailAnswer, BrokerMailEnvelope, MailGatewayCycleCounts, MailGatewayCycleStart, MailGatewayDraftWork } from "@silvicom/shared";
import type { GraphWrite } from "./graphWrite.js";
import type { Door } from "./door.js";
import { DoorNotReady } from "./door.js";
import { CursorReset, GraphThrottled, MailboxOverQuota, MailboxRefused, type GraphGet, type GraphPage } from "./graphClient.js";
import type { LogEvent } from "./log.js";

/**
 * Test fakes for runCycle: a Graph that serves pages from a per-mailbox script and records every URL
 * it was asked for, and a Door that records every call. Not a test file itself (no `.test.` in the
 * name's last segment), so vitest does not run it; tests import it.
 */

export const ORG_DOMAIN = "carrier.com";
export const at = (iso: string) => new Date(iso);

export type MailboxScript = {
  inboxId?: string;
  folders?: { id: string; parentFolderId: string | null }[];
  /** Pages per folder key: "inbox" | "sentitems" | <child id>. Each page is the messages on it. */
  pages?: Record<string, Record<string, unknown>[][]>;
  bodies?: Record<string, string>;
  fail?: "refused" | "over_quota" | "throttled";
  /** Fail a folder's delta with a cursor reset. */
  resetFolder?: string;
  /** P4: messages by internetMessageId → Graph id + conversation; drafts by conversation id. */
  byInternetId?: Record<string, { id: string; conversationId: string }>;
  draftsByConversation?: Record<string, string[]>;
};

export function fakeGraph(scripts: Record<string, MailboxScript>, probes: Record<string, number> = {}) {
  const requested: string[] = [];
  const who = (url: string) => decodeURIComponent(/\/users\/([^/?]+)/.exec(url)?.[1] ?? /users\('([^']+)'\)/.exec(url)?.[1] ?? "");
  const fail = (s: MailboxScript | undefined) => {
    if (s?.fail === "refused") throw new MailboxRefused(403);
    if (s?.fail === "over_quota") throw new MailboxOverQuota();
    if (s?.fail === "throttled") throw new GraphThrottled(30);
  };
  const graph: GraphGet = {
    async inboxId(url) { requested.push(url); const s = scripts[who(url)]; fail(s); return s?.inboxId ?? "INBOX"; },
    async probe(url) { requested.push(url); return probes[who(url)] ?? 403; },
    async body(url) { requested.push(url); const id = decodeURIComponent(/messages\/([^?]+)/.exec(url)?.[1] ?? ""); return scripts[who(url)]?.bodies?.[id] ?? null; },
    async page(url): Promise<GraphPage> {
      requested.push(url);
      const mb = who(url);
      const s = scripts[mb];
      fail(s);
      if (url.includes("/messages?$filter=internetMessageId")) {
        const want = decodeURIComponent(/eq%20(.+?)&/.exec(url)?.[1] ?? "").replace(/^'|'$/g, "").replace(/''/g, "'");
        const m = s?.byInternetId?.[want];
        return { value: m ? [m] : [], nextLink: null, deltaLink: null };
      }
      if (url.includes("/mailFolders/drafts/messages?$filter=conversationId")) {
        const conv = decodeURIComponent(/eq%20(.+?)&/.exec(url)?.[1] ?? "").replace(/^'|'$/g, "");
        return { value: (s?.draftsByConversation?.[conv] ?? []).map((id) => ({ id })), nextLink: null, deltaLink: null };
      }
      if (url.includes("/mailFolders/delta")) return { value: s?.folders ?? [], nextLink: null, deltaLink: `https://graph.microsoft.com/v1.0/users/${mb}/mailFolders/delta?$deltatoken=f` };
      const folder = /mailFolders\/([^/]+)\/messages/.exec(url)?.[1] ?? /mailFolders\('([^']+)'\)/.exec(url)?.[1] ?? "?";
      if (s?.resetFolder === folder) throw new CursorReset();
      const pages = s?.pages?.[folder] ?? [[]];
      const n = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 0);
      const base = `https://graph.microsoft.com/v1.0/users/${mb}/mailFolders/${folder}/messages/delta`;
      const last = n >= pages.length - 1;
      return {
        value: pages[n] ?? [],
        nextLink: last ? null : `${base}?page=${n + 1}`,
        deltaLink: last ? `${base}?$deltatoken=${folder}-done` : null,
      };
    },
  };
  return { graph, requested };
}

export function fakeDoor(start: Partial<MailGatewayCycleStart> & { mailboxes: MailGatewayCycleStart["mailboxes"] }, opts: { notReady?: boolean; drafts?: MailGatewayDraftWork; draftsNotReady?: boolean } = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const envelopes: BrokerMailEnvelope[] = [];
  const answers: BrokerMailAnswer[] = [];
  const checked: string[] = [];
  const cursors: { mailbox: string; folder: string; link: string | null }[] = [];
  let ended: { counts: MailGatewayCycleCounts; states: unknown[] } | null = null;
  const completed: { draft: string; result: string; id: string | null }[] = [];
  let canaryOpenedStops = true;
  const door: Door = {
    async begin(commit) {
      calls.push({ fn: "begin", args: [commit] });
      if (opts.notReady) throw new DoorNotReady("42883");
      return { cycle_id: "11111111-1111-4111-8111-111111111111", enabled: true, body_reading: false, mail_domains: [ORG_DOMAIN],
        cursors: [], probe_unlinked: [], known_sender_domains: [], canary_due: false, ...start };
    },
    async saveCursor(_c, mailbox, folder, _r, link) { calls.push({ fn: "saveCursor", args: [mailbox, folder, link] }); cursors.push({ mailbox, folder, link }); },
    async recordMessages(_c, list) { calls.push({ fn: "recordMessages", args: [list.length] }); envelopes.push(...list); return list.length; },
    async markThreads(_c, list, chk) { calls.push({ fn: "markThreads", args: [list.length, chk] }); answers.push(...list); checked.push(...chk); return 0; },
    async recordProbe(_c, kind, mailbox, result) { calls.push({ fn: "recordProbe", args: [kind, mailbox, result] }); return !(kind === "canary" && result === "opened" && canaryOpenedStops); },
    async end(_c, counts, states) { calls.push({ fn: "end", args: [] }); ended = { counts, states }; },
    async claimDrafts() {
      calls.push({ fn: "claimDrafts", args: [] });
      if (opts.draftsNotReady) throw new DoorNotReady("42883");
      return opts.drafts ?? { create: [], remove: [] };
    },
    async completeDraft(_c, draft, result, id) { calls.push({ fn: "completeDraft", args: [draft, result, id] }); completed.push({ draft, result, id }); },
  };
  return {
    door, calls, envelopes, answers, checked, cursors, completed,
    get ended() { return ended; },
    set canaryOpenedStops(v: boolean) { canaryOpenedStops = v; },
  };
}

export function captureLog() {
  const events: LogEvent[] = [];
  return { log: (e: LogEvent) => { events.push(e); }, events };
}

export const msg = (o: Partial<Record<string, unknown>> & { id: string }) => ({
  internetMessageId: `<${o.id}@x>`,
  conversationId: "conv-1",
  receivedDateTime: "2026-11-24T15:00:00Z",
  from: { emailAddress: { address: "ops@broker.com" } },
  toRecipients: [{ emailAddress: { address: "ann@carrier.com" } }],
  ccRecipients: [],
  subject: "Update",
  ...o,
});

/** A GraphWrite that records each write and answers from a script (P4). */
export function fakeWrite(o: { createStatus?: "ok" | "refused" | "throttled"; deleteAnswer?: "deleted" | "gone" } = {}) {
  const writes: { kind: "create" | "delete"; url: string; comment?: string }[] = [];
  const write: GraphWrite = {
    async createReply(url, comment) {
      writes.push({ kind: "create", url, comment });
      if (o.createStatus === "refused") throw new MailboxRefused(403);
      if (o.createStatus === "throttled") throw new GraphThrottled(30);
      return "AAMkDraft-new";
    },
    async deleteDraft(url) { writes.push({ kind: "delete", url }); return o.deleteAnswer ?? "deleted"; },
  };
  return { write, writes };
}
