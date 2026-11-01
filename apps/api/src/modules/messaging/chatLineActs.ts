import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_PAGE_SIZE,
  chatPinnedLineSchema,
  chatSavedLineSchema,
  type ChatPinnedLine,
  type ChatReaction,
  type ChatSavedResponse,
} from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * What a person does TO a line (OFFICE-CHAT-PLAN CH6c-2, migration 0523): react, pin, save, and the two
 * lists those make — a conversation's pinned lines and the caller's saved ones.
 *
 * Every rule is 0523's, as everything in chat.ts is the database's: that the caller is in the line's
 * conversation now (CH001), that it is office chat's and not a driver thread (CH006), that a retracted
 * line takes nothing new (CH004) and an archived conversation takes no reaction or pin (CH005). Each
 * call passes the org and user from the verified token, and each function filters on that org, so a
 * call is org-scoped by construction.
 *
 * Reactions and pins are seen by everybody in the conversation, so 0523's triggers ledger them and move
 * the line's `rev` — the realtime signal and `/sync` re-deliver the line to every open tab with no new
 * transport. A save is one person's bookmark: no ledger row, no `rev`, nobody else ever sees it (D-CHAT24).
 */

/** Add or take back one of your reactions. The answer is the line's `rev` after it. */
export async function chatReact(
  admin: SupabaseClient, orgId: string, userId: string, messageId: string, reaction: ChatReaction, on: boolean,
): Promise<ChatResult<number>> {
  const res = await rpc<number | string>(admin, "chat_react", {
    p_org: orgId, p_actor: userId, p_message: messageId, p_reaction: reaction, p_on: on,
  });
  return res.ok ? { ok: true, value: Number(res.value) } : res;
}

/** Pin or unpin a line — anybody in the conversation may. The answer is the line's `rev` after it. */
export async function chatPin(
  admin: SupabaseClient, orgId: string, userId: string, messageId: string, on: boolean,
): Promise<ChatResult<number>> {
  const res = await rpc<number | string>(admin, "chat_pin", { p_org: orgId, p_actor: userId, p_message: messageId, p_on: on });
  return res.ok ? { ok: true, value: Number(res.value) } : res;
}

/** Save or unsave a line for yourself. */
export async function chatSave(
  admin: SupabaseClient, orgId: string, userId: string, messageId: string, on: boolean,
): Promise<ChatResult<boolean>> {
  return rpc<boolean>(admin, "chat_save", { p_org: orgId, p_user: userId, p_message: messageId, p_on: on });
}

/** A conversation's pinned lines, the latest pin first (0523 caps them at 100). CH001 if not in it. */
export async function chatPins(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatResult<ChatPinnedLine[]>> {
  const res = await rpc<unknown[]>(admin, "chat_pins", { p_org: orgId, p_user: userId, p_thread: threadId });
  return res.ok ? { ok: true, value: (res.value ?? []).map((r) => chatPinnedLineSchema.parse(r)) } : res;
}

/** The caller's saved lines, newest save first, one page; `before_at` + `before_id` page back. */
export async function chatSavedLines(
  admin: SupabaseClient, orgId: string, userId: string,
  page: { before_at?: string | null; before_id?: string | null; limit?: number },
): Promise<ChatSavedResponse> {
  const limit = Math.min(Math.max(page.limit ?? CHAT_PAGE_SIZE, 1), 100);
  const res = await rpc<unknown[]>(admin, "chat_saved", {
    p_org: orgId, p_user: userId, p_before_at: page.before_at ?? null, p_before_id: page.before_id ?? null, p_limit: limit,
  });
  if (!res.ok) throw new Error(res.message); // it raises nothing: a refusal here is a fault
  const items = (res.value ?? []).map((r) => chatSavedLineSchema.parse(r));
  const last = items[items.length - 1];
  return { items, next: items.length === limit && last ? { before_at: last.saved_at, before_id: last.message_id } : null };
}
