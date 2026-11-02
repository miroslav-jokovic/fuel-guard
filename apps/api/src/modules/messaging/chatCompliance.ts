import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatComplianceAccessRowSchema,
  chatComplianceConversationSchema,
  chatComplianceMessageSchema,
  chatCompliancePersonSchema,
  isRosterIssuedRole,
  type ChatComplianceAccessLogResponse,
  type ChatComplianceFileLink,
  type ChatComplianceFileRequest,
  type ChatComplianceConversationsRequest,
  type ChatComplianceConversationsResponse,
  type ChatComplianceMessagesRequest,
  type ChatComplianceMessagesResponse,
  type ChatCompliancePerson,
  type ChatComplianceThreadRequest,
  type ChatComplianceThreadResponse,
} from "@silvicom/shared";
import { chatComplianceThreadResponseSchema } from "@silvicom/shared";
import { CHAT_FILES_BUCKET } from "./chatFiles.js";

/**
 * The compliance console's reads (OFFICE-CHAT-PLAN CHA2, D-CHAT14) — each one a call to a 0516
 * function that appends the act to the org's chat ledger before it returns a word. This file shapes
 * the rows and maps the two refusals; it holds no rule of its own, for the reason `chat.ts` gives:
 * a second copy of the rule is the copy that drifts.
 *
 * Every function takes the caller's org and user from the verified token. The route has already
 * asked `requireSurface("chat.compliance")` and `requireFreshAuth()`; the reason has already been
 * validated by the contract, and the database validates it again (CH009), so a ledger row can never
 * carry an empty one.
 */

const CHAT_COMPLIANCE_ERRORS: Record<string, { status: 404 | 422; code: string; message: string }> = {
  CH001: { status: 404, code: "not_found", message: "That conversation does not exist" },
  CH009: { status: 422, code: "reason_required", message: "Give the reason for looking: a category and a sentence" },
};

export type ChatComplianceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 | 422; code: string; message: string };

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ChatComplianceResult<T>> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    const known = (error as { code?: string }).code ? CHAT_COMPLIANCE_ERRORS[(error as { code: string }).code] : undefined;
    if (known) return { ok: false, ...known, message: error.message || known.message };
    throw new Error(error.message);
  }
  return { ok: true, value: data as T };
}

const limitOf = (n: number | undefined) => Math.min(Math.max(n ?? 50, 1), 100);

/** Everyone the console may filter by — the whole org, driver logins and suspended people included. */
export async function chatCompliancePeople(admin: SupabaseClient, orgId: string): Promise<ChatCompliancePerson[]> {
  const { data, error } = await admin.rpc("org_member_directory", { p_org_id: orgId });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null; role: string; suspended_at?: string | null }>;
  return rows
    .map((r) =>
      chatCompliancePersonSchema.parse({
        user_id: r.user_id,
        // The roster's name is in `full_name` for a driver login too (0301); a person with neither
        // gets the address's local part, as `chat_display_name` does.
        name: r.full_name ?? (r.email ? r.email.split("@")[0] : null),
        role: r.role,
        suspended: !!r.suspended_at,
      }),
    )
    .sort((a, b) => Number(isRosterIssuedRole(a.role)) - Number(isRosterIssuedRole(b.role)) || (a.name ?? "").localeCompare(b.name ?? ""));
}

export async function chatComplianceConversations(
  admin: SupabaseClient, orgId: string, userId: string, req: ChatComplianceConversationsRequest,
): Promise<ChatComplianceResult<ChatComplianceConversationsResponse>> {
  const limit = limitOf(req.limit);
  const res = await rpc<unknown[]>(admin, "chat_compliance_conversations", {
    p_org: orgId, p_actor: userId, p_reason: req.reason,
    p_person: req.person ?? null, p_from: req.from ?? null, p_to: req.to ?? null,
    p_before_at: req.before_at ?? null, p_before_id: req.before_id ?? null, p_limit: limit,
  });
  if (!res.ok) return res;
  const conversations = (res.value ?? []).map((r) => chatComplianceConversationSchema.parse(r));
  const last = conversations[conversations.length - 1];
  return {
    ok: true,
    value: {
      conversations,
      next: conversations.length === limit && last ? { before_at: last.last_message_at, before_id: last.thread_id } : null,
    },
  };
}

export async function chatComplianceMessages(
  admin: SupabaseClient, orgId: string, userId: string, req: ChatComplianceMessagesRequest,
): Promise<ChatComplianceResult<ChatComplianceMessagesResponse>> {
  const limit = limitOf(req.limit);
  const res = await rpc<unknown[]>(admin, "chat_compliance_messages", {
    p_org: orgId, p_actor: userId, p_reason: req.reason,
    p_thread: req.thread ?? null, p_person: req.person ?? null, p_from: req.from ?? null, p_to: req.to ?? null,
    p_q: req.q?.trim() || null, p_before_at: req.before_at ?? null, p_before_id: req.before_id ?? null, p_limit: limit,
  });
  if (!res.ok) return res;
  const messages = (res.value ?? []).map((r) => chatComplianceMessageSchema.parse(r));
  const last = messages[messages.length - 1];
  return {
    ok: true,
    value: {
      messages,
      next: messages.length === limit && last ? { before_at: last.created_at, before_id: last.id } : null,
    },
  };
}

export async function chatComplianceThread(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, req: ChatComplianceThreadRequest,
): Promise<ChatComplianceResult<ChatComplianceThreadResponse>> {
  const limit = limitOf(req.limit);
  const res = await rpc<unknown[]>(admin, "chat_compliance_thread", {
    p_org: orgId, p_actor: userId, p_reason: req.reason, p_thread: threadId,
    p_before_seq: req.before_seq ?? null, p_limit: limit,
  });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0] as { conversation: unknown; messages: unknown[] } | undefined;
  if (!row) return { ok: false, ...CHAT_COMPLIANCE_ERRORS.CH001! };
  // Newest first from the database; oldest first for reading, like the chat page.
  const messages = [...row.messages].reverse();
  const first = messages[0] as { seq?: number } | undefined;
  return {
    ok: true,
    value: chatComplianceThreadResponseSchema.parse({
      conversation: row.conversation,
      messages,
      before_seq: row.messages.length === limit && first && (first.seq ?? 0) > 1 ? first.seq : null,
    }),
  };
}

export async function chatComplianceAccessLog(
  admin: SupabaseClient, orgId: string, beforeSeq: number | null, limit?: number,
): Promise<ChatComplianceAccessLogResponse> {
  const n = limitOf(limit);
  const res = await rpc<unknown[]>(admin, "chat_compliance_access_log", { p_org: orgId, p_before_seq: beforeSeq, p_limit: n });
  if (!res.ok) throw new Error(res.message); // the log raises nothing: a refusal here is a fault
  const rows = (res.value ?? []).map((r) => chatComplianceAccessRowSchema.parse(r));
  const last = rows[rows.length - 1];
  return { rows, before_seq: rows.length === n && last && last.seq > 1 ? last.seq : null };
}

/** How long a reviewer's link to one file lives — the same five minutes as a chat member's (CH7). */
export const COMPLIANCE_FILE_LINK_SECONDS = 300;

/**
 * One file for review (0544 `chat_compliance_file`): the database ledgers a `compliance_view` naming the
 * file, its hash and the reason, then answers its key, which is signed here for five minutes as a
 * DOWNLOAD under its own name — evidence is saved, never drawn on our page. Another organisation's file
 * is the database's CH001.
 */
export async function chatComplianceFileLink(
  admin: SupabaseClient, orgId: string, userId: string, fileId: string, req: ChatComplianceFileRequest,
): Promise<ChatComplianceResult<ChatComplianceFileLink>> {
  const res = await rpc<Array<{ storage_path: string; file_name: string }>>(admin, "chat_compliance_file", {
    p_org: orgId, p_actor: userId, p_reason: req.reason, p_file: fileId,
  });
  if (!res.ok) return res.code === "not_found" ? { ...res, message: "That file does not exist" } : res;
  const f = (res.value ?? [])[0];
  if (!f) throw new Error("chat_compliance_file returned no row");
  const { data, error } = await admin.storage.from(CHAT_FILES_BUCKET)
    .createSignedUrl(f.storage_path, COMPLIANCE_FILE_LINK_SECONDS, { download: f.file_name });
  if (error || !data) throw new Error(`chat-files link: ${error?.message ?? "no URL"}`);
  return { ok: true, value: { url: data.signedUrl, file_name: f.file_name, expires_in: COMPLIANCE_FILE_LINK_SECONDS } };
}
