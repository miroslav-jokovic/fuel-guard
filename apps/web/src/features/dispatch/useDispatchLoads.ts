import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  approvalChecklist,
  canTransition,
  LOAD_STATUS_LABELS,
  type AssignLoadRequest,
  type ApprovalChecklist,
  type CreateLoadRequest,
  type LoadEventKind,
  type LoadStatus,
  type UpdateLoadRequest,
  type DispatchException,
  type ResolveExceptionRequest,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Dispatch load workspace (Phase 3D / D49) — the web write surface for the load lifecycle.
 *
 * Reads and every transition go through the built `/api/dispatch/*` endpoints, NOT direct PostgREST:
 * the lifecycle is guarded by the `loads_status_guard` trigger and each transition is its own audited
 * endpoint (D45), so the client never PATCHes a status. The API resolves the org + actor from the JWT.
 */

/** One stop as the dispatch list projection returns it (superset of what the editor sends back). */
export interface DispatchStop {
  id?: string;
  seq: number;
  kind: "pickup" | "dropoff";
  name: string;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  // Always present in the list projection — kept required so a load satisfies `ApprovableLoad`.
  appointment_start: string | null;
  appointment_end: string | null;
  required_photos: string[];
  notes?: string | null;
  status?: string;
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
}

export type LoadAction = "submit" | "approve" | "release" | "reject" | "cancel";

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
}


const loadsKey = ["dispatch", "loads"] as const;
/** Prefix for the per-load detail reads, so one invalidate covers every open load. */
const loadKeyPrefix = ["dispatch", "load"] as const;

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

export function useCreateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateLoadRequest): Promise<{ id: string }> => {
      const res = await apiFetch<{ id: string }>("/api/dispatch/loads", { method: "POST", body });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not create the load.");
      return res.data;
    },
    onSuccess: async () => {
      // Both: the board AND whichever detail page is open. Invalidating only the list is why an
      // action taken from a detail surface used to leave that surface showing the old state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}

export function useUpdateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; body: UpdateLoadRequest }): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/loads/${payload.id}`, {
        method: "PATCH",
        body: payload.body,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save the load.");
    },
    onSuccess: async () => {
      // Both: the board AND whichever detail page is open. Invalidating only the list is why an
      // action taken from a detail surface used to leave that surface showing the old state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}

/** Reassignment is its own action so the timeline shows who moved the load. */
export function useAssignLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; body: AssignLoadRequest }): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/loads/${payload.id}/assign`, {
        method: "POST",
        body: payload.body,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not assign the load.");
    },
    onSuccess: async () => {
      // Both: the board AND whichever detail page is open. Invalidating only the list is why an
      // action taken from a detail surface used to leave that surface showing the old state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}

/** submit · approve · release carry no body; reject · cancel require a reason. */
export function useTransitionLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; action: LoadAction; reason?: string }): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/loads/${payload.id}/${payload.action}`, {
        method: "POST",
        body: payload.reason ? { reason: payload.reason } : undefined,
      });
      if (!res.ok) {
        throw new Error(res.error?.message ?? "That step is not available for this load right now.");
      }
    },
    onSuccess: async () => {
      // Both: the board AND whichever detail page is open. Invalidating only the list is why an
      // action taken from a detail surface used to leave that surface showing the old state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}

export interface BulkResult {
  succeeded: number;
  failed: number;
}

/**
 * Approve / release many loads at once via the dedicated bulk endpoint. Each load still passes the SAME
 * per-row gate server-side; partial success is reported, never swallowed (D49). One request, not N.
 */
export function useBulkTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { ids: string[]; action: "approve" | "release" }): Promise<BulkResult> => {
      const res = await apiFetch<{ succeeded: number; failed: number }>("/api/dispatch/loads/bulk", {
        method: "POST",
        body: payload,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Bulk action failed.");
      return { succeeded: res.data.succeeded, failed: res.data.failed };
    },
    onSuccess: async () => {
      // Both: the board AND whichever detail page is open. Invalidating only the list is why an
      // action taken from a detail surface used to leave that surface showing the old state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
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

export type QueueTab = "needs_approval" | "approved" | "dispatched" | "active" | "delivered" | "exceptions";

export const QUEUE_TABS: { value: QueueTab; label: string }[] = [
  { value: "needs_approval", label: "Needs approval" },
  { value: "approved", label: "Approved" },
  { value: "dispatched", label: "Dispatched" },
  { value: "active", label: "Active" },
  { value: "delivered", label: "Delivered" },
  { value: "exceptions", label: "Exceptions" },
];

export function isException(load: DispatchLoad, nowMs: number): boolean {
  if (load.declined_at) return true;
  return load.status === "pending_approval" && nowMs - Date.parse(load.created_at) > 24 * 3_600_000;
}

export function tabFor(load: DispatchLoad): Exclude<QueueTab, "exceptions"> {
  switch (load.status) {
    case "draft":
    case "pending_approval":
      return "needs_approval";
    case "approved":
      return "approved";
    case "offered":
      return "dispatched";
    case "accepted":
    case "in_transit":
      return "active";
    default:
      return "delivered";
  }
}

export function checklistFor(load: DispatchLoad): ApprovalChecklist {
  return approvalChecklist({
    driver_id: load.driver_id,
    vehicle_id: load.vehicle_id,
    trailer_id: load.trailer_id,
    equipment: load.equipment,
    commodity: load.commodity,
    hazmat: load.hazmat,
    stops: load.stops,
  });
}

export function statusLabel(status: LoadStatus): string {
  return LOAD_STATUS_LABELS[status];
}

export function availableActions(load: DispatchLoad): {
  submit: boolean;
  approve: boolean;
  reject: boolean;
  release: boolean;
  cancel: boolean;
  approveBlockedBy: string[];
} {
  const checklist = checklistFor(load);
  return {
    submit: canTransition(load.status, "pending_approval"),
    approve: canTransition(load.status, "approved") && checklist.canApprove,
    reject: load.status === "pending_approval",
    release: canTransition(load.status, "offered"),
    cancel: canTransition(load.status, "canceled"),
    approveBlockedBy: checklist.blockers.map((b) => b.detail ?? b.label),
  };
}

// ── exceptions (L2 / D-L2) ────────────────────────────────────────────────────
const exceptionsKey = ["dispatch", "exceptions"] as const;

/**
 * Everything on the board that needs a person, from the server.
 *
 * Replaces `isException()`, which derived from `loads` columns and could therefore only ever see two
 * of the five sources — equipment mismatches, TMS amendments and post-release changes exist only as
 * events, so the tab that exists to show what needs attention was blind to three fifths of it.
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
