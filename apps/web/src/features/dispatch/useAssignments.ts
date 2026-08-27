import type { Ref } from "vue";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AssignmentHistoryResponse, AssignmentRow } from "@silvicom/shared";
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
      if (!res.ok || !res.data)
        throw new Error(res.error?.message ?? "Could not load the duty board.");
      return res.data.assignments;
    },
    // Duty state changes out-of-band as drivers check in/out — keep the board live without a reload.
    refetchInterval: 60_000,
  });
}

export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    /**
     * Keyed on the SESSION, not the driver (L5). The board is refetched every sixty seconds, so a
     * driver who signs off and checks into another truck inside that window would otherwise have
     * their NEW shift closed by a click on a stale row — silently, and reported as success.
     */
    mutationFn: async (sessionId: string): Promise<void> => {
      const res = await apiFetch(`/api/dispatch/assignments/${sessionId}/end`, { method: "POST" });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not end the shift.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentsKey });
      qc.invalidateQueries({ queryKey: ["dispatch", "loads"] });
    },
  });
}

// ── the attribution trail (L5 / D-L6) ────────────────────────────────────────────────

export interface AssignmentHistoryFilters {
  /** Required, not defaulted server-side: an unbounded attribution query is a table scan. */
  from: string;
  to: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string;
}

const HISTORY_PAGE_SIZE = 50;

/**
 * Keyset pages, accumulated. `TablePagination` is deliberately not used here and this is the one
 * place in the app where that is right: page numbers need a total, and the endpoint has none — a
 * `count: exact` over an attribution table is the scan the date range exists to avoid. So the footer
 * offers "Load more" and the count shown is "N loaded", never a fabricated total.
 */
export function useAssignmentHistoryQuery(filters: Ref<AssignmentHistoryFilters>) {
  return useInfiniteQuery({
    queryKey: ["dispatch", "assignment-history", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<AssignmentHistoryResponse> => {
      const f = filters.value;
      const params = new URLSearchParams({
        from: f.from,
        to: f.to,
        limit: String(HISTORY_PAGE_SIZE),
      });
      if (f.driverId) params.set("driverId", f.driverId);
      if (f.vehicleId) params.set("vehicleId", f.vehicleId);
      if (f.trailerId) params.set("trailerId", f.trailerId);
      if (pageParam) params.set("cursor", pageParam);

      const res = await apiFetch<AssignmentHistoryResponse>(
        `/api/dispatch/assignments/history?${params}`,
      );
      if (!res.ok || !res.data)
        throw new Error(res.error?.message ?? "Could not load the assignment history.");
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // History is a record of what already happened; polling it would be a request per minute for an
    // answer that cannot change.
    staleTime: 60_000,
  });
}
