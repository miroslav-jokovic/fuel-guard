import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ThreadDetailResponse, ThreadsResponse } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { genUuid } from "@/lib/uuid";

/**
 * Dispatch inbox data layer (Phase 7, D-PM4 — the Samsara model). Everything through
 * /api/messages: access is by thread PARTICIPATION (server + RLS), so this composable never
 * filters by role — the API already only returns what this user is in.
 *
 * The 30s poll is the office-side freshness model (a dispatcher lives in this tab; realtime
 * WebSockets are the DRIVER app's need, where a message must interrupt). unread_total feeds the
 * top-bar badge through the same query — one fetch, two surfaces.
 */
const THREADS_KEY = ["messages", "threads"] as const;

export function useThreadsQuery(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: THREADS_KEY,
    enabled,
    queryFn: async (): Promise<ThreadsResponse> => {
      const res = await apiFetch<ThreadsResponse>("/api/messages");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Failed to load messages.");
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useThreadDetailQuery(threadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...THREADS_KEY, threadId.value] as const),
    enabled: computed(() => !!threadId.value),
    queryFn: async (): Promise<ThreadDetailResponse> => {
      const res = await apiFetch<ThreadDetailResponse>(`/api/messages/${threadId.value}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Failed to load the conversation.");
      return res.data;
    },
    refetchInterval: 15_000,
  });
}

/**
 * Start conversations with one or MANY drivers (Samsara compose-to-many): one thread per driver,
 * each a private office↔driver channel — never a group chat a driver didn't ask to be in. Client
 * UUIDs make each create idempotent. Returns per-driver failures so a partial broadcast is
 * reported, not silently swallowed.
 */
export function useComposeThreads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      driverIds: string[];
      body: string;
      subject?: string;
      loadId?: string | null;
    }): Promise<{ sent: number; failed: string[] }> => {
      const failed: string[] = [];
      let sent = 0;
      for (const driverId of input.driverIds) {
        const res = await apiFetch("/api/messages", {
          method: "POST",
          body: {
            thread_id: genUuid(),
            message_id: genUuid(),
            driver_id: driverId,
            body: input.body,
            ...(input.subject ? { subject: input.subject } : {}),
            ...(input.loadId ? { load_id: input.loadId } : {}),
          },
        });
        if (res.ok) sent += 1;
        else failed.push(driverId);
      }
      return { sent, failed };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; body: string }): Promise<void> => {
      const res = await apiFetch(`/api/messages/${input.threadId}/messages`, {
        method: "POST",
        body: { message_id: genUuid(), body: input.body },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to send.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string): Promise<void> => {
      await apiFetch(`/api/messages/${threadId}/read`, { method: "POST" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  });
}
