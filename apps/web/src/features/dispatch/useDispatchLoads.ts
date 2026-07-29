import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  AssignLoadRequest,
  CreateLoadRequest,
  LoadStatus,
  UpdateLoadRequest,
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
