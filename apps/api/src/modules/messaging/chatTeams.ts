import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_PAGE_SIZE,
  chatPostSchema,
  chatTeamDirectoryEntrySchema,
  chatTeamMemberSchema,
  chatTeamSchema,
  type ChatCreateChannelRequest,
  type ChatCreateTeamRequest,
  type ChatPostPage,
  type ChatSendResponse,
  type ChatSpaceRole,
  type ChatTeam,
  type ChatTeamDirectoryEntry,
  type ChatTeamMember,
  type ChatUpdateTeamRequest,
} from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * Office chat teams, channels and replies (OFFICE-CHAT-PLAN.md CH5b) — every call is one 0519/0520
 * function, on `chat.ts`'s rule: the database decides, this file translates.
 *
 * `manager` is the caller's answer to the `chat.teams` permission (D-CHAT17, D-CHAT21), asked by the
 * route with `holdsSurface` and handed to the function as `p_manager`. It lets the holder manage any
 * team of the organisation — its name, its people, its archive — and never read one (0520). Nothing
 * here decides with it; the functions do.
 *
 * Every function filters on the org it is given (the caller's, from the verified token) and is
 * service-role only, so each call is org-scoped by construction.
 */

const pageLimit = (limit?: number) => Math.min(Math.max(limit ?? CHAT_PAGE_SIZE, 1), 100);

/** Posts and replies come newest first; a page renders oldest first, as conversation history does. */
function postPage(rows: unknown[], limit: number): ChatPostPage {
  const posts = rows.map((r) => chatPostSchema.parse(r)).reverse();
  const first = posts[0];
  return { posts, before_seq: rows.length === limit && first && first.seq > 1 ? first.seq : null };
}

// ── teams ─────────────────────────────────────────────────────────────────────────────────────────

/** Your Teams rail: the live teams you are in, each with the channels you can see. */
export async function chatTeams(admin: SupabaseClient, orgId: string, userId: string): Promise<ChatTeam[]> {
  const res = await rpc<unknown[]>(admin, "chat_teams", { p_org: orgId, p_user: userId });
  if (!res.ok) throw new Error(res.message); // the rail raises nothing: a refusal here is a fault
  return (res.value ?? []).map((r) => chatTeamSchema.parse(r));
}

/** Every team of the organisation, for Settings → Chat teams. The function refuses a non-holder (CH008). */
export async function chatTeamDirectory(
  admin: SupabaseClient, orgId: string, userId: string, manager: boolean,
): Promise<ChatResult<ChatTeamDirectoryEntry[]>> {
  const res = await rpc<unknown[]>(admin, "chat_team_directory", { p_org: orgId, p_actor: userId, p_manager: manager });
  return res.ok ? { ok: true, value: (res.value ?? []).map((r) => chatTeamDirectoryEntrySchema.parse(r)) } : res;
}

export async function chatTeamCreate(
  admin: SupabaseClient, orgId: string, userId: string, input: ChatCreateTeamRequest,
): Promise<ChatResult<string>> {
  return rpc<string>(admin, "chat_team_create", {
    p_org: orgId, p_actor: userId, p_space_id: input.space_id, p_general_id: input.general_id,
    p_name: input.name, p_description: input.description ?? null, p_members: input.member_ids,
  });
}

export async function chatTeamUpdate(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, input: ChatUpdateTeamRequest, manager: boolean,
): Promise<ChatResult<null>> {
  // Null leaves a field as it is (0519); an empty description clears it.
  return rpc<null>(admin, "chat_team_update", {
    p_org: orgId, p_actor: userId, p_space: spaceId,
    p_name: input.name ?? null, p_description: input.description ?? null, p_manager: manager,
  });
}

export async function chatTeamArchive(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_team_archive", { p_org: orgId, p_actor: userId, p_space: spaceId, p_manager: manager });
}

export async function chatTeamMembers(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, manager: boolean,
): Promise<ChatResult<ChatTeamMember[]>> {
  const res = await rpc<unknown[]>(admin, "chat_team_members", { p_org: orgId, p_user: userId, p_space: spaceId, p_manager: manager });
  return res.ok ? { ok: true, value: (res.value ?? []).map((r) => chatTeamMemberSchema.parse(r)) } : res;
}

export async function chatTeamAddMembers(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, userIds: string[], manager: boolean,
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_team_add_members", {
    p_org: orgId, p_actor: userId, p_space: spaceId, p_members: userIds, p_manager: manager,
  });
}

/** Leave (target = null) or take somebody out. Either way they leave every channel of the team. */
export async function chatTeamRemove(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, targetUserId: string | null, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_team_remove", {
    p_org: orgId, p_actor: userId, p_space: spaceId, p_user: targetUserId, p_manager: manager,
  });
}

export async function chatTeamSetRole(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, targetUserId: string, role: ChatSpaceRole, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_team_set_role", {
    p_org: orgId, p_actor: userId, p_space: spaceId, p_user: targetUserId, p_role: role, p_manager: manager,
  });
}

// ── channels ──────────────────────────────────────────────────────────────────────────────────────

export async function chatChannelCreate(
  admin: SupabaseClient, orgId: string, userId: string, spaceId: string, input: ChatCreateChannelRequest,
): Promise<ChatResult<string>> {
  return rpc<string>(admin, "chat_channel_create", {
    p_org: orgId, p_actor: userId, p_space: spaceId, p_thread_id: input.thread_id, p_name: input.name,
    p_visibility: input.visibility, p_members: input.visibility === "private" ? input.member_ids : null,
  });
}

export async function chatChannelJoin(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_channel_join", { p_org: orgId, p_actor: userId, p_thread: threadId });
}

export async function chatChannelAddMembers(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, userIds: string[],
): Promise<ChatResult<number>> {
  return rpc<number>(admin, "chat_channel_add_members", { p_org: orgId, p_actor: userId, p_thread: threadId, p_members: userIds });
}

/** Leave (target = null) or take somebody out. Never General: that is leaving the team. */
export async function chatChannelLeave(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, targetUserId: string | null, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_channel_leave", {
    p_org: orgId, p_actor: userId, p_thread: threadId, p_user: targetUserId, p_manager: manager,
  });
}

export async function chatChannelRename(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, name: string, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_channel_rename", { p_org: orgId, p_actor: userId, p_thread: threadId, p_name: name, p_manager: manager });
}

export async function chatChannelArchive(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, manager: boolean,
): Promise<ChatResult<null>> {
  return rpc<null>(admin, "chat_channel_archive", { p_org: orgId, p_actor: userId, p_thread: threadId, p_manager: manager });
}

// ── posts and replies ─────────────────────────────────────────────────────────────────────────────

/** A channel's top-level posts, each with its reply count and last reply (D-CHAT19). */
export async function chatChannelPosts(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, beforeSeq: number | null, limit?: number,
): Promise<ChatResult<ChatPostPage>> {
  const n = pageLimit(limit);
  const res = await rpc<unknown[]>(admin, "chat_channel_posts", {
    p_org: orgId, p_user: userId, p_thread: threadId, p_before_seq: beforeSeq, p_limit: n,
  });
  return res.ok ? { ok: true, value: postPage(res.value ?? [], n) } : res;
}

/**
 * One post's replies. `chat_replies` finds the post's conversation itself; a post of ANOTHER channel
 * the caller is in would still answer, so a reply page whose rows name a different channel than the
 * path is refused as not found rather than served under the wrong address.
 */
export async function chatReplies(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, postId: string, beforeSeq: number | null, limit?: number,
): Promise<ChatResult<ChatPostPage>> {
  const n = pageLimit(limit);
  const res = await rpc<unknown[]>(admin, "chat_replies", {
    p_org: orgId, p_user: userId, p_parent: postId, p_before_seq: beforeSeq, p_limit: n,
  });
  if (!res.ok) return res;
  const page = postPage(res.value ?? [], n);
  if (page.posts.some((p) => p.thread_id !== threadId)) {
    return { ok: false, status: 404, code: "not_found", message: "That conversation does not exist" };
  }
  return { ok: true, value: page };
}

/** A reply; 0518's trigger refuses one that does not answer a live top-level post of this channel (CH011). */
export async function chatSendReply(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, postId: string, messageId: string, body: string,
): Promise<ChatResult<ChatSendResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_send_reply", {
    p_org: orgId, p_actor: userId, p_thread: threadId, p_message_id: messageId, p_parent: postId, p_body: body,
  });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0] as ChatSendResponse | undefined;
  if (!row) throw new Error("chat_send_reply returned no row");
  return { ok: true, value: row };
}
