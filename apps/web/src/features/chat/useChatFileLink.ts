import { computed, type Ref } from "vue";
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import type { ChatFileLink, ChatFileListItem, ChatFilesResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY, conversationKey } from "./useChat";

/**
 * A five-minute link to one chat file (CH7, `GET /api/chat/files/:id`). Cached for four minutes, so an
 * image on screen keeps a working URL and a re-render does not ask again; after that the next render asks
 * for a fresh one. `enabled` lets a document card ask only when it is pressed.
 */
export const fileLinkKey = (id: string) => [...CHAT_KEY, "file", id] as const;

export async function fetchChatFileLink(id: string): Promise<ChatFileLink> {
  const res = await apiFetch<ChatFileLink>(`/api/chat/files/${id}`);
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not open the file.");
  return res.data;
}

/**
 * Follows a document's link. A navigation, not `window.open`: the link arrives after an await, where a
 * browser no longer counts the press and blocks a new window; the API signs a document as a download
 * (D-CHAT30), so the page stays where it is and the file is saved. Its own function so a test can see
 * where a card sent the browser — jsdom cannot navigate.
 */
export function followDownload(url: string): void {
  window.location.assign(url);
}

export function useChatFileLink(id: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => fileLinkKey(id.value)),
    enabled,
    queryFn: () => fetchChatFileLink(id.value),
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
  });
}

/**
 * A conversation's files, newest first, a page at a time (CH7, `GET /api/chat/:id/files`), for the header
 * menu's Files list. It sits under `conversationKey(id)` as the pins do, so a line sent or removed in this
 * tab — which invalidates that prefix — refreshes an open list too.
 */
export function useChatFilesQuery(threadId: Ref<string | null>, open: Ref<boolean>) {
  const q = useInfiniteQuery({
    queryKey: computed(() => [...conversationKey(threadId.value), "files"] as const),
    enabled: computed(() => open.value && !!threadId.value),
    initialPageParam: null as ChatFilesResponse["next"],
    queryFn: async ({ pageParam }) => {
      const qs = pageParam ? `?before_at=${encodeURIComponent(pageParam.before_at)}&before_id=${pageParam.before_id}` : "";
      const res = await apiFetch<ChatFilesResponse>(`/api/chat/${threadId.value}/files${qs}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the conversation's files.");
      return res.data;
    },
    getNextPageParam: (last) => last.next,
  });
  const items = computed<ChatFileListItem[]>(() => q.data.value?.pages.flatMap((p) => p.files) ?? []);
  return { ...q, items };
}
