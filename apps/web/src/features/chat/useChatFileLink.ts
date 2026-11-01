import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ChatFileLink } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY } from "./useChat";

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

export function useChatFileLink(id: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => fileLinkKey(id.value)),
    enabled,
    queryFn: () => fetchChatFileLink(id.value),
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
  });
}
