import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatAboutConversationSchema,
  chatThreadAboutSchema,
  type ChatAboutKind,
  type ChatAboutListResponse,
  type ChatCreateAboutRequest,
  type ChatThreadAboutResponse,
} from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * "Chat about this" (OFFICE-CHAT-PLAN CH11b, §9.4): one call each to 0543's functions, with the caller's
 * org and user from the token, as everything in chat.ts is. The database decides the organisation (CH016)
 * and the membership (CH001, and `chat_about` lists only the caller's own); whether the caller may read
 * the RECORD is the route's, before any of these is asked (`CHAT_ABOUT_READ_SECTION`, D-CHAT33).
 */
export async function chatCreateAbout(
  admin: SupabaseClient, orgId: string, userId: string, req: ChatCreateAboutRequest,
): Promise<ChatResult<string>> {
  return rpc<string>(admin, "chat_create_about", {
    p_org: orgId, p_actor: userId, p_thread_id: req.thread_id, p_subject: req.subject ?? null,
    p_members: req.member_ids, p_kind: req.kind, p_record: req.record_id,
  });
}

export async function chatAboutList(
  admin: SupabaseClient, orgId: string, userId: string, kind: ChatAboutKind, recordId: string,
): Promise<ChatResult<ChatAboutListResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_about", { p_org: orgId, p_user: userId, p_kind: kind, p_record: recordId });
  if (!res.ok) return res;
  return { ok: true, value: { conversations: (res.value ?? []).map((r) => chatAboutConversationSchema.parse(r)) } };
}

export async function chatThreadAbout(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatResult<ChatThreadAboutResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_thread_about", { p_org: orgId, p_user: userId, p_thread: threadId });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0];
  return { ok: true, value: { about: row ? chatThreadAboutSchema.parse(row) : null } };
}
