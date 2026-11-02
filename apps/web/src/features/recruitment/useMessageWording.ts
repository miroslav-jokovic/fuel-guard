import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { MessageWording, MessageWordingView, RecruitingMessageKey, SavedMessageWording } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The carrier's wording for the messages an applicant is sent (HIRING-WORKFLOW-AUDIT §12 MT2, 0551):
 * Settings → Recruiting's "Messages". One read lists every message; one save per message writes a new
 * row (0551 keeps every save), and the answer replaces that message in the cached list.
 */
export const messageWordingKey = ["recruitment", "messages"] as const;

export function useMessageWording() {
  return useQuery({
    queryKey: messageWordingKey,
    queryFn: async (): Promise<MessageWordingView> => {
      const res = await apiFetch<MessageWordingView>("/api/recruitment/messages");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the messages.");
      return res.data;
    },
  });
}

export function useSaveMessageWording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: RecruitingMessageKey; wording: MessageWording }): Promise<SavedMessageWording> => {
      const res = await apiFetch<{ message: SavedMessageWording }>(`/api/recruitment/messages/${v.key}`, { method: "PUT", body: v.wording });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the wording.");
      return res.data.message;
    },
    onSuccess: (saved) => {
      qc.setQueryData<MessageWordingView>(messageWordingKey, (view) =>
        view && { ...view, messages: view.messages.map((m) => (m.key === saved.key ? saved : m)) });
    },
  });
}
