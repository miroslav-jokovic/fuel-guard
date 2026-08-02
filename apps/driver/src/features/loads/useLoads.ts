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
  type LoadStop,
} from '@fuelguard/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';
import { enqueue, newClientId } from '@/data/outbox';
import { stageFile } from '@/data/fileStaging';
import {
  LOAD_ACCEPT_KIND,
  LOAD_DECLINE_KIND,
  LOAD_START_KIND,
  LOAD_STOP_KIND,
} from '@/data/handlers';
import { useSession } from '@/session/SessionProvider';
import { useDriverContext } from '@/session/useDriverContext';
import { buildStopPhotos, type SessionCapture } from './stopCaptureModel';

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

/**
 * Optimistically advance ONE stop within a load: set its status, its skip reason, and append the
 * photos captured this session so the checklist reads as satisfied immediately. The load's own
 * status transition (accepted → in_transit → delivered) is server-authoritative — the sync
 * invalidates ['me','loads'] on success, so the real load status comes straight back.
 */
function patchStop(
  qc: ReturnType<typeof useQueryClient>,
  loadId: string,
  stopId: string,
  status: LoadStop['status'],
  captures: readonly SessionCapture[],
  skipReason: string | undefined,
): void {
  const nowIso = new Date().toISOString();
  qc.setQueryData<MeLoadsResponse>(ME_LOADS_KEY, (prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      loads: prev.loads.map((l) => {
        if (l.id !== loadId) return l;
        return {
          ...l,
          stops: l.stops.map((s) => {
            if (s.id !== stopId) return s;
            const optimisticPhotos = captures.map((c) => ({
              id: c.photoId,
              slot: c.slot,
              storage_path: '', // real path lands when the list re-fetches after sync
              captured_at: c.capturedAt,
              uploaded_at: nowIso,
            }));
            return {
              ...s,
              status,
              ...(skipReason ? { skip_reason: skipReason } : {}),
              photos: [...s.photos, ...optimisticPhotos],
            };
          }),
        };
      }),
    };
  });
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

export interface CompleteStopInput {
  loadId: string;
  stopId: string;
  status: 'arrived' | 'completed' | 'skipped';
  /** Photos captured this session; empty for a plain arrive/skip. */
  captures?: readonly SessionCapture[];
  /** Required when completing with a missing required photo, or when skipping (D21). */
  skipReason?: string;
}

/**
 * Advance a stop (arrive / complete / skip) with the photos captured this session. Each processed
 * JPEG is STAGED (copied into the durable outbox area) before the record is queued, so it survives a
 * relaunch and is deleted only after a confirmed sync (D12). The handler uploads the staged files to
 * Storage and then POSTs the completion; both are idempotent on the client UUIDs.
 */
export function useCompleteStop() {
  const qc = useQueryClient();
  const { orgId } = useSession();
  const driver = useDriverContext();
  return useMutation({
    mutationFn: async (input: CompleteStopInput) => {
      const driverId = driver.data?.driver.id;
      if (!orgId || !driverId) {
        throw new Error('Your profile is still loading — give it a second and try again.');
      }
      const recordId = newClientId();
      const captures = input.captures ?? [];
      const photos = buildStopPhotos({ orgId, driverId, loadId: input.loadId, captures });
      // Stage each processed JPEG under the record id; the staged uri (not the volatile cache uri) is
      // what the outbox references and the handler uploads.
      const stagedPhotos = await Promise.all(
        photos.map(async (p, i) => ({
          ...p,
          local_uri: await stageFile(p.local_uri, recordId, i),
        })),
      );
      await enqueue({
        id: recordId,
        kind: LOAD_STOP_KIND,
        payload: {
          load_id: input.loadId,
          stop_id: input.stopId,
          status: input.status,
          ...(input.skipReason ? { skip_reason: input.skipReason } : {}),
          occurred_at: new Date().toISOString(),
          photos: stagedPhotos,
        },
        fileUris: stagedPhotos.map((p) => p.local_uri),
      });
      patchStop(qc, input.loadId, input.stopId, input.status, captures, input.skipReason);
    },
  });
}
