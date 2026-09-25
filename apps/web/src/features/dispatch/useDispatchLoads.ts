import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  LOAD_BOARD_QUEUE_LABELS,
  LOAD_BOARD_QUEUES,
  LOAD_STATUS_LABELS,
  loadBoardState,
  type LoadBoardQueue,
  type LoadEventKind,
  type LoadStatus,
  type DispatchException,
  type ResolveExceptionRequest,
  type LoadDispatchSummary,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Dispatch load workspace (Phase 3D / D49) — the board's reads and the exceptions it clears.
 *
 * Everything goes through the built `/api/dispatch/*` endpoints, NOT direct PostgREST. The create,
 * edit, reassign, approve/release and bulk mutations that used to live here went with their routes in
 * LOADS-MIRROR-PLAN.md LR6: every load is McLeod's (D-LMR2), and the office's one act on it is
 * Dispatch (`useLoadDispatch.ts`, D-LMR5).
 */

/** One stop as the dispatch list projection returns it. */
export interface DispatchStop {
  id?: string;
  seq: number;
  kind: "pickup" | "dropoff";
  name: string;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  appointment_start: string | null;
  appointment_end: string | null;
  required_photos: string[];
  notes?: string | null;
  status?: string;
  /** McLeod's own view of the stop (LR2 columns, LR4b projection) — null on a load McLeod never sent. */
  location_name?: string | null;
  external_status?: string | null;
  actual_arrival_at?: string | null;
  actual_departure_at?: string | null;
  eta_at?: string | null;
}

/** A load row from `GET /api/dispatch/loads` — core columns plus the resolved driver/unit joins. */
export interface DispatchLoad {
  id: string;
  ref: string;
  status: LoadStatus;
  equipment: string | null;
  commodity: string | null;
  hazmat: boolean;
  /** H-C1: the linked hazmat record's status ("draft" … "cleared"), null = none started. */
  hazmat_status?: string | null;
  total_miles: number | null;
  driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_name: string | null;
  vehicle_unit: string | null;
  trailer_unit: string | null;
  source: string;
  provider: string | null;
  submitted_at: string | null;
  declined_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  stops: DispatchStop[];
  /** LR-D3 (D-LMR7): the McLeod load's current dispatch, null when never dispatched or not McLeod. */
  last_dispatch?: LoadDispatchSummary | null;
  /** McLeod's movement status code (A/P/D/V) — shown in the status tooltip, never as the label. */
  external_status?: string | null;
  /** When the feed last wrote this load — the board's "McLeod as of". */
  external_synced_at?: string | null;
  dispatcher_external_id?: string | null;
  /** LR7: McLeod's dispatcher by name, or the McLeod id when the roster has not carried them yet. */
  dispatcher_name?: string | null;
}

/** A photo the driver captured at a stop. `url` is signed for 5 minutes; null means signing failed. */
export interface LoadPhoto {
  id: string;
  stop_id: string;
  slot: string;
  captured_at: string | null;
  uploaded_at: string;
  url: string | null;
}

/** A stop as the DETAIL read returns it — with what actually happened, not just what was planned. */
export interface DispatchStopDetail extends DispatchStop {
  id: string;
  status: string;
  arrived_at: string | null;
  completed_at: string | null;
  skip_reason: string | null;
  photos: LoadPhoto[];
}

/**
 * One load, everything about it. The list projection deliberately omits most of this — it is a board,
 * not a record. Every field below has been on the wire from the API for months; the list type simply
 * never declared them, which is why the office could not see who approved a load or what a driver
 * photographed at a stop.
 */
/** The hazmat record a load carries (H-C1) — state + newest outcome; the verdict stays in the workspace. */
export interface LinkedHazmatRecord {
  id: string;
  status: string;
  tank_state: string;
  created_at: string;
  updated_at: string;
  latest_outcome: string | null;
  latest_run_at: string | null;
}

export interface LoadDetail extends DispatchLoad {
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  released_at: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  decline_reason: string | null;
  external_id: string | null;
  updated_at: string;
  stops: DispatchStopDetail[];
  events: LoadEventRow[];
  hazmat_record: LinkedHazmatRecord | null;
  /** Every dispatch of this load, newest first — the first is the current one (D-LMR6). */
  dispatches: LoadDispatchSummary[];
}


export const loadsKey = ["dispatch", "loads"] as const;
/** Prefix for the per-load detail reads, so one invalidate covers every open load. */
export const loadKeyPrefix = ["dispatch", "load"] as const;

/** Every load in the org, all statuses, stops nested — the dispatch queue. */
export function useLoadsQuery() {
  return useQuery({
    queryKey: loadsKey,
    queryFn: async (): Promise<DispatchLoad[]> => {
      const res = await apiFetch<{ loads: DispatchLoad[] }>("/api/dispatch/loads");
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not load the dispatch board.");
      }
      return res.data.loads;
    },
  });
}

/** One row of a load's append-only `load_events` timeline (newest first), with the actor resolved. */
export interface LoadEventRow {
  id: string;
  kind: LoadEventKind;
  from_status: string | null;
  to_status: string | null;
  actor_role: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  recorded_at: string;
}

/**
 * One load with its stops, each stop's captured photos, and the full timeline (LD1).
 *
 * Before this existed the detail surface `.find()`-ed through the whole board, so it could not deep
 * link, could not refresh on its own, and went stale whenever the list query did.
 */
export function useLoadDetailQuery(loadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...loadKeyPrefix, loadId.value] as const),
    enabled: computed(() => loadId.value != null),
    queryFn: async (): Promise<LoadDetail> => {
      const res = await apiFetch<{ load: LoadDetail }>(`/api/dispatch/loads/${loadId.value}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load this load.");
      return res.data.load;
    },
  });
}

/** The timeline for one load — enabled only while a load is open in the detail panel. */
export function useLoadEvents(loadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["dispatch", "load-events", loadId.value] as const),
    enabled: computed(() => loadId.value != null),
    queryFn: async (): Promise<LoadEventRow[]> => {
      const res = await apiFetch<{ events: LoadEventRow[] }>(
        `/api/dispatch/loads/${loadId.value}/events`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the timeline.");
      return res.data.events;
    },
  });
}

/**
 * The board's queues (LR7): Active (default) · Uncovered · Delivered · All, from the owner's
 * 2026-09-23 list, plus Exceptions — the feed a driver's decline or a timed-out shift still raises,
 * which has no load row of its own and so cannot be a filter over the others. Which queue a load sits
 * in is `loadBoardState` in `@silvicom/shared`, the same rule that words its status, so the tab and
 * the badge can never disagree.
 */
export type QueueTab = LoadBoardQueue | "exceptions";

export const QUEUE_TABS: { value: QueueTab; label: string }[] = [
  ...LOAD_BOARD_QUEUES.map((q) => ({ value: q as QueueTab, label: LOAD_BOARD_QUEUE_LABELS[q] })),
  { value: "exceptions", label: "Exceptions" },
];

/** Is this load on this queue? All holds every load; a canceled one is in All only. */
export function inQueue(load: DispatchLoad, queue: LoadBoardQueue): boolean {
  return queue === "all" || loadBoardState(load).queue === queue;
}

export function statusLabel(status: LoadStatus): string {
  return LOAD_STATUS_LABELS[status];
}

// ── exceptions (L2 / D-L2) ────────────────────────────────────────────────────
const exceptionsKey = ["dispatch", "exceptions"] as const;

/**
 * Everything on the board that needs a person, from the server.
 *
 * Replaces `isException()`, which derived from `loads` columns and could therefore only ever see what
 * a load row holds — equipment mismatches and TMS amendments exist only as events.
 */
export function useExceptionsQuery() {
  return useQuery({
    queryKey: exceptionsKey,
    queryFn: async (): Promise<DispatchException[]> => {
      const res = await apiFetch<{ exceptions: DispatchException[] }>("/api/dispatch/exceptions");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load exceptions.");
      return res.data.exceptions;
    },
    refetchInterval: 60_000,
  });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { loadId: string; body: ResolveExceptionRequest }): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/loads/${payload.loadId}/exceptions/resolve`, {
        method: "POST",
        body: payload.body,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not resolve that exception.");
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: exceptionsKey }),
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}
