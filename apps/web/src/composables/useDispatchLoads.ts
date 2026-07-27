import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  approvalChecklist,
  canTransition,
  LOAD_STATUS_LABELS,
  type ApprovalChecklist,
  type AssignmentRow,
  type CreateLoadRequest,
  type LoadStatus,
  type LoadStop,
  type UpdateLoadRequest,
} from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * Dispatch loads (Phase 3D, D49). Reads and writes both go through the API rather than PostgREST:
 * every lifecycle move has to be an audited, named action with a `load_events` row, and a direct
 * table update would bypass that (the `loads_status_guard` trigger would still stop an illegal
 * transition, but the timeline would be silent about who did it).
 */

/** What the queue and the editor work with — a load plus its stops and resolved display names. */
export interface DispatchLoad {
  id: string;
  ref: string;
  status: LoadStatus;
  equipment: string | null;
  commodity: string | null;
  hazmat: boolean;
  total_miles: number | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  vehicle_unit: string | null;
  trailer_id: string | null;
  trailer_unit: string | null;
  source: string;
  provider: string | null;
  created_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  released_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  cancel_reason: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  stops: LoadStop[];
}

export interface LoadEvent {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  actor_role: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}

const loadsKey = ["dispatch", "loads"] as const;
const assignmentsKey = ["dispatch", "assignments"] as const;

export function useDispatchLoadsQuery() {
  return useQuery({
    queryKey: loadsKey,
    queryFn: async (): Promise<DispatchLoad[]> => {
      const res = await apiFetch<{ loads: DispatchLoad[] }>("/api/dispatch/loads");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load dispatch board");
      return res.data.loads;
    },
    refetchInterval: 60_000,
  });
}

export function useLoadEventsQuery(loadId: Ref<string | undefined>) {
  return useQuery({
    queryKey: computed(() => ["dispatch", "load-events", loadId.value] as const),
    enabled: computed(() => Boolean(loadId.value)),
    queryFn: async (): Promise<LoadEvent[]> => {
      const res = await apiFetch<{ events: LoadEvent[] }>(`/api/dispatch/loads/${loadId.value}/events`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the timeline");
      return res.data.events;
    },
  });
}

export function useAssignmentsQuery() {
  return useQuery({
    queryKey: assignmentsKey,
    queryFn: async (): Promise<AssignmentRow[]> => {
      const res = await apiFetch<{ assignments: AssignmentRow[] }>("/api/dispatch/assignments");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load assignments");
      return res.data.assignments;
    },
    refetchInterval: 30_000,
  });
}

/** Every write invalidates the queue; the assignments board shares the duty data a load touches. */
function useDispatchMutation<TVars, TData = { id: string }>(
  fn: (vars: TVars) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: loadsKey });
      void qc.invalidateQueries({ queryKey: assignmentsKey });
    },
  });
}

/** Surface the API's `detail` — the trigger's message names the exact unmet gate. */
async function post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) {
    const detail = (res as { detail?: string }).detail;
    throw new Error(detail ?? res.error?.message ?? "That did not work");
  }
  return res.data as T;
}

export function useCreateLoad() {
  return useDispatchMutation((input: CreateLoadRequest) => post<{ id: string }>("/api/dispatch/loads", input));
}

export function useUpdateLoad() {
  return useDispatchMutation((vars: { id: string; input: UpdateLoadRequest }) =>
    post<{ id: string }>(`/api/dispatch/loads/${vars.id}`, vars.input, "PATCH"),
  );
}

export function useAssignLoad() {
  return useDispatchMutation((vars: { id: string; driver_id: string; vehicle_id?: string | null; trailer_id?: string | null }) =>
    post<{ id: string }>(`/api/dispatch/loads/${vars.id}/assign`, {
      driver_id: vars.driver_id,
      vehicle_id: vars.vehicle_id ?? null,
      trailer_id: vars.trailer_id ?? null,
    }),
  );
}

export function useLoadTransition() {
  return useDispatchMutation(
    (vars: { id: string; action: "submit" | "approve" | "release" | "reject" | "cancel"; reason?: string }) =>
      post<{ id: string }>(
        `/api/dispatch/loads/${vars.id}/${vars.action}`,
        vars.reason === undefined ? undefined : { reason: vars.reason },
      ),
  );
}

export function useEndDutySession() {
  return useDispatchMutation((driverId: string) =>
    post<{ ok: true }>(`/api/dispatch/assignments/${driverId}/end`),
  );
}

// ── derived view state ────────────────────────────────────────────────────────
export type QueueTab = "needs_approval" | "approved" | "dispatched" | "active" | "delivered" | "exceptions";

export const QUEUE_TABS: { value: QueueTab; label: string }[] = [
  { value: "needs_approval", label: "Needs approval" },
  { value: "approved", label: "Approved" },
  { value: "dispatched", label: "Dispatched" },
  { value: "active", label: "Active" },
  { value: "delivered", label: "Delivered" },
  { value: "exceptions", label: "Exceptions" },
];

/** An exception is anything a human has to look at: a decline, or a load aging unapproved. */
export function isException(load: DispatchLoad, nowMs: number): boolean {
  if (load.declined_at) return true;
  if (load.status === "pending_approval") {
    return nowMs - Date.parse(load.created_at) > 24 * 3_600_000;
  }
  return false;
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

export function statusLabel(status: LoadStatus): string {
  return LOAD_STATUS_LABELS[status];
}

/** The checklist that gates Approve — named requirements, not a silent disabled button. */
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

/** Which buttons this load can offer right now, and why the others are unavailable. */
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
