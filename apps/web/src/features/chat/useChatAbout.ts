import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { RouteLocationRaw } from "vue-router";
import { chatAboutTitle, type ChatAboutKind, type ChatThreadAboutResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY, unwrap } from "./useChat";

/**
 * "Chat about this" in chat (OFFICE-CHAT-PLAN CH11b, D-CHAT34): what a group is about, for its header.
 * Asked once per conversation and kept — a conversation's record is fixed when it is made (D-CHAT31), so
 * there is nothing to refetch. Only a group can be about anything, so nothing else asks.
 */
export const aboutKey = (threadId: string | null) => [...CHAT_KEY, "about", threadId] as const;

/** The page a record lives on — the router's own names for them. */
export function chatAboutRoute(kind: ChatAboutKind, id: string): RouteLocationRaw {
  const name = kind === "load" ? "load-detail" : kind === "driver" ? "driver-detail" : "vehicle-detail";
  return { name, params: { id } };
}

export function useChatThreadAbout(threadId: Ref<string | null>, isGroup: Ref<boolean>) {
  const q = useQuery({
    queryKey: computed(() => aboutKey(threadId.value)),
    enabled: computed(() => !!threadId.value && isGroup.value),
    staleTime: Infinity,
    queryFn: () => unwrap(apiFetch<ChatThreadAboutResponse>(`/api/chat/${threadId.value}/about`), "Could not read what this conversation is about."),
  });
  /** The header's link, or null while unknown, for a conversation about nothing, or when the ask failed. */
  const link = computed(() => {
    const a = q.data.value?.about;
    return a ? { label: chatAboutTitle(a.kind, a.label), to: chatAboutRoute(a.kind, a.record_id) } : null;
  });
  return { ...q, link };
}
