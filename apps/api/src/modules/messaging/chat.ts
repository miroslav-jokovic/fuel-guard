import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_KINDS,
  CHAT_PAGE_SIZE,
  chatConversationSchema,
  chatDirectoryEntrySchema,
  chatMemberSchema,
  chatMessageSchema,
  type ChatConversation,
  type ChatConversationResponse,
  type ChatDirectoryEntry,
  type ChatHistoryResponse,
  type ChatInboxResponse,
  type ChatKind,
  type ChatMember,
  type ChatMessage,
  type ChatSendResponse,
  type ChatSyncResponse,
} from "@silvicom/shared";

/**
 * Office chat (OFFICE-CHAT-PLAN.md CH1b) — every read and write is one call to a 0512 function.
 *
 * THE RULE THIS FILE KEEPS: the database decides. Who may be in a conversation (D-CHAT4), whether the
 * caller is in it, whether a message is theirs to edit, what unread is (D-CHAT5) — each is checked in
 * the function that writes or reads the rows, inside one transaction, and arrives here as a SQLSTATE.
 * This file translates those into HTTP and shapes the rows. It never re-checks membership in
 * JavaScript, because a second copy of the rule is the copy that drifts.
 *
 * Every function is called with the caller's org and user ids from the verified token. They are
 * service-role only (0512 revokes them from the browser), and each one filters on the org it is given,
 * so a call is org-scoped by construction rather than by remembering an `.eq("org_id")`.
 *
 * The ledger is written by 0511's triggers; nothing here writes it, so nothing here can forget to.
 */

/** The SQLSTATEs 0512, 0518–0521 raise, and the answer each becomes. */
const CHAT_ERRORS: Record<string, { status: 403 | 404 | 409 | 422; code: string; message: string }> = {
  // 404, not 403: a conversation you are not in is one we do not confirm exists.
  CH001: { status: 404, code: "not_found", message: "That conversation does not exist" },
  CH002: { status: 422, code: "not_an_office_member", message: "That person cannot be added to an office conversation" },
  CH003: { status: 409, code: "message_immutable", message: "That message cannot be changed that way" },
  CH004: { status: 409, code: "message_retracted", message: "That message was removed" },
  CH005: { status: 409, code: "conversation_archived", message: "That conversation is archived" },
  CH006: { status: 422, code: "not_allowed_here", message: "That is not possible in this conversation" },
  CH007: { status: 409, code: "id_in_use", message: "That id already belongs to something else" },
  CH008: { status: 403, code: "owner_only", message: "Only an owner of the conversation can do that" },
  // 0518/0519 (CH5a): a reply must answer a live top-level post of the same channel; names are unique
  // among a team's live channels and an org's live teams.
  CH011: { status: 422, code: "reply_not_allowed", message: "That reply cannot go there" },
  CH012: { status: 409, code: "name_in_use", message: "That name is already in use" },
  // 0521 (CH6b-1, Q-CHAT20): a `<@id>` token must name somebody in the conversation now.
  CH013: { status: 422, code: "mention_not_in_conversation", message: "That person is not in this conversation. Add them first" },
};

export type ChatResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403 | 404 | 409 | 422; code: string; message: string };

interface RpcError { code?: string; message: string }

/** A known refusal becomes an answer; anything else is a fault and throws. */
function refusal<T>(error: RpcError): ChatResult<T> {
  const known = error.code ? CHAT_ERRORS[error.code] : undefined;
  if (known) {
    // The database's sentence is more specific than the generic one (e.g. "a group holds at most 250
    // people"), and it never carries data: 0512's messages are fixed strings.
    return { ok: false, ...known, message: error.message || known.message };
  }
  throw new Error(error.message);
}

/** One chat function call; `chatTeams.ts` calls its functions through this too, so one map answers both. */
export async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ChatResult<T>> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) return refusal<T>(error as RpcError);
  return { ok: true, value: data as T };
}

const OFFICE_KINDS: readonly ChatKind[] = CHAT_KINDS;

/**
 * The inbox, newest first, one page. `kinds` narrows it: the /chat page's Chats list asks for direct
 * and group conversations, because channels are listed by their team on the Teams rail (CH5c); the
 * sidebar badge asks for every kind, so an unread channel counts in it like any conversation (D-CHAT2).
 */
export async function chatInbox(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  page: { before_at?: string | null; before_id?: string | null; limit?: number; kinds?: readonly ChatKind[] },
): Promise<ChatInboxResponse> {
  const limit = Math.min(Math.max(page.limit ?? CHAT_PAGE_SIZE, 1), 100);
  const res = await rpc<unknown[]>(admin, "chat_inbox", {
    p_org: orgId, p_user: userId, p_kinds: page.kinds?.length ? page.kinds : OFFICE_KINDS,
    p_before_at: page.before_at ?? null, p_before_id: page.before_id ?? null, p_limit: limit,
  });
  if (!res.ok) throw new Error(res.message); // the inbox raises nothing: a refusal here is a fault
  const conversations = (res.value ?? []).map((r) => chatConversationSchema.parse(r));
  const last = conversations[conversations.length - 1];
  return {
    conversations,
    next: conversations.length === limit && last ? { before_at: last.last_message_at, before_id: last.thread_id } : null,
    // The badge counts this page only; an older page with unread is reached by scrolling, and the
    // inbox's order puts recent activity first, which is where unread lives.
    unread_total: conversations.reduce((n, c) => n + (c.muted === "all" ? 0 : c.unread), 0),
  };
}

export async function chatDirectory(admin: SupabaseClient, orgId: string): Promise<ChatDirectoryEntry[]> {
  const res = await rpc<unknown[]>(admin, "chat_people", { p_org: orgId });
  if (!res.ok) throw new Error(res.message);
  return (res.value ?? []).map((r) => chatDirectoryEntrySchema.parse(r));
}

/** One conversation's inbox row, as `userId` sees it; null when they are not in it. */
export async function conversationRow(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatConversation | null> {
  const res = await rpc<unknown[]>(admin, "chat_inbox", {
    p_org: orgId, p_user: userId, p_kinds: OFFICE_KINDS,
    p_before_at: null, p_before_id: null, p_limit: 1, p_thread: threadId,
  });
  if (!res.ok) throw new Error(res.message);
  const row = (res.value ?? [])[0];
  return row ? chatConversationSchema.parse(row) : null;
}

const NOT_FOUND = { ok: false as const, ...CHAT_ERRORS.CH001! };

/** History comes newest first from the database; the client renders oldest first. */
function page(rows: unknown[], limit: number): ChatHistoryResponse {
  const messages = rows.map((r) => chatMessageSchema.parse(r)).reverse();
  const first = messages[0];
  return { messages, before_seq: rows.length === limit && first && first.seq > 1 ? first.seq : null };
}

/** Open a conversation: its header, its members and its newest page. */
export async function chatOpen(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatResult<ChatConversationResponse>> {
  const conversation = await conversationRow(admin, orgId, userId, threadId);
  if (!conversation) return NOT_FOUND;
  const [members, history] = await Promise.all([
    rpc<unknown[]>(admin, "chat_members", { p_org: orgId, p_user: userId, p_thread: threadId }),
    rpc<unknown[]>(admin, "chat_history", {
      p_org: orgId, p_user: userId, p_thread: threadId, p_before_seq: null, p_limit: CHAT_PAGE_SIZE,
    }),
  ]);
  if (!members.ok) return members;
  if (!history.ok) return history;
  return {
    ok: true,
    value: {
      conversation,
      members: (members.value ?? []).map((r) => chatMemberSchema.parse(r)),
      ...page(history.value ?? [], CHAT_PAGE_SIZE),
    },
  };
}

export async function chatHistory(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, beforeSeq: number | null, limit?: number,
): Promise<ChatResult<ChatHistoryResponse>> {
  const n = Math.min(Math.max(limit ?? CHAT_PAGE_SIZE, 1), 100);
  const res = await rpc<unknown[]>(admin, "chat_history", {
    p_org: orgId, p_user: userId, p_thread: threadId, p_before_seq: beforeSeq, p_limit: n,
  });
  return res.ok ? { ok: true, value: page(res.value ?? [], n) } : res;
}

/**
 * Who is in a conversation, as the caller sees it (CH6b-2): a channel's people, for the composer's `@`
 * list, which a channel's page of posts does not carry. CH001 when the caller is not in it.
 */
export async function chatMembers(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatResult<ChatMember[]>> {
  const res = await rpc<unknown[]>(admin, "chat_members", { p_org: orgId, p_user: userId, p_thread: threadId });
  return res.ok ? { ok: true, value: (res.value ?? []).map((r) => chatMemberSchema.parse(r)) } : res;
}

const SYNC_BATCH = 200;

/** Everything that changed after `sinceRev`: what a client asks after a realtime signal or a reconnect. */
export async function chatSync(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, sinceRev: number,
): Promise<ChatResult<ChatSyncResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_sync", {
    p_org: orgId, p_user: userId, p_thread: threadId, p_since_rev: sinceRev, p_limit: SYNC_BATCH,
  });
  if (!res.ok) return res;
  const changes: ChatMessage[] = (res.value ?? []).map((r) => chatMessageSchema.parse(r));
  return {
    ok: true,
    value: {
      changes,
      rev: changes.reduce((r, m) => Math.max(r, m.rev), sinceRev),
      more: changes.length === SYNC_BATCH,
    },
  };
}

export async function chatOpenDirect(
  admin: SupabaseClient, orgId: string, userId: string, otherUserId: string, threadId: string,
): Promise<ChatResult<string>> {
  return rpc<string>(admin, "chat_open_direct", { p_org: orgId, p_actor: userId, p_other: otherUserId, p_thread_id: threadId });
}

export async function chatCreateGroup(
  admin: SupabaseClient, orgId: string, userId: string,
  input: { thread_id: string; subject?: string | null; member_ids: string[] },
): Promise<ChatResult<string>> {
  return rpc<string>(admin, "chat_create_group", {
    p_org: orgId, p_actor: userId, p_thread_id: input.thread_id, p_subject: input.subject ?? null, p_members: input.member_ids,
  });
}

export async function chatSend(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, messageId: string, body: string,
): Promise<ChatResult<ChatSendResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_send", {
    p_org: orgId, p_actor: userId, p_thread: threadId, p_message_id: messageId, p_body: body,
  });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0] as ChatSendResponse | undefined;
  if (!row) throw new Error("chat_send returned no row");
  return { ok: true, value: row };
}

export async function chatEdit(
  admin: SupabaseClient, orgId: string, userId: string, messageId: string, body: string,
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_edit", { p_org: orgId, p_actor: userId, p_message: messageId, p_body: body });
}

export async function chatRetract(
  admin: SupabaseClient, orgId: string, userId: string, messageId: string,
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_retract", { p_org: orgId, p_actor: userId, p_message: messageId });
}

export async function chatMarkRead(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, seq: number | undefined,
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_mark_read", { p_org: orgId, p_user: userId, p_thread: threadId, p_seq: seq ?? null });
}

export async function chatRename(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, subject: string | null,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_rename", { p_org: orgId, p_actor: userId, p_thread: threadId, p_subject: subject });
}

export async function chatAddMembers(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, userIds: string[],
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_add_members", { p_org: orgId, p_actor: userId, p_thread: threadId, p_members: userIds });
}

/** Leave (target = null or yourself) or, as an owner, remove somebody. */
export async function chatLeave(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, targetUserId: string | null,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_leave", { p_org: orgId, p_actor: userId, p_thread: threadId, p_user: targetUserId });
}
