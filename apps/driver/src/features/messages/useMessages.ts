import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  threadDetailResponseSchema,
  threadsResponseSchema,
  type Message,
  type MessageReportReason,
  type ThreadDetailResponse,
  type ThreadsResponse,
} from '@silvicom/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';
import { enqueue, newClientId } from '@/data/outbox';
import { MESSAGE_SEND_KIND, MESSAGE_THREAD_KIND } from '@/data/handlers';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/session/SessionProvider';

/**
 * Driver messages (Phase 7, D54/D-PM4) — the stack's first INBOUND realtime path.
 *
 * Outbound rides the outbox like every other driver write: a reply typed in a dead zone is queued
 * with client-UUID PKs (thread + message), drains on reconnect, and a double drain no-ops server-
 * side. The cache is patched optimistically so the conversation reads right immediately.
 *
 * Inbound: Supabase Realtime INSERTs on `messages` (0096 put the table in the publication; RLS
 * scopes events to threads this login participates in) → invalidate. The 60s poll stays as the
 * fallback — realtime is a fast path, never the only path (plan §7 offline honesty).
 */
export const ME_THREADS_KEY = ['me', 'messages'] as const;

export function useThreads(enabled = true): UseQueryResult<ThreadsResponse, Error> {
  return useQuery({
    queryKey: ME_THREADS_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/messages', { schema: threadsResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(res.error?.message ?? 'Could not load messages.', res.status, res.error?.code);
      }
      return res.data;
    },
    refetchInterval: 60_000,
  });
}

export function useThreadDetail(threadId: string | undefined, enabled = true): UseQueryResult<ThreadDetailResponse, Error> {
  return useQuery({
    queryKey: [...ME_THREADS_KEY, threadId] as const,
    enabled: enabled && !!threadId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/api/messages/${threadId}`, { schema: threadDetailResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(res.error?.message ?? 'Could not load the conversation.', res.status, res.error?.code);
      }
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

/** An optimistic message for the cache while the outbox record is in flight. */
function provisionalMessage(threadId: string, messageId: string, userId: string | null, body: string): Message {
  return {
    id: messageId,
    thread_id: threadId,
    sender_user_id: userId,
    sender_name: null, // rendered as "You" by the screen for own messages
    body,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
  };
}

/** Reply in an existing thread — queued, optimistic, replay-safe on the message UUID. */
export function useSendMessage(threadId: string | undefined) {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation({
    mutationFn: async (body: string) => {
      if (!threadId) throw new Error('No conversation open.');
      const messageId = newClientId();
      await enqueue({
        id: messageId,
        kind: MESSAGE_SEND_KIND,
        payload: { thread_id: threadId, message_id: messageId, body, occurred_at: new Date().toISOString() },
      });
      qc.setQueryData<ThreadDetailResponse>([...ME_THREADS_KEY, threadId], (prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, provisionalMessage(threadId, messageId, userId, body)] }
          : prev,
      );
    },
  });
}

/** Start a conversation with dispatch (server resolves the audience) — one queued unit. */
export function useStartThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string; subject?: string; loadId?: string | null }) => {
      const threadId = newClientId();
      const messageId = newClientId();
      await enqueue({
        id: threadId,
        kind: MESSAGE_THREAD_KIND,
        payload: {
          thread_id: threadId,
          message_id: messageId,
          body: input.body,
          ...(input.subject ? { subject: input.subject } : {}),
          ...(input.loadId ? { load_id: input.loadId } : {}),
        },
      });
      void qc.invalidateQueries({ queryKey: ME_THREADS_KEY });
      return threadId;
    },
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      await apiFetch(`/api/messages/${threadId}/read`, { method: 'POST' });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ME_THREADS_KEY }),
  });
}

/** Report a message (Apple 1.2 UGC affordance) — direct, not queued: it needs the fleet to see it. */
export function useReportMessage() {
  return useMutation({
    mutationFn: async (input: { messageId: string; reason: MessageReportReason; note?: string }) => {
      const res = await apiFetch(`/api/messages/messages/${input.messageId}/report`, {
        method: 'POST',
        body: { reason: input.reason, ...(input.note ? { note: input.note } : {}) },
      });
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not submit the report.');
    },
  });
}

/**
 * Realtime inbound: new rows on `messages` (RLS-scoped by participation) refresh the caches the
 * instant dispatch replies. Scoped per mounted screen; teardown on unmount. Failures are silent —
 * the poll is the guarantee, realtime is the speed.
 */
export function useMessagesRealtime(threadId?: string, enabled = true): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    const channel = supabase
      .channel(threadId ? `messages-${threadId}` : 'messages-inbox')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          ...(threadId ? { filter: `thread_id=eq.${threadId}` } : {}),
        },
        () => {
          void qc.invalidateQueries({ queryKey: ME_THREADS_KEY });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, threadId, enabled]);
}
