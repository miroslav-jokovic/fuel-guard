import { computed, type Ref } from "vue";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ChatActivityItem, ChatActivityResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { chatLinkState } from "./transport";
import { activityKey } from "./useChat";

/**
 * Activity (OFFICE-CHAT-PLAN D-CHAT25, CH6b-2): the lines that named you and the replies to posts you
 * wrote or answered, newest first — derived by the database on every read, so there is nothing here
 * to keep in step. Freshness is the inbox's (D-CHAT2): 30 s, 60 s while the realtime link is live,
 * and a signal on your own topic refreshes it at once (`chatRealtime.ts`).
 *
 * Read state is one instant (`activity_read_at`): opening the list moves it to the newest item shown,
 * never past now, never back. The badge is the server's count of items after it.
 */
const RELAXED_POLL = 60_000;
const poll = () => (chatLinkState.value === "live" ? RELAXED_POLL : 30_000);

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

/** The rail's badge: one number, without a page of rows. */
export function useChatActivityUnreadQuery(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [...activityKey, "unread"],
    enabled,
    queryFn: async () => (await unwrap(apiFetch<{ unread: number }>("/api/chat/activity/unread"), "Could not load Activity.")).unread,
    refetchInterval: poll,
  });
}

/** The list, keyset-paged: each page hands back the cursor of its last item. */
export function useChatActivityQuery(enabled: Ref<boolean>) {
  const q = useInfiniteQuery({
    queryKey: [...activityKey, "pages"],
    enabled,
    initialPageParam: null as ChatActivityResponse["next"],
    queryFn: ({ pageParam }) => {
      const qs = pageParam ? `?before_at=${encodeURIComponent(pageParam.before_at)}&before_id=${pageParam.before_id}` : "";
      return unwrap(apiFetch<ChatActivityResponse>(`/api/chat/activity${qs}`), "Could not load Activity.");
    },
    getNextPageParam: (last) => last.next,
    refetchInterval: poll,
  });
  const items = computed<ChatActivityItem[]>(() => q.data.value?.pages.flatMap((p) => p.items) ?? []);
  return { ...q, items };
}

/** Read up to `at` — the newest item the reader was shown, not "now", so one that lands meanwhile stays unread. */
export function useChatActivityMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (at: string) =>
      unwrap(apiFetch<{ activity_read_at: string }>("/api/chat/activity/read", { method: "POST", body: { at } }), "Could not mark Activity read."),
    onSettled: () => qc.invalidateQueries({ queryKey: activityKey }),
  });
}
