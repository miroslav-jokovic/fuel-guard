import { computed } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * The office inbox (DQF plan C6) over the SAME `/api/me/notifications` surface the driver app uses —
 * that router was never driver-gated, only audience-scoped (`audience_user_id = me`), so the office
 * bell is a reader of rows C3's scheduler has been writing since it shipped. Scope discipline per
 * the plan: list, unread count, mark read, deep link. No preferences UI.
 */
export interface OfficeNotification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  severity: "info" | "warning" | "critical";
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
}

const KEY = ["notifications", "inbox"] as const;

export function useNotificationsQuery() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ notifications: OfficeNotification[]; unread: number }> => {
      const res = await apiFetch<{ notifications: OfficeNotification[]; unread: number }>(
        "/api/me/notifications",
      );
      // A 403 here is the notifications module being off for the org — the bell simply has nothing
      // to show, which must render as an empty inbox, never as an error toast on every page.
      if (!res.ok) return { notifications: [], unread: 0 };
      return { notifications: res.data?.notifications ?? [], unread: res.data?.unread ?? 0 };
    },
    refetchInterval: 60_000,
    retry: false,
  });
  return {
    ...query,
    notifications: computed(() => query.data.value?.notifications ?? []),
    unread: computed(() => query.data.value?.unread ?? 0),
  };
}

/** Mark specific ids read, or omit to clear the badge entirely. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]): Promise<void> => {
      await apiFetch("/api/me/notifications/read", { method: "POST", body: ids ? { ids } : {} });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
