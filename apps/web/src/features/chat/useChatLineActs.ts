import { computed, inject, provide, type InjectionKey, type Ref } from "vue";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ChatPinnedLine, ChatPinsResponse, ChatReaction, ChatSavedLine, ChatSavedResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY, conversationKey } from "./useChat";

/**
 * What a person does to a line (OFFICE-CHAT-PLAN CH6c-2): react, pin, save — and the two lists those
 * make, a conversation's pins and the person's saved lines.
 *
 * ONE PROVIDER, EVERY ROW. A line is drawn by the same `ChatMessageRow` in a conversation, a channel and
 * a thread, three stages deep under the page. Threading three more events up through each stage would
 * add the same six lines of plumbing to every one of them, so the page provides the acts once
 * (`provideChatLineActs`) and the row injects them (`useChatLineActs`), as `chatNames.ts` already does
 * for who a mention names. A row with nothing provided — the compliance console's — draws no acts.
 *
 * FRESHNESS. A reaction or a pin moves the line's `rev` (0523), so the realtime signal and `/sync`
 * carry it to every other tab; this tab refetches what it has open. Every open line — a conversation's,
 * a channel's posts, a thread's replies, the pins — sits under `conversationKey(id)`, so invalidating
 * the conversations' prefix refreshes exactly the queries that are mounted and only marks the rest stale.
 */
export const savedKey = [...CHAT_KEY, "saved"] as const;
const conversationsPrefix = [...CHAT_KEY, "conversation"] as const;

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

export interface ChatLineActs {
  react: (messageId: string, reaction: ChatReaction, on: boolean) => Promise<void>;
  pin: (messageId: string, on: boolean) => Promise<void>;
  save: (messageId: string, on: boolean) => Promise<void>;
}
/** Exported for a test that provides its own acts to a row; the page always goes through `provideChatLineActs`. */
export const LINE_ACTS: InjectionKey<ChatLineActs> = Symbol("chat-line-acts");

/** The page's half: the three writes, each refreshing what it changed, each failure told to `onError`. */
export function provideChatLineActs(onError: (message: string) => void): ChatLineActs {
  const qc = useQueryClient();
  const refreshLines = () => qc.invalidateQueries({ queryKey: conversationsPrefix });
  const write = (path: string, method: "POST" | "PUT", body: Record<string, unknown>, fallback: string) =>
    unwrap(apiFetch<unknown>(path, { method, body }), fallback);
  const react = useMutation({
    mutationFn: (v: { id: string; reaction: ChatReaction; on: boolean }) =>
      write(`/api/chat/messages/${v.id}/reactions`, "POST", { reaction: v.reaction, on: v.on }, "Could not add the reaction."),
    onSettled: refreshLines,
  });
  const pin = useMutation({
    mutationFn: (v: { id: string; on: boolean }) =>
      write(`/api/chat/messages/${v.id}/pin`, "PUT", { on: v.on }, v.on ? "Could not pin the message." : "Could not unpin the message."),
    onSettled: refreshLines,
  });
  const save = useMutation({
    mutationFn: (v: { id: string; on: boolean }) =>
      write(`/api/chat/messages/${v.id}/save`, "PUT", { on: v.on }, v.on ? "Could not save the message." : "Could not remove it from Saved."),
    onSettled: () => Promise.all([refreshLines(), qc.invalidateQueries({ queryKey: savedKey })]),
  });
  const told = (e: unknown): void => {
    onError(e instanceof Error ? e.message : "Could not update the message.");
  };
  const acts: ChatLineActs = {
    react: (id, reaction, on) => react.mutateAsync({ id, reaction, on }).then(() => undefined, told),
    pin: (id, on) => pin.mutateAsync({ id, on }).then(() => undefined, told),
    save: (id, on) => save.mutateAsync({ id, on }).then(() => undefined, told),
  };
  provide(LINE_ACTS, acts);
  return acts;
}

/** The row's half; null where nothing provided them. */
export function useChatLineActs(): ChatLineActs | null {
  return inject(LINE_ACTS, null);
}

/** A conversation's (or channel's) pinned lines, while the Pinned list is open. */
export function useChatPinsQuery(threadId: Ref<string | null>, open: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => [...conversationKey(threadId.value), "pins"] as const),
    enabled: computed(() => open.value && !!threadId.value),
    queryFn: async (): Promise<ChatPinnedLine[]> =>
      (await unwrap(apiFetch<ChatPinsResponse>(`/api/chat/${threadId.value}/pins`), "Could not load the pinned messages.")).pins,
  });
}

/** The person's saved lines, newest save first, a page at a time. */
export function useChatSavedQuery(enabled: Ref<boolean>) {
  const q = useInfiniteQuery({
    queryKey: [...savedKey, "pages"],
    enabled,
    initialPageParam: null as ChatSavedResponse["next"],
    queryFn: ({ pageParam }) => {
      const qs = pageParam ? `?before_at=${encodeURIComponent(pageParam.before_at)}&before_id=${pageParam.before_id}` : "";
      return unwrap(apiFetch<ChatSavedResponse>(`/api/chat/saved${qs}`), "Could not load your saved messages.");
    },
    getNextPageParam: (last) => last.next,
  });
  const items = computed<ChatSavedLine[]>(() => q.data.value?.pages.flatMap((p) => p.items) ?? []);
  return { ...q, items };
}
