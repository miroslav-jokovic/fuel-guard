import { computed, type Ref } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { ChatSearchLine, ChatSearchResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY, unwrap } from "./useChat";

/**
 * Office chat search (OFFICE-CHAT-PLAN CH8, `GET /api/chat/search`): the lines a person can read that
 * match every word, newest first, across all their conversations or inside one (`threadId`). Asked only
 * while the Search stage is open and the search holds something besides spaces — the database answers
 * an empty search with nothing, so the request would be a round trip for an empty list.
 *
 * Keyed by the words and the conversation, so going back to an earlier search is answered from the
 * cache; not under `conversationKey`, so a send in some conversation does not refetch every search.
 */
export const searchKey = (q: string, threadId: string | null) => [...CHAT_KEY, "search", q, threadId ?? "all"] as const;

export function useChatSearchQuery(q: Ref<string>, threadId: Ref<string | null>, open: Ref<boolean>) {
  const words = computed(() => q.value.trim());
  const query = useInfiniteQuery({
    queryKey: computed(() => searchKey(words.value, threadId.value)),
    enabled: computed(() => open.value && words.value.length > 0),
    initialPageParam: null as ChatSearchResponse["next"],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ q: words.value });
      if (threadId.value) qs.set("thread", threadId.value);
      if (pageParam) { qs.set("before_at", pageParam.before_at); qs.set("before_id", pageParam.before_id); }
      return unwrap(apiFetch<ChatSearchResponse>(`/api/chat/search?${qs.toString()}`), "Could not search the messages.");
    },
    getNextPageParam: (last) => last.next,
  });
  const items = computed<ChatSearchLine[]>(() => query.data.value?.pages.flatMap((p) => p.items) ?? []);
  return { ...query, items, words };
}
