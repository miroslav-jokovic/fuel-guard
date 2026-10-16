import type { Ref } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { AssignmentHistoryResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The attribution trail is all that is left here. The duty board's list and its End shift write
 * (`useAssignmentsQuery`, `useEndShift`) were retired with their routes (DISPATCH-BOARD-PLAN.md
 * Q-DB10, ruled (b) 2026-10-16): no screen had read them since the Dispatch board replaced the
 * Assignments page (#1426), and production never opened a duty session for End shift to close.
 */

// ── the attribution trail (L5 / D-L6) ────────────────────────────────────────────────

export interface AssignmentHistoryFilters {
  /** Required, not defaulted server-side: an unbounded attribution query is a table scan. */
  from: string;
  to: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string;
}

export const HISTORY_PAGE_SIZE = 50;

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
