import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  meNotificationsResponseSchema,
  type MeNotificationsResponse,
  type UpdatePreferencesRequest,
} from '@fuelguard/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';

/**
 * The notification centre data layer (Phase 6 / D53). One query feeds BOTH the Home bell badge and
 * the centre screen — parsed with the shared contract (D24), cached under ['me','notifications']
 * and persisted, so the bell renders the last-known unread count offline. The in-app list is the
 * fallback that matters: a driver who denied the OS push permission still sees everything here.
 * Polls every 60s while an app screen is mounted — push is the fast path, this is the honest one.
 */
export const ME_NOTIFICATIONS_KEY = ['me', 'notifications'] as const;

export function useNotifications(enabled = true): UseQueryResult<MeNotificationsResponse, Error> {
  return useQuery({
    queryKey: ME_NOTIFICATIONS_KEY,
    // Gated by the caller on the `notifications` feature — an unentitled org would just 403.
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/notifications', {
        schema: meNotificationsResponseSchema,
        signal,
      });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load notifications.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
    refetchInterval: 60_000,
  });
}

/** Mark specific notifications read, or pass no ids to clear the badge entirely. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const res = await apiFetch('/api/me/notifications/read', {
        method: 'POST',
        body: ids && ids.length > 0 ? { ids } : {},
      });
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not mark as read.');
    },
    // Optimistic: the badge clears the instant the driver acts; the poll reconciles.
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ME_NOTIFICATIONS_KEY });
      qc.setQueryData<MeNotificationsResponse>(ME_NOTIFICATIONS_KEY, (prev) => {
        if (!prev) return prev;
        const nowIso = new Date().toISOString();
        const idSet = ids && ids.length > 0 ? new Set(ids) : null;
        const notifications = prev.notifications.map((n) =>
          n.read_at === null && (idSet === null || idSet.has(n.id)) ? { ...n, read_at: nowIso } : n,
        );
        return { ...prev, notifications, unread: notifications.filter((n) => n.read_at === null).length };
      });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ME_NOTIFICATIONS_KEY }),
  });
}

/** Category mutes + quiet hours — enforced server-side; this just records the driver's choice. */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdatePreferencesRequest) => {
      const res = await apiFetch('/api/me/notifications/preferences', { method: 'PATCH', body: patch });
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not save your notification settings.');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ME_NOTIFICATIONS_KEY }),
  });
}
