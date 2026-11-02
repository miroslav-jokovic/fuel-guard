import { computed, inject, provide, type InjectionKey, type Ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import type { ChatCatchupResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * "Catch me up" (OFFICE-CHAT-PLAN CH12, §9.5). The chat page says whether the carrier has the `chat_ai`
 * module (D-CHAT37) once, for every conversation and channel under it (`provideChatCatchup`), as it
 * provides the line acts; a stage anywhere else offers nothing. The API is the gate — this only keeps a
 * carrier without the module from seeing a menu item that would answer 403.
 */
const CATCHUP_ON: InjectionKey<Ref<boolean>> = Symbol("chat-catchup");
export function provideChatCatchup(on: Ref<boolean>): void {
  provide(CATCHUP_ON, on);
}
export function useChatCatchupOn(): Ref<boolean> {
  return inject(CATCHUP_ON, computed(() => false));
}

/** The answer, or the day's cap reached — the one refusal the dialog words itself. */
export type ChatCatchupOutcome = ({ kind: "done" } & ChatCatchupResponse) | { kind: "limit" };

/**
 * One ask. A mutation, not a query: each one spends a catch-up and writes a ledger row (0549), so it runs
 * only when the person presses the item, never on a refetch, a focus or a remount.
 */
export function useChatCatchup() {
  return useMutation({
    mutationFn: async (threadId: string): Promise<ChatCatchupOutcome> => {
      const res = await apiFetch<ChatCatchupResponse>(`/api/chat/${threadId}/catchup`, { method: "POST" });
      if (res.status === 429) return { kind: "limit" };
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not catch you up.");
      return { kind: "done", ...res.data };
    },
  });
}
