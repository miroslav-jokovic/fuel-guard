import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  acceptanceCopy,
  loadSchema,
  resolveDriverType,
  type AcceptanceCopy,
  type DeclineReason,
  type DriverType,
  type Load,
} from '@fuelguard/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';
import { enqueue, newClientId } from '@/data/outbox';
import { LOAD_ACCEPT_KIND, LOAD_DECLINE_KIND, LOAD_START_KIND } from '@/data/handlers';

/**
 * Loads — the daily job (Phase 3B backend, D45/D46).
 *
 * The list only ever contains loads dispatch approved AND released: the server filters on the same
 * predicate the RLS policy uses, so there is no client-side notion of "hidden" loads to get wrong.
 *
 * Accept and decline ride the outbox like every other write, because a driver reads their phone in
 * a dock with no bars and the answer must not be lost.
 */
export const ME_LOADS_KEY = ['me', 'loads'] as const;

/** `GET /api/me/loads` — parsed, never cast (D24). */
const meLoadsResponseSchema = z.object({
  loads: z.array(loadSchema),
  driver_type: z.string().optional(),
  acceptance: z
    .object({
      primary: z.string(),
      secondary: z.string(),
      reasons: z.array(z.string()),
      unassignsOnDecline: z.boolean(),
    })
    .optional(),
});
export type MeLoadsResponse = z.infer<typeof meLoadsResponseSchema>;

export function useLoads(): UseQueryResult<MeLoadsResponse, Error> {
  return useQuery({
    queryKey: ME_LOADS_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/loads', { schema: meLoadsResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your assignments.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}

/** One load out of the cached list — detail never re-fetches on its own (D29, no waterfall). */
export function useLoad(id: string | undefined): Load | null {
  const { data } = useLoads();
  if (!id) return null;
  return data?.loads.find((l) => l.id === id) ?? null;
}

/**
 * The two labels and the one behavioural difference between a company driver and an owner-operator
 * (D46). Served by the API so the resolution rule lives in exactly one place.
 */
export function useAcceptance(): { type: DriverType; copy: AcceptanceCopy } {
  const { data } = useLoads();
  const type = resolveDriverType(data?.driver_type ?? null, null);
  return { type, copy: acceptanceCopy(type) };
}

/** Optimistically move a load to a new status in the cached list. */
function patchLoad(
  qc: ReturnType<typeof useQueryClient>,
  loadId: string,
  patch: Partial<Load>,
): void {
  qc.setQueryData<MeLoadsResponse>(ME_LOADS_KEY, (prev) =>
    prev
      ? { ...prev, loads: prev.loads.map((l) => (l.id === loadId ? { ...l, ...patch } : l)) }
      : prev,
  );
}

/** Accept / acknowledge. Optimistic, queued, idempotent on the client record id. */
export function useAcceptLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loadId: string) => {
      const accepted_at = new Date().toISOString();
      await enqueue({
        id: newClientId(),
        kind: LOAD_ACCEPT_KIND,
        payload: { load_id: loadId, accepted_at },
      });
      patchLoad(qc, loadId, { status: 'accepted', accepted_at });
    },
  });
}

/**
 * Decline. For an owner-operator the load leaves their list entirely (it returns to the dispatch
 * queue); for a company driver it stays put with the exception logged — so the optimistic update
 * has to know which population this driver is in.
 */
export function useDeclineLoad() {
  const qc = useQueryClient();
  const { copy } = useAcceptance();
  return useMutation({
    mutationFn: async (input: { loadId: string; reason: DeclineReason; note?: string }) => {
      await enqueue({
        id: newClientId(),
        kind: LOAD_DECLINE_KIND,
        payload: {
          load_id: input.loadId,
          reason: input.reason,
          ...(input.note ? { note: input.note } : {}),
          occurred_at: new Date().toISOString(),
        },
      });
      if (copy.unassignsOnDecline) {
        qc.setQueryData<MeLoadsResponse>(ME_LOADS_KEY, (prev) =>
          prev ? { ...prev, loads: prev.loads.filter((l) => l.id !== input.loadId) } : prev,
        );
      }
    },
  });
}

/** Explicit "rolling" — `accepted → in_transit`, which is what moves the load into Current. */
export function useStartLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loadId: string) => {
      await enqueue({
        id: newClientId(),
        kind: LOAD_START_KIND,
        payload: { load_id: loadId, occurred_at: new Date().toISOString() },
      });
      patchLoad(qc, loadId, { status: 'in_transit' });
    },
  });
}
