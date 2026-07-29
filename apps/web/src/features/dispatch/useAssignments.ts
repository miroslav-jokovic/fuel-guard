import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AssignmentRow } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * The dispatch duty board (Phase 3D / D49). Who is on duty, in what truck/trailer, for how long, and
 * the load they are actively working — read from `GET /api/dispatch/assignments`. The one write is
 * ending a shift a driver forgot to close, which frees their truck for the next driver (D44.5).
 */

const assignmentsKey = ["dispatch", "assignments"] as const;

export function useAssignmentsQuery() {
  return useQuery({
    queryKey: assignmentsKey,
    queryFn: async (): Promise<AssignmentRow[]> => {
      const res = await apiFetch<{ assignments: AssignmentRow[] }>("/api/dispatch/assignments");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the duty board.");
      return res.data.assignments;
    },
    // Duty state changes out-of-band as drivers check in/out — keep the board live without a reload.
    refetchInterval: 60_000,
  });
}

export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/assignments/${driverId}/end`, { method: "POST" });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not end the shift.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentsKey });
      qc.invalidateQueries({ queryKey: ["dispatch", "loads"] });
    },
  });
}
