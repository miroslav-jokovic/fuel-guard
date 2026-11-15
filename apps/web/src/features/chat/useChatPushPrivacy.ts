import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ChatPushPrivacy } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY } from "./useChat";

/**
 * Whether the person's chat notifications leave out the message text (INSTALLED-APP-PLAN IA-S4), read and set
 * through `/api/chat/push/privacy`.
 *
 * ONE SWITCH FOR EVERY DEVICE, like Do not disturb: it lives on the server, which words the phone's pushes
 * (0614). This tab reads it for two things: the rail's control, and the in-tab desktop alerts (CH6d), which
 * must hide what the phone hides — Windows and macOS show those on a locked screen too.
 *
 * `hideText` is for the alerts and answers TRUE until the server has said otherwise: an alert that rings
 * before the answer arrives, or after the read failed, shows no text. Hiding wrongly costs one vaguer alert;
 * showing wrongly puts a line on a screen whose owner said not to. The control never uses it — it draws only
 * what the server answered.
 */
export const pushPrivacyKey = [...CHAT_KEY, "push-privacy"] as const;

export function useChatPushPrivacy(enabled: Ref<boolean> = computed(() => true)) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: pushPrivacyKey,
    enabled,
    queryFn: async () => {
      const res = await apiFetch<ChatPushPrivacy>("/api/chat/push/privacy");
      if (!res.ok || !res.data) throw new Error("Could not load the notification setting.");
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
  const set = useMutation({
    mutationFn: async (hide_text: boolean) => {
      const res = await apiFetch<ChatPushPrivacy>("/api/chat/push/privacy", { method: "PUT", body: { hide_text } });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change the notification setting.");
      return res.data;
    },
    onSuccess: (next) => qc.setQueryData(pushPrivacyKey, next),
  });

  return {
    state,
    hideText: () => state.data.value?.hide_text ?? true,
    setHidden: (hide: boolean) => set.mutateAsync(hide),
    busy: computed(() => set.isPending.value),
  };
}
