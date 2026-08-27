import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  currentSegment,
  dutyEquipmentLabel,
  isOnDuty,
  meEquipmentResponseSchema,
  meShiftResponseSchema,
  type ChangeEquipmentRequest,
  type DutySession,
  type EndShiftRequest,
  type MeEquipmentResponse,
  type MeShiftResponse,
  type StartShiftRequest,
} from '@silvicom/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';
import { enqueue, newClientId } from '@/data/outbox';
import {
  SHIFT_END_KIND,
  SHIFT_EQUIPMENT_KIND,
  SHIFT_START_KIND,
} from '@/data/handlers';

/**
 * Duty sessions — the driver's equipment truth (Phase 3A backend, D43/D44).
 *
 * Every write goes through the OUTBOX, never straight to the network: a driver checks in at 05:40 in
 * a yard with no signal, and that check-in must survive a relaunch and land when the tower comes
 * back. The cache is updated optimistically so the app reflects the driver's reality immediately, and
 * the session is marked `pending` until the server confirms it — because only the server can detect
 * that someone else already took that truck (D44.7).
 */
export const ME_SHIFT_KEY = ['me', 'shift'] as const;
export const ME_EQUIPMENT_KEY = ['me', 'equipment'] as const;

export function useShift(): UseQueryResult<MeShiftResponse, Error> {
  return useQuery({
    queryKey: ME_SHIFT_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/shift', { schema: meShiftResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your shift.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}

/**
 * The truck/trailer pick list. Cached and persisted so the check-in sheet opens with a full list in
 * a dead zone — the roster is small and changes rarely, which is exactly what a cache is for.
 */
export function useEquipment(): UseQueryResult<MeEquipmentResponse, Error> {
  return useQuery({
    queryKey: ME_EQUIPMENT_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/equipment', { schema: meEquipmentResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your fleet.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
    // A driver may check in before this ever succeeds; a stale list is far better than a blocked sheet.
    // Refresh on each check-in screen mount so newly added trucks appear without requiring a relaunch.
    staleTime: 5 * 60_000,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
}

/** A locally-created session shown while the outbox record is still in flight. */
function provisionalSession(
  input: StartShiftRequest,
  units: { vehicle: string | null; trailer: string | null },
): DutySession {
  const startedAt = input.started_at ?? new Date().toISOString();
  return {
    id: input.session_id,
    driver_id: '',
    started_at: startedAt,
    ended_at: null,
    ended_reason: null,
    start_odometer: input.start_odometer ?? null,
    end_odometer: null,
    source: 'driver_app',
    segments: [
      {
        id: input.segment_id,
        vehicle_id: input.vehicle_id,
        vehicle_unit: units.vehicle,
        trailer_id: input.trailer_id ?? null,
        trailer_unit: units.trailer,
        seat: 'driver',
        from_at: startedAt,
        to_at: null,
        confirmed_by: 'driver',
        note: null,
      },
    ],
  };
}

export interface StartShiftInput {
  vehicleId: string;
  vehicleUnit: string;
  trailerId?: string | null;
  trailerUnit?: string | null;
  startOdometer?: number;
  takeOver?: boolean;
}

/** Start the day. Truck required, trailer optional — "not hooked yet" is a real answer (D44.2). */
export function useStartShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartShiftInput) => {
      const payload: StartShiftRequest = {
        session_id: newClientId(),
        segment_id: newClientId(),
        vehicle_id: input.vehicleId,
        ...(input.trailerId ? { trailer_id: input.trailerId } : {}),
        ...(input.startOdometer !== undefined ? { start_odometer: input.startOdometer } : {}),
        started_at: new Date().toISOString(),
        take_over: input.takeOver ?? false,
      };
      await enqueue({ id: payload.session_id, kind: SHIFT_START_KIND, payload });
      qc.setQueryData<MeShiftResponse>(ME_SHIFT_KEY, {
        session: provisionalSession(payload, {
          vehicle: input.vehicleUnit,
          trailer: input.trailerUnit ?? null,
        }),
      });
      return payload;
    },
  });
}

export interface ChangeEquipmentInput {
  vehicleId?: string;
  vehicleUnit?: string;
  trailerId?: string;
  trailerUnit?: string;
  clearTrailer?: boolean;
  note?: string;
  takeOver?: boolean;
}

/** Drop-and-hook or a truck swap. Opens a new segment; deliberately never ends the shift (D44). */
export function useChangeEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeEquipmentInput) => {
      const payload: ChangeEquipmentRequest = {
        segment_id: newClientId(),
        ...(input.vehicleId ? { vehicle_id: input.vehicleId } : {}),
        ...(input.trailerId ? { trailer_id: input.trailerId } : {}),
        clear_trailer: input.clearTrailer ?? false,
        ...(input.note ? { note: input.note } : {}),
        from_at: new Date().toISOString(),
        take_over: input.takeOver ?? false,
      };
      await enqueue({ id: payload.segment_id, kind: SHIFT_EQUIPMENT_KIND, payload });

      // Optimistically close the current segment and open the new one, so the duty card reads right
      // the instant the driver confirms — the same shape the server will return.
      qc.setQueryData<MeShiftResponse>(ME_SHIFT_KEY, (prev) => {
        const session = prev?.session;
        const cur = currentSegment(session ?? null);
        if (!session || !cur) return prev;
        const at = payload.from_at ?? new Date().toISOString();
        return {
          session: {
            ...session,
            segments: [
              ...session.segments.map((s) => (s.id === cur.id ? { ...s, to_at: at } : s)),
              {
                ...cur,
                id: payload.segment_id,
                vehicle_id: input.vehicleId ?? cur.vehicle_id,
                vehicle_unit: input.vehicleUnit ?? cur.vehicle_unit,
                trailer_id: input.clearTrailer ? null : (input.trailerId ?? cur.trailer_id),
                trailer_unit: input.clearTrailer ? null : (input.trailerUnit ?? cur.trailer_unit),
                from_at: at,
                to_at: null,
                note: input.note ?? null,
              },
            ],
          },
        };
      });
      return payload;
    },
  });
}

/** Sign off. Releases the truck for the next driver — the reason the sweeper exists (D44.5). */
export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { endOdometer?: number } = {}) => {
      const payload: EndShiftRequest = {
        ended_at: new Date().toISOString(),
        ...(input.endOdometer !== undefined ? { end_odometer: input.endOdometer } : {}),
      };
      await enqueue({ id: newClientId(), kind: SHIFT_END_KIND, payload });
      qc.setQueryData<MeShiftResponse>(ME_SHIFT_KEY, { session: null });
      return payload;
    },
  });
}

// ── derived helpers the screens read ──────────────────────────────────────────
export interface DutyView {
  session: DutySession | null;
  onDuty: boolean;
  /** "Unit 214 · Trailer 5521" / "Unit 214 · Bobtail", or null when off duty. */
  equipmentLabel: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  hasTrailer: boolean;
  startedAt: string | null;
}

export function dutyView(data: MeShiftResponse | undefined): DutyView {
  const session = data?.session ?? null;
  const seg = currentSegment(session);
  return {
    session,
    onDuty: isOnDuty(session),
    equipmentLabel: dutyEquipmentLabel(session),
    vehicleId: seg?.vehicle_id ?? null,
    trailerId: seg?.trailer_id ?? null,
    hasTrailer: Boolean(seg?.trailer_id),
    startedAt: session?.started_at ?? null,
  };
}
