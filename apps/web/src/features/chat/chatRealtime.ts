import { onScopeDispose, watch, type Ref } from "vue";
import { useQueryClient, type QueryClient } from "@tanstack/vue-query";
import type { ChatConversationResponse, ChatMessage, ChatSyncResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { DEV_BYPASS } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { activityKey, conversationKey, inboxKey, teamsKey } from "./useChat";
import { sharedChatTransport, type ChatTransport } from "./transport";

/**
 * What a realtime signal MEANS for the page (OFFICE-CHAT-PLAN CH3b). `transport.ts` hears; this file
 * decides, and touches only the query cache and the API.
 *
 *   my topic moved             → refetch the inbox (the list and the sidebar badge are one query)
 *   the open conversation moved → `/api/chat/:id/sync?since_rev=<held rev>` and merge the answer into
 *                                 the cached page, so a new line costs one small request, not a reload
 *   a channel came back        → both of the above once, for whatever was said while it was away
 *
 * Each of those waits a random 0–1 s first (`spread`, Q-CHAT14), so a message to a big channel does
 * not reach the API as one burst from every tab at once.
 *
 * The merge refuses to guess. Every message holds its place (`seq`, retracted ones included, 0511), so
 * the cached page must stay gapless: if the merged lines are not consecutive — a signal arrived for a
 * page this tab never held, or a sync came back short — the page is refetched instead (D-CHAT5).
 */

/** At most this many `more` pages per sync; past it the page is simply refetched. */
const SYNC_PAGES = 10;

/**
 * Merge a sync answer into the cached conversation. Null when the result would have a hole in it, which
 * the caller answers with a refetch. Monotonic: a change never replaces a newer copy of its message, so
 * an answer that lands after a refetch already brought more cannot move the page backwards.
 */
export function applySync(
  cached: ChatConversationResponse,
  sync: ChatSyncResponse,
  viewerId: string | null,
): ChatConversationResponse | null {
  // The first position this page holds. An empty page at the start of the conversation holds from 1.
  const first = cached.messages[0]?.seq ?? (cached.before_seq === null ? 1 : null);
  if (first === null) return null;

  const byId = new Map(cached.messages.map((m) => [m.id, m]));
  for (const change of sync.changes) {
    const held = byId.get(change.id);
    if (held) {
      if (change.rev > held.rev) byId.set(change.id, change);
    } else if (change.seq >= first) {
      byId.set(change.id, change);
    }
    // A change to a line above this page (an old message edited) is not this page's business; the
    // history fetch shows it when somebody scrolls there.
  }
  const messages = [...byId.values()].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.seq !== first + i) return null;
  }

  const last: ChatMessage | undefined = messages[messages.length - 1];
  const c = cached.conversation;
  const lastSeq = Math.max(c.last_seq, last?.seq ?? 0);
  // Sending is reading (0511 `chat_ledger_messages`): the database moves the author's boundary to their
  // own message, so this tab's own new line is never unread — and asking to mark it read would be a
  // wasted request per send.
  const mine = messages.filter((m) => viewerId !== null && m.sender_user_id === viewerId).at(-1)?.seq ?? 0;
  const readSeq = Math.max(c.read_seq, mine);
  const newer = last !== undefined && last.seq >= (c.last_message?.seq ?? 0);
  return {
    ...cached,
    messages,
    conversation: {
      ...c,
      rev: Math.max(c.rev, sync.rev),
      last_seq: lastSeq,
      // The database's own rule (0512 `chat_inbox`): unread is last_seq − read_seq.
      read_seq: readSeq,
      unread: Math.max(lastSeq - readSeq, 0),
      last_message_at: newer ? last.created_at : c.last_message_at,
      last_message: newer
        ? {
            id: last.id,
            seq: last.seq,
            sender_user_id: last.sender_user_id,
            sender_name: last.sender_name,
            body: last.body,
            created_at: last.created_at,
            deleted: last.deleted_at !== null,
          }
        : c.last_message,
    },
  };
}

// One sync per conversation at a time. A signal during a sync asks for one more round after it,
// rather than a second request racing the first for the same rev.
const inflight = new Map<string, { again: boolean }>();

/** Bring the cached conversation up to date; no-op when this tab does not hold it. */
export async function syncConversation(
  qc: QueryClient,
  threadId: string,
  viewerId: string | null,
  signalRev?: number,
): Promise<void> {
  const key = conversationKey(threadId);
  const held = qc.getQueryData<ChatConversationResponse>(key);
  if (!held || (signalRev !== undefined && held.conversation.rev >= signalRev)) return;
  const busy = inflight.get(threadId);
  if (busy) {
    busy.again = true;
    return;
  }
  const run = { again: false };
  inflight.set(threadId, run);
  try {
    do {
      run.again = false;
      if (!(await syncPages(qc, threadId, viewerId))) await qc.invalidateQueries({ queryKey: key });
    } while (run.again);
  } finally {
    inflight.delete(threadId);
  }
}

/**
 * What a conversation's signal fetches. A conversation page is synced and merged. An open CHANNEL
 * holds no conversation page — its posts and replies sit under the conversation's key
 * (`useChatTeams.ts`) — so there is nothing for `/sync` to merge into, and what it holds is refetched:
 * one page of posts, or of one post's replies. Neither held: nothing to do.
 */
export async function refreshConversation(
  qc: QueryClient, threadId: string, viewerId: string | null, signalRev?: number,
): Promise<void> {
  if (qc.getQueryData(conversationKey(threadId)) !== undefined) return syncConversation(qc, threadId, viewerId, signalRev);
  await qc.invalidateQueries({ queryKey: conversationKey(threadId) });
}

/** True when the cache is now current; false when only a refetch can make it so. */
async function syncPages(qc: QueryClient, threadId: string, viewerId: string | null): Promise<boolean> {
  const key = conversationKey(threadId);
  for (let page = 0; page < SYNC_PAGES; page++) {
    const cached = qc.getQueryData<ChatConversationResponse>(key);
    if (!cached) return true; // closed meanwhile; its next open fetches it whole
    const res = await apiFetch<ChatSyncResponse>(`/api/chat/${threadId}/sync?since_rev=${cached.conversation.rev}`);
    if (!res.ok || !res.data) return false;
    // Merge into what the cache holds NOW — a poll may have landed during the request.
    const current = qc.getQueryData<ChatConversationResponse>(key);
    if (!current) return true;
    const next = applySync(current, res.data, viewerId);
    if (!next) return false;
    qc.setQueryData(key, next);
    if (!res.data.more) return true;
  }
  return false;
}

/**
 * The longest a tab waits, at random, before it fetches what a signal announced (Q-CHAT14, ruled
 * 2026-10-23). One message to a 300-member channel wakes 300 tabs in the same instant, and the uat
 * load test measured what that does to the API: 40 syncs at once took 6 s at the median. Spread over
 * a second, the same 300 arrive at about 300/s instead of all together. The second costs little: the
 * message is already a few hundred milliseconds old by the time its signal lands.
 */
export const SIGNAL_SPREAD_MS = 1_000;

// One waiting fetch per target. A second signal for a target that is already waiting joins it: the
// fetch it schedules reads everything up to that moment anyway.
const waiting = new Set<string>();

/** Run `fetch` after a random 0–SIGNAL_SPREAD_MS, unless a fetch for `target` is already waiting. */
export function spread(target: string, fetch: () => void, random: () => number = Math.random): void {
  if (waiting.has(target)) return;
  waiting.add(target);
  setTimeout(() => {
    waiting.delete(target);
    fetch();
  }, Math.floor(random() * SIGNAL_SPREAD_MS));
}

function transportFor(qc: QueryClient): ChatTransport {
  const session = useSessionStore();
  const me = () => session.userId ?? null;
  // The rail with the inbox: a channel's unread is the same `last_seq − read_seq` (CH5c).
  const inbox = () =>
    spread("inbox", () => {
      void qc.invalidateQueries({ queryKey: inboxKey });
      void qc.invalidateQueries({ queryKey: teamsKey });
      // A line that names you or answers your post arrives on the same signal (D-CHAT25).
      void qc.invalidateQueries({ queryKey: activityKey });
    });
  const conversation = (threadId: string, rev?: number) =>
    spread(`conv:${threadId}`, () => void refreshConversation(qc, threadId, me(), rev));
  return sharedChatTransport(() => ({
    onUserSignal: inbox,
    onConversationSignal: (s) => {
      // Already holding this rev — this tab's own send, or a poll that got there first — is nothing to
      // fetch; skip the wait as well as the request.
      const held = qc.getQueryData<ChatConversationResponse>(conversationKey(s.thread_id));
      if (held && held.conversation.rev >= s.rev) return;
      conversation(s.thread_id, s.rev);
    },
    // After a reconnect every tab of the office comes back at once: the same burst, the same spread.
    onResume: (openThreadId) => {
      inbox();
      if (openThreadId) conversation(openThreadId);
    },
  }));
}

/**
 * The tab's realtime link, held for as long as the signed-in shell is mounted and chat is open to the
 * caller — the badge is live on every page, not only on /chat. Dev-bypass has no real Supabase, so it
 * stays on the poll.
 */
export function useChatRealtime(enabled: Ref<boolean>) {
  const session = useSessionStore();
  const transport = transportFor(useQueryClient());
  watch(
    () => (enabled.value && !DEV_BYPASS ? session.userId : null),
    (userId) => (userId ? void transport.start(userId) : transport.stop()),
    { immediate: true },
  );
  onScopeDispose(() => transport.stop());
}

/** Follow the conversation the page has open, and let it go when the page does. */
export function useChatFollow(threadId: Ref<string | null>) {
  const transport = transportFor(useQueryClient());
  watch(threadId, (id) => transport.openConversation(id), { immediate: true });
  onScopeDispose(() => transport.openConversation(null));
}
