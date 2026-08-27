import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  HazmatClearRequest,
  HazmatDocumentRow,
  HazmatDocumentsResponse,
  HazmatLoadRow,
  HazmatLoadsListResponse,
  HazmatReviewRequest,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Review queue + attestation data layer (plan H7). The review/clear endpoints (H4) are the real fail-closed
 * enforcement; these composables just drive the UX. Clearing is refused server-side on a provisional dataset
 * and by RLS for non-review roles — the web mirror only avoids showing an action the user can't take.
 */
const reviewKey = ["hazmat", "review"] as const;
const loadsKey = ["hazmat", "loads"] as const;

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) throw new Error(res.error?.message ?? "That did not work");
  return res.data as T;
}

/** Loads awaiting review, oldest-first (longest-waiting at the top — the order to work them). */
export function useReviewQueueQuery() {
  return useQuery({
    queryKey: [...reviewKey, "queue"] as const,
    queryFn: async (): Promise<HazmatLoadRow[]> => {
      // Server-side oldest-first (order=asc) — correct beyond the first page, unlike a client sort of a DESC page.
      const res = await call<HazmatLoadsListResponse>("/api/hazmat/loads?status=needs_review&order=asc&limit=100");
      return res.loads;
    },
    refetchInterval: 30_000,
  });
}

/** Count of loads awaiting review — drives the nav badge. Gated by `enabled` (module + view access). */
export function useHazmatReviewCountQuery(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [...reviewKey, "count"] as const,
    enabled,
    queryFn: async (): Promise<number> => (await call<{ count: number }>("/api/hazmat/review-count")).count,
    refetchInterval: 60_000,
  });
}

export function useLoadDocumentsQuery(id: Ref<string | undefined>) {
  return useQuery({
    queryKey: computed(() => [...reviewKey, "docs", id.value] as const),
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<HazmatDocumentRow[]> => {
      const res = await call<HazmatDocumentsResponse>(`/api/hazmat/loads/${id.value}/documents`);
      return res.documents;
    },
  });
}

function useReviewMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKey });
      void qc.invalidateQueries({ queryKey: loadsKey });
    },
  });
}

export function useRecordReview() {
  return useReviewMutation((vars: { loadId: string; body: HazmatReviewRequest }) =>
    call<{ ok: true; status?: string }>(`/api/hazmat/loads/${vars.loadId}/review`, "POST", vars.body),
  );
}

export function useClearLoad() {
  return useReviewMutation((vars: { loadId: string; body: HazmatClearRequest }) =>
    call<{ status: string }>(`/api/hazmat/loads/${vars.loadId}/clear`, "POST", vars.body),
  );
}
