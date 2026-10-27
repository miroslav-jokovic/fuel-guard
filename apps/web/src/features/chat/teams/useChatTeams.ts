import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ChatPostPage, ChatTeamMember, ChatTeamsResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { genUuid } from "@/lib/uuid";
import { chatLinkState } from "../transport";
import { CHAT_KEY, conversationKey, inboxKey, teamsKey } from "../useChat";
import { keepEarlierSharing, useLoadEarlier } from "../earlierPages";

/**
 * The Teams side of /chat (OFFICE-CHAT-PLAN CH5c): the rail, a channel's posts, a post's replies, and
 * the acts a person in a team takes from the rail. Everything through `/api/chat/teams…` and
 * `/api/chat/channels…` (CH5b), which answer only for teams and channels the caller is in.
 *
 * KEYS: a channel's posts and a post's replies sit UNDER `conversationKey(id)`. A channel is a
 * conversation (D-CHAT18), and the send, edit and remove hooks in `useChat.ts` already refresh that
 * key — so they refresh the channel view too, without knowing it exists.
 *
 * FRESHNESS is D-CHAT2's, as the inbox's: the rail polls every 30 s and an open channel every 10 s,
 * both 60 s while the realtime link is live; `chatRealtime.ts` refetches on a signal.
 */
export const postsKey = (threadId: string | null) => [...conversationKey(threadId), "posts"] as const;
export const repliesKey = (threadId: string | null, postId: string | null) =>
  [...conversationKey(threadId), "replies", postId] as const;

const RELAXED_POLL = 60_000;
const poll = (fallback: number) => () => (chatLinkState.value === "live" ? RELAXED_POLL : fallback);

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

export function useChatTeamsQuery(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: teamsKey,
    enabled,
    queryFn: () => unwrap(apiFetch<ChatTeamsResponse>("/api/chat/teams"), "Could not load your teams."),
    refetchInterval: poll(30_000),
  });
}

export function useChannelPostsQuery(threadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => postsKey(threadId.value)),
    enabled: computed(() => !!threadId.value),
    queryFn: () => unwrap(apiFetch<ChatPostPage>(`/api/chat/channels/${threadId.value}/posts`), "Could not open the channel."),
    refetchInterval: poll(10_000),
     structuralSharing: keepEarlierSharing("posts"),
  });
}

export function useRepliesQuery(threadId: Ref<string | null>, postId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => repliesKey(threadId.value, postId.value)),
    enabled: computed(() => !!threadId.value && !!postId.value),
    queryFn: () =>
      unwrap(apiFetch<ChatPostPage>(`/api/chat/channels/${threadId.value}/posts/${postId.value}/replies`), "Could not load the replies."),
    refetchInterval: poll(10_000),
     structuralSharing: keepEarlierSharing("posts"),
  });
}

/** "Show earlier" for a channel's posts and for a post's replies (CH6a); both routes take `before_seq`. */
export function useEarlierPosts(threadId: Ref<string | null>) {
  return useLoadEarlier(
    "posts",
    () => (threadId.value ? postsKey(threadId.value) : null),
    (before) => (threadId.value ? `/api/chat/channels/${threadId.value}/posts?before_seq=${before}` : null),
  );
}
export function useEarlierReplies(threadId: Ref<string | null>, postId: Ref<string | null>) {
  return useLoadEarlier(
    "posts",
    () => (threadId.value && postId.value ? repliesKey(threadId.value, postId.value) : null),
    (before) =>
      threadId.value && postId.value ? `/api/chat/channels/${threadId.value}/posts/${postId.value}/replies?before_seq=${before}` : null,
  );
}

export function useTeamMembersQuery(spaceId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...CHAT_KEY, "team-members", spaceId.value] as const),
    enabled: computed(() => !!spaceId.value),
    queryFn: async () =>
      (await unwrap(apiFetch<{ members: ChatTeamMember[] }>(`/api/chat/teams/${spaceId.value}/members`), "Could not load the team.")).members,
  });
}

/** Every rail act moves the rail and the inbox (a channel joined or left is a conversation joined or left). */
function useRailMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: teamsKey }), qc.invalidateQueries({ queryKey: inboxKey })]),
  });
}

const post = <T>(path: string, body: object, fallback: string) => unwrap(apiFetch<T>(path, { method: "POST", body }), fallback);

export function useJoinChannel() {
  return useRailMutation((threadId: string) => post(`/api/chat/channels/${threadId}/join`, {}, "Could not join the channel."));
}

export function useLeaveChannel() {
  return useRailMutation((threadId: string) => post(`/api/chat/channels/${threadId}/leave`, {}, "Could not leave the channel."));
}

export function useLeaveTeam() {
  return useRailMutation((spaceId: string) => post(`/api/chat/teams/${spaceId}/leave`, {}, "Could not leave the team."));
}

/** Add team members to a channel — the `@` list's "Add to # Loads" (Q-CHAT20 (a)). Refreshes the channel's people. */
export function useAddChannelMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; userIds: string[] }) =>
      post<{ added: number }>(`/api/chat/channels/${input.threadId}/members`, { user_ids: input.userIds }, "Could not add them to the channel."),
    onSettled: (_r, _e, input) => Promise.all([
      qc.invalidateQueries({ queryKey: conversationKey(input.threadId) }),
      qc.invalidateQueries({ queryKey: teamsKey }),
    ]),
  });
}

export function useAddTeamMembers() {
  return useRailMutation((input: { spaceId: string; userIds: string[] }) =>
    post<{ added: number }>(`/api/chat/teams/${input.spaceId}/members`, { user_ids: input.userIds }, "Could not add those people."),
  );
}

/** A channel in a team; resolves to its id. A fresh client id makes a retried create the same channel. */
export function useCreateChannel() {
  return useRailMutation(async (input: { spaceId: string; name: string; visibility: "public" | "private"; memberIds: string[] }) =>
    (await post<{ thread_id: string }>(
      `/api/chat/teams/${input.spaceId}/channels`,
      { thread_id: genUuid(), name: input.name, visibility: input.visibility, member_ids: input.memberIds },
      "Could not make the channel.",
    )).thread_id,
  );
}
