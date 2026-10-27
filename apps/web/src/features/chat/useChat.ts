import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  ChatConversationResponse,
  ChatDirectoryEntry,
  ChatInboxResponse,
  ChatKind,
  ChatMember,
  ChatMessage,
  ChatSendResponse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { genUuid } from "@/lib/uuid";
import { chatLinkState } from "./transport";
import { keepEarlierSharing, useLoadEarlier } from "./earlierPages";

/**
 * Office chat's data layer (OFFICE-CHAT-PLAN CH2). Everything through `/api/chat`, which answers only
 * for conversations the caller is in — so nothing here filters by person or role.
 *
 * FRESHNESS: the inbox polls every 30 s and an open conversation every 10 s; while the realtime link
 * is live (`transport.ts`, CH3b) both stretch to 60 s, because a signal already brought anything new
 * (D-CHAT2: realtime is the speed, the poll is the guarantee). The interval is read after each fetch,
 * so a link that drops brings the fast pace back within one cycle.
 *
 * SENDING is optimistic: the line appears at once as `pending`, keyed by the client id that is also
 * the row's primary key, so a retry of the same send is recognised by the database and never doubled.
 * A failure leaves the line on screen as `failed` with its text, for Retry — the text is never lost.
 */
export const CHAT_KEY = ["chat"] as const;
export const inboxKey = [...CHAT_KEY, "inbox"] as const;
export const conversationKey = (id: string | null) => [...CHAT_KEY, "conversation", id] as const;
/** The Teams rail. A channel's posts and replies sit under `conversationKey(id)`, so a send refreshes them. */
export const teamsKey = [...CHAT_KEY, "teams"] as const;

/** The poll used while the realtime link is live (D-CHAT2), else the one a poll-only page needs. */
const RELAXED_POLL = 60_000;
const poll = (fallback: number) => () => (chatLinkState.value === "live" ? RELAXED_POLL : fallback);

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

/**
 * The inbox. With no `kinds` it is every conversation — the sidebar badge's query, so an unread
 * channel counts there (D-CHAT2). The /chat page's Chats list asks for `["direct", "group"]`, since
 * channels are listed by their team on the Teams rail (CH5c). Its key sits under `inboxKey`, so
 * everything that refreshes the inbox refreshes both.
 */
export function useChatInboxQuery(enabled: Ref<boolean>, kinds?: readonly ChatKind[]) {
  const qs = kinds?.length ? `?kinds=${kinds.join(",")}` : "";
  return useQuery({
    queryKey: kinds?.length ? ([...inboxKey, kinds.join(",")] as readonly string[]) : (inboxKey as readonly string[]),
    enabled,
    queryFn: () => unwrap(apiFetch<ChatInboxResponse>(`/api/chat${qs}`), "Could not load your conversations."),
    refetchInterval: poll(30_000),
  });
}

export function useChatPeopleQuery(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [...CHAT_KEY, "people"],
    enabled,
    queryFn: async () =>
      (await unwrap(apiFetch<{ people: ChatDirectoryEntry[] }>("/api/chat/people"), "Could not load the people list.")).people,
    staleTime: 5 * 60_000,
  });
}

/** One conversation, newest page first fetched; earlier pages it was shown survive a refetch (CH6a). */
export function useChatConversationQuery(threadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => conversationKey(threadId.value)),
    enabled: computed(() => !!threadId.value),
    queryFn: () =>
      unwrap(apiFetch<ChatConversationResponse>(`/api/chat/${threadId.value}`), "Could not open the conversation."),
    refetchInterval: poll(10_000),
    structuralSharing: keepEarlierSharing("messages"),
  });
}

/**
 * Who is in a conversation — a channel's people for the composer's `@` list (CH6b-2). Under
 * `conversationKey`, so an add from the list refreshes it with the rest of the channel.
 */
export function useChatMembersQuery(threadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...conversationKey(threadId.value), "members"] as const),
    enabled: computed(() => !!threadId.value),
    queryFn: async () =>
      (await unwrap(apiFetch<{ members: ChatMember[] }>(`/api/chat/${threadId.value}/members`), "Could not load who is in it.")).members,
    staleTime: 60_000,
  });
}

/** "Show earlier" in a conversation: the page above, from `/messages?before_seq=` (CH1b's history route). */
export function useChatLoadEarlier(threadId: Ref<string | null>) {
  return useLoadEarlier(
    "messages",
    () => (threadId.value ? conversationKey(threadId.value) : null),
    (before) => (threadId.value ? `/api/chat/${threadId.value}/messages?before_seq=${before}` : null),
  );
}

/** A line the person wrote that the server has not confirmed yet, or refused. */
export interface PendingLine {
  message_id: string;
  thread_id: string;
  /** The channel post it replies to (D-CHAT19); null for a line of the conversation itself. */
  parent_id: string | null;
  body: string;
  state: "pending" | "failed";
  error: string | null;
}

/**
 * The lines on screen: what the server returned, plus this tab's own pending and failed sends that the
 * server has not yet shown. A pending line whose id the server now lists is simply dropped — the
 * server's copy, with its position and time, wins.
 */
export function mergeLines(
  server: readonly ChatMessage[],
  pending: readonly PendingLine[],
  threadId: string,
  parentId: string | null = null,
): Array<{ kind: "server"; message: ChatMessage } | { kind: "local"; line: PendingLine }> {
  const known = new Set(server.map((m) => m.id));
  return [
    ...server.map((message) => ({ kind: "server" as const, message })),
    ...pending
      .filter((p) => p.thread_id === threadId && p.parent_id === parentId && !known.has(p.message_id))
      .map((line) => ({ kind: "local" as const, line })),
  ];
}

export function useChatSend(pending: Ref<PendingLine[]>) {
  const qc = useQueryClient();
  const set = (id: string, patch: Partial<PendingLine> | null) => {
    pending.value = patch === null
      ? pending.value.filter((p) => p.message_id !== id)
      : pending.value.map((p) => (p.message_id === id ? { ...p, ...patch } : p));
  };
  return useMutation({
    mutationFn: async (input: { threadId: string; body: string; messageId?: string; parentId?: string | null }): Promise<ChatSendResponse> => {
      const id = input.messageId ?? genUuid();
      const parentId = input.parentId ?? null;
      if (!pending.value.some((p) => p.message_id === id)) {
        pending.value = [...pending.value, { message_id: id, thread_id: input.threadId, parent_id: parentId, body: input.body, state: "pending", error: null }];
      } else {
        set(id, { state: "pending", error: null });
      }
      // A reply goes to its post's own route (CH5b); everything else is a line of the conversation.
      const path = parentId
        ? `/api/chat/channels/${input.threadId}/posts/${parentId}/replies`
        : `/api/chat/${input.threadId}/messages`;
      try {
        const sent = await unwrap(
          apiFetch<ChatSendResponse>(path, { method: "POST", body: { message_id: id, body: input.body } }),
          "Could not send the message.",
        );
        await qc.invalidateQueries({ queryKey: conversationKey(input.threadId) });
        set(id, null);
        return sent;
      } catch (e) {
        set(id, { state: "failed", error: e instanceof Error ? e.message : "Could not send the message." });
        throw e;
      }
    },
    // The rail too: a channel post moves its channel's place and counts.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: inboxKey }), qc.invalidateQueries({ queryKey: teamsKey })]),
  });
}

export function useChatMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; seq: number }) => {
      await apiFetch(`/api/chat/${input.threadId}/read`, { method: "POST", body: { seq: input.seq } });
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: inboxKey }), qc.invalidateQueries({ queryKey: teamsKey })]),
  });
}

/** Open (or find) the one conversation with a person; resolves to its id. */
export function useChatOpenDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await unwrap(
        apiFetch<{ thread_id: string }>("/api/chat/direct", { method: "POST", body: { thread_id: genUuid(), user_id: userId } }),
        "Could not open the conversation.",
      )).thread_id,
    onSettled: () => qc.invalidateQueries({ queryKey: inboxKey }),
  });
}

export function useChatCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subject: string | null; memberIds: string[] }) =>
      (await unwrap(
        apiFetch<{ thread_id: string }>("/api/chat/groups", {
          method: "POST",
          body: { thread_id: genUuid(), subject: input.subject, member_ids: input.memberIds },
        }),
        "Could not create the group.",
      )).thread_id,
    onSettled: () => qc.invalidateQueries({ queryKey: inboxKey }),
  });
}

/** Edit or retract your own message; both refresh the open conversation and the inbox. */
export function useChatMessageActions(threadId: Ref<string | null>) {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: conversationKey(threadId.value) }),
      qc.invalidateQueries({ queryKey: inboxKey }),
    ]);
  };
  const edit = useMutation({
    mutationFn: async (input: { messageId: string; body: string }) =>
      unwrap(apiFetch(`/api/chat/messages/${input.messageId}`, { method: "PATCH", body: { body: input.body } }), "Could not save the edit."),
    onSettled: refresh,
  });
  const retract = useMutation({
    mutationFn: async (messageId: string) =>
      unwrap(apiFetch(`/api/chat/messages/${messageId}`, { method: "DELETE" }), "Could not remove the message."),
    onSettled: refresh,
  });
  return { edit, retract };
}
