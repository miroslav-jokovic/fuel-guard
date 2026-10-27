import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_PAGE_SIZE,
  chatActivityItemSchema,
  type ChatActivityResponse,
  type ChatMuteLevel,
} from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * One person's own chat state (OFFICE-CHAT-PLAN CH6b-2): a conversation's mute, and Activity — the lines
 * that named you and the replies to posts you wrote or answered (D-CHAT25). Each is one call to a 0521
 * function, with the caller's org and user from the token, as everything in chat.ts is. None of it is
 * ledgered (D-CHAT24): a mute or an Activity read is one person's bookmark, like `read_seq`.
 */

export async function chatSetMute(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, level: ChatMuteLevel,
): Promise<ChatResult<ChatMuteLevel>> {
  return rpc<ChatMuteLevel>(admin, "chat_set_mute", { p_org: orgId, p_user: userId, p_thread: threadId, p_level: level });
}

/** The Activity tab's badge alone — what the rail asks on every signal, without a page of rows. */
export async function chatActivityUnread(admin: SupabaseClient, orgId: string, userId: string): Promise<number> {
  const res = await rpc<number | string>(admin, "chat_activity_unread", { p_org: orgId, p_user: userId });
  if (!res.ok) throw new Error(res.message); // it raises nothing: a refusal here is a fault
  // A bigint may arrive as a string; the badge is never anywhere near 2^53.
  return Number(res.value ?? 0);
}

/** Activity, newest first, one page, with the badge; `before_at` + `before_id` page back. */
export async function chatActivity(
  admin: SupabaseClient, orgId: string, userId: string,
  page: { before_at?: string | null; before_id?: string | null; limit?: number },
): Promise<ChatActivityResponse> {
  const limit = Math.min(Math.max(page.limit ?? CHAT_PAGE_SIZE, 1), 100);
  const [res, unread] = await Promise.all([
    rpc<unknown[]>(admin, "chat_activity", {
      p_org: orgId, p_user: userId, p_before_at: page.before_at ?? null, p_before_id: page.before_id ?? null, p_limit: limit,
    }),
    chatActivityUnread(admin, orgId, userId),
  ]);
  if (!res.ok) throw new Error(res.message);
  const items = (res.value ?? []).map((r) => chatActivityItemSchema.parse(r));
  const last = items[items.length - 1];
  return {
    items,
    next: items.length === limit && last ? { before_at: last.at, before_id: last.message_id } : null,
    unread,
  };
}

/** Move the caller's Activity read instant to `at` (omitted = now); never back, never past now. */
export async function chatActivityMarkRead(
  admin: SupabaseClient, orgId: string, userId: string, at: string | undefined,
): Promise<string> {
  const res = await rpc<string>(admin, "chat_activity_mark_read", { p_org: orgId, p_user: userId, p_at: at ?? null });
  if (!res.ok) throw new Error(res.message);
  return res.value;
}
