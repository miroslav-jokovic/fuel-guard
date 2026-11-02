import type { SupabaseClient } from "@supabase/supabase-js";
import { chatLineLinkSchema, type ChatLineLinksResponse } from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * Load and truck numbers in chat lines, as links (CHAT-REDESIGN-PLAN Q-CHATUI6 (a)): one call to 0547
 * `chat_line_links` with the caller's org and user from the token. Which words name a record, and which
 * lines the caller may read, are the database's; a line they may not read simply yields nothing.
 */
export async function chatLineLinks(
  admin: SupabaseClient, orgId: string, userId: string, messageIds: string[],
): Promise<ChatResult<ChatLineLinksResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_line_links", { p_org: orgId, p_user: userId, p_messages: messageIds });
  if (!res.ok) return res;
  return { ok: true, value: { links: (res.value ?? []).map((r) => chatLineLinkSchema.parse(r)) } };
}
