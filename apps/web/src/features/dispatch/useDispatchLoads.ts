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
} from "@fuelguard/shared";
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

const loadsKey = ["dispatch", "loads"] as const;

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
    onSuccess: () => qc.invalidateQueries({ queryKey: loadsKey }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: loadsKey }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: loadsKey }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: loadsKey }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: loadsKey }),
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
