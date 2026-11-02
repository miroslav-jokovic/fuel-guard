import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_SEARCH_PAGE, chatSearchLineSchema, type ChatSearchResponse } from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * Office chat search (OFFICE-CHAT-PLAN CH8): one call to 0542 `chat_search` with the caller's org and
 * user from the token, as everything in chat.ts is. What a person may find — conversations they are in
 * now, never a driver conversation or a retracted line — and how words match are the database's; a
 * conversation they are not in is its CH001, which `rpc` maps to 404 like every other chat read. Not
 * ledgered: reading your own conversations is not a compliance act (the console's search, 0516, is).
 */
export async function chatSearch(
  admin: SupabaseClient, orgId: string, userId: string,
  query: { q: string; thread: string | null; before_at: string | null; before_id: string | null; limit?: number },
): Promise<ChatResult<ChatSearchResponse>> {
  const limit = Math.min(Math.max(query.limit ?? CHAT_SEARCH_PAGE, 1), 50);
  const res = await rpc<unknown[]>(admin, "chat_search", {
    p_org: orgId, p_user: userId, p_q: query.q, p_thread: query.thread,
    p_before_at: query.before_at, p_before_id: query.before_id, p_limit: limit,
  });
  if (!res.ok) return res;
  const items = (res.value ?? []).map((r) => chatSearchLineSchema.parse(r));
  const last = items[items.length - 1];
  return { ok: true, value: { items, next: items.length === limit && last ? { before_at: last.created_at, before_id: last.id } : null } };
}
