import type { BrokerMailAnswer, BrokerMailEnvelope, MailGatewayCycleStart, MailGatewayFolderRole } from "@silvicom/shared";
import { answerFrom, classifyInbox, tokensIn } from "./classify.js";
import type { Door } from "./door.js";
import { acceptPagingLink, graphUrl, type FolderRef } from "./graphCalls.js";
import { CursorReset, type GraphGet } from "./graphClient.js";

/**
 * One mailbox, one cycle (§7 steps 2–6).
 *
 * Folders (D-BMR6): Inbox, every folder under it, then Sent Items — never Drafts, Deleted Items or
 * Junk. Only `created` changes are asked for, so filing or deleting a message changes nothing here.
 *
 * Order, per page: record the envelopes → close the threads this page's answers prove → save the
 * cursor. A crash therefore re-reads a page (the record is idempotent) instead of skipping one. After
 * the last folder, every answer seen this cycle is applied once more: an answer can arrive on an
 * earlier page than the message it answers, and the second pass catches it.
 *
 * Sent Items is read only when every Inbox folder reached the end of its changes this cycle, and
 * only then is the mailbox "checked" — the stamp 360's text door trusts (D-BMR10). A mailbox that ran
 * out of time is simply read further next minute.
 */

export const FIRST_READ_DAYS = 7;
const MAX_FOLDERS = 100;

export interface MailboxCounts {
  messages_in: number; external: number; candidates: number; bodies_read: number; cursor_resets: number;
}

export interface MailboxDeps {
  door: Door;
  graph: GraphGet;
  cycle: string;
  start: MailGatewayCycleStart;
  allowed: ReadonlySet<string>;
  now: () => Date;
  /** Epoch ms after which no new page is started. */
  deadline: number;
}

type Folder = { ref: FolderRef; folderId: string; role: MailGatewayFolderRole };

async function inboxFolders(mailbox: string, d: MailboxDeps): Promise<Folder[]> {
  const inboxId = await d.graph.inboxId(graphUrl({ shape: "inbox_probe", mailbox }, d.allowed));
  const parents = new Map<string, string | null>();
  let url: string | null = graphUrl({ shape: "folder_delta", mailbox }, d.allowed);
  while (url && parents.size < 1000) {
    const page = await d.graph.page(url);
    for (const f of page.value) if (typeof f.id === "string") parents.set(f.id, typeof f.parentFolderId === "string" ? f.parentFolderId : null);
    url = page.nextLink ? acceptPagingLink(page.nextLink, { mailbox, shape: "folder_delta" }, d.allowed) : null;
  }
  const under = (id: string): boolean => {
    for (let p = parents.get(id), hops = 0; p && hops < 20; p = parents.get(p), hops++) if (p === inboxId) return true;
    return false;
  };
  const children = [...parents.keys()].filter(under).slice(0, MAX_FOLDERS);
  return [
    { ref: { kind: "inbox" }, folderId: "inbox", role: "inbox" },
    ...children.map((id): Folder => ({ ref: { kind: "id", id }, folderId: id, role: "inbox_child" })),
  ];
}

/** Reads one folder to the end of its changes, or until the deadline. Returns whether it reached the end. */
async function readFolder(mailbox: string, folder: Folder, d: MailboxDeps, out: { answers: BrokerMailAnswer[]; counts: MailboxCounts }): Promise<boolean> {
  const saved = d.start.cursors.find((c) => c.mailbox === mailbox && c.folder_id === folder.folderId);
  const since = new Date(d.now().getTime() - FIRST_READ_DAYS * 86_400_000).toISOString();
  let url: string | null = saved
    ? acceptPagingLink(saved.delta_link, { mailbox, shape: "message_delta" }, d.allowed)
    : graphUrl({ shape: "message_delta", mailbox, folder: folder.ref, receivedSince: since }, d.allowed);
  const known = new Set(d.start.known_sender_domains);
  try {
    while (url) {
      if (d.now().getTime() > d.deadline) return false;
      const page = await d.graph.page(url);
      const envelopes: BrokerMailEnvelope[] = [];
      const answers: BrokerMailAnswer[] = [];
      for (const msg of page.value) {
        out.counts.messages_in++;
        if (folder.role === "sent") {
          const a = answerFrom(msg, { mailbox, folder: "sent" });
          if (a) answers.push(a);
          continue;
        }
        const v = classifyInbox(msg, { mailbox, mailDomains: d.start.mail_domains, knownSenderDomains: known });
        if (!v) continue;
        if (!v.external) {
          const a = answerFrom(msg, { mailbox, folder: "inbox" });
          if (a) answers.push(a);
          continue;
        }
        out.counts.external++;
        let bodyWasRead = false;
        let tokens = v.envelope.tokens;
        if (v.candidate) out.counts.candidates++;
        if (v.candidate && d.start.body_reading && v.graphId) {
          // Held in memory for the length of one function call, searched, and dropped (D-BMR6).
          const body = await d.graph.body(graphUrl({ shape: "message_body", mailbox, messageId: v.graphId }, d.allowed, { bodyReading: true }));
          tokens = [...new Set([...tokens, ...tokensIn(body)])].slice(0, 50);
          bodyWasRead = true;
          out.counts.bodies_read++;
        }
        envelopes.push({ ...v.envelope, tokens, body_was_read: bodyWasRead });
      }
      await d.door.recordMessages(d.cycle, envelopes);
      if (answers.length) await d.door.markThreads(d.cycle, answers, []);
      out.answers.push(...answers);
      const next = page.nextLink ?? page.deltaLink;
      if (next) await d.door.saveCursor(d.cycle, mailbox, folder.folderId, folder.role, acceptPagingLink(next, { mailbox, shape: "message_delta" }, d.allowed));
      url = page.nextLink ? acceptPagingLink(page.nextLink, { mailbox, shape: "message_delta" }, d.allowed) : null;
    }
    return true;
  } catch (e) {
    if (!(e instanceof CursorReset)) throw e;
    // Graph forgot the position (an old or reset link): forget ours too and start again next minute.
    await d.door.saveCursor(d.cycle, mailbox, folder.folderId, folder.role, null);
    out.counts.cursor_resets++;
    return false;
  }
}

/** Reads the mailbox; resolves true when it was read to the end (the "checked" stamp is then earned). */
export async function readMailbox(mailbox: string, d: MailboxDeps, counts: MailboxCounts): Promise<boolean> {
  const out = { answers: [] as BrokerMailAnswer[], counts };
  let complete = true;
  for (const folder of await inboxFolders(mailbox, d)) {
    if (!(await readFolder(mailbox, folder, d, out))) complete = false;
  }
  if (complete) complete = await readFolder(mailbox, { ref: { kind: "sentitems" }, folderId: "sentitems", role: "sent" }, d, out);
  await d.door.markThreads(d.cycle, out.answers, complete ? [mailbox] : []);
  return complete;
}
