import type { MailGatewayDraftResult } from "@silvicom/shared";
import type { Door } from "./door.js";
import { graphUrl } from "./graphCalls.js";
import { GraphThrottled, MailboxRefused, type GraphGet } from "./graphClient.js";
import type { GraphWrite } from "./graphWrite.js";
import { errorClass, type Logger } from "./log.js";

/**
 * One run's draft work (P4, D-BMR11), after the mailboxes were read — so an answer that arrived this
 * minute has already closed its email, and `mailgw_claim_drafts` has already dropped that draft.
 *
 * To CREATE, per draft, in the owner's own mailbox:
 *   1. find the broker's email by the `internetMessageId` 360 stored (Graph's own id is per mailbox and
 *      never stored). Gone → `not_found`.
 *   2. look in Drafts for that conversation. Anything there is a person's reply in progress — 360 only
 *      makes a draft when none of its own is open — so 360 stands back: `person_draft_found`.
 *   3. createReply with our text. Microsoft refusing the write → `refused` (the scope has no write yet).
 * To REMOVE (the owner answered in their own words after 360's draft went in): delete it under Drafts;
 * a draft already sent answers 404 → `sent_or_gone`, and nothing outside Drafts can be touched.
 *
 * Throttled: the draft stays claimed and a later run takes it again after two minutes (0656). Any other
 * error: `failed`, so the page says so instead of waiting forever. The log carries counts and error
 * classes only — never an address, an id or a word of the text.
 */

export interface DraftDeps {
  door: Door;
  graph: GraphGet;
  write: GraphWrite;
  log: Logger;
  cycle: string;
  allowed: ReadonlySet<string>;
  now: () => Date;
  deadline: number;
}

export interface DraftCounts { drafts_created: number; drafts_stood_back: number; drafts_refused: number; drafts_removed: number; drafts_failed: number }

async function createOne(d: DraftDeps, job: { draft_id: string; mailbox: string; text: string; internet_message_id: string }): Promise<{ result: MailGatewayDraftResult; id: string | null }> {
  const found = await d.graph.page(graphUrl({ shape: "find_message", mailbox: job.mailbox, internetMessageId: job.internet_message_id }, d.allowed));
  const msg = found.value.find((m) => typeof m.id === "string");
  if (!msg) return { result: "not_found", id: null };
  const conversationId = typeof msg.conversationId === "string" ? msg.conversationId : null;
  if (conversationId) {
    const drafts = await d.graph.page(graphUrl({ shape: "conversation_drafts", mailbox: job.mailbox, conversationId }, d.allowed));
    if (drafts.value.length > 0) return { result: "person_draft_found", id: null };
  }
  const id = await d.write.createReply(graphUrl({ shape: "create_reply", mailbox: job.mailbox, messageId: msg.id as string }, d.allowed), job.text);
  return { result: "in_outlook", id };
}

export async function runDrafts(d: DraftDeps): Promise<DraftCounts> {
  const counts: DraftCounts = { drafts_created: 0, drafts_stood_back: 0, drafts_refused: 0, drafts_removed: 0, drafts_failed: 0 };
  const work = await d.door.claimDrafts(d.cycle);
  for (const job of work.create) {
    if (d.now().getTime() > d.deadline) break; // still claimed; a later run takes it after two minutes
    let out: { result: MailGatewayDraftResult; id: string | null };
    try {
      out = await createOne(d, job);
    } catch (e) {
      if (e instanceof GraphThrottled) continue;
      out = { result: e instanceof MailboxRefused && e.status === 403 ? "refused" : "failed", id: null };
      if (out.result === "failed") d.log({ event: "draft_error", class: errorClass(e) });
    }
    await d.door.completeDraft(d.cycle, job.draft_id, out.result, out.id);
    if (out.result === "in_outlook") counts.drafts_created++;
    else if (out.result === "person_draft_found" || out.result === "not_found") counts.drafts_stood_back++;
    else if (out.result === "refused") counts.drafts_refused++;
    else counts.drafts_failed++;
  }
  for (const job of work.remove) {
    if (d.now().getTime() > d.deadline) break;
    try {
      const r = await d.write.deleteDraft(graphUrl({ shape: "delete_draft", mailbox: job.mailbox, draftId: job.graph_draft_id }, d.allowed));
      await d.door.completeDraft(d.cycle, job.draft_id, r === "deleted" ? "removed" : "sent_or_gone", null);
      if (r === "deleted") counts.drafts_removed++;
    } catch (e) {
      // Left in Outlook: the next run asks again. A refused delete is the same missing write permission.
      if (!(e instanceof GraphThrottled)) { counts.drafts_failed++; d.log({ event: "draft_error", class: errorClass(e) }); }
    }
  }
  return counts;
}
