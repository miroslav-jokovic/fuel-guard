import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { DispatchBoardResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The dispatch board (DISPATCH-BOARD-PLAN DB5): every active truck as a row, read from
 * `GET /api/livemap/dispatch-board`. The server decides every verdict on a row (ETA, on time, flags,
 * scope); this page filters and sorts, and decides nothing.
 */
const boardKey = ["dispatch", "board"] as const;

export function useDispatchBoardQuery() {
  return useQuery({
    queryKey: boardKey,
    queryFn: async (): Promise<DispatchBoardResponse> => {
      const res = await apiFetch<{ ok: boolean; data: DispatchBoardResponse }>("/api/livemap/dispatch-board");
      if (!res.ok || !res.data?.data) throw new Error(res.error?.message ?? "Could not load the dispatch board.");
      return res.data.data;
    },
    // McLeod's loads sync every minute and the HOS clocks every five; a minute is the board's tempo.
    refetchInterval: 60_000,
  });
}

// ── Whose fleet is whose: the two office links (DB2) ─────────────────────────────────────────────

export interface DispatchLinksResponse {
  fleets: Array<{ code: string; dispatcherId: string | null }>;
  dispatchers: Array<{ id: string; name: string | null; isSystem: boolean; isActive: boolean; userId: string | null }>;
  people: Array<{ userId: string; fullName: string | null; email: string | null; role: string }>;
}

const linksKey = ["integrations", "mcleod", "dispatch-links"] as const;

export function useDispatchLinksQuery() {
  return useQuery({
    queryKey: linksKey,
    queryFn: async (): Promise<DispatchLinksResponse> => {
      const res = await apiFetch<DispatchLinksResponse>("/api/integrations/mcleod/dispatch-links");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the McLeod fleets.");
      return res.data;
    },
  });
}

/** Both links move a dispatcher's board, so a success refreshes the links and the board together. */
function useLinkMutation<V>(path: (v: V) => string, body: (v: V) => object) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V): Promise<void> => {
      const res = await apiFetch(path(v), { method: "PUT", body: body(v) });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save the link.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: linksKey });
      qc.invalidateQueries({ queryKey: boardKey });
    },
  });
}

export const useLinkFleet = () =>
  useLinkMutation<{ code: string; dispatcherId: string | null }>(
    (v) => `/api/integrations/mcleod/fleets/${encodeURIComponent(v.code)}`,
    (v) => ({ dispatcherId: v.dispatcherId }),
  );

export const useLinkDispatcherUser = () =>
  useLinkMutation<{ dispatcherId: string; userId: string | null }>(
    (v) => `/api/integrations/mcleod/dispatchers/${encodeURIComponent(v.dispatcherId)}/user`,
    (v) => ({ userId: v.userId }),
  );
