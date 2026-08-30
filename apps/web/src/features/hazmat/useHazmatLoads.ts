import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  HazmatUpdateLoadRequest,
  HazmatLoadRow,
  HazmatRunRow,
  HazmatRunsResponse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Load Workspace data layer (plan H5). Reads/writes go through the API (never PostgREST): every lifecycle
 * move is an audited, state-machine-enforced action, and analysis runs in-process server-side. The detail
 * view polls while a load is mid-analysis (`submitted`/`extracting`) and stops as soon as it settles.
 */
const loadsKey = ["hazmat", "loads"] as const;

/** Surface the API error `message`/`code` so illegal transitions name the exact unmet gate. */
async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) throw new Error(res.error?.message ?? "That did not work");
  return res.data as T;
}

const isAnalyzing = (status: string | undefined): boolean => status === "submitted" || status === "extracting";

export function useHazmatLoadQuery(id: Ref<string | undefined>) {
  return useQuery({
    queryKey: computed(() => [...loadsKey, "one", id.value] as const),
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<HazmatLoadRow> => call<HazmatLoadRow>(`/api/hazmat/loads/${id.value}`),
    // Poll while an analysis is in flight; stop the moment the status settles.
    refetchInterval: (q) => (isAnalyzing((q.state.data as HazmatLoadRow | undefined)?.status) ? 2_000 : false),
  });
}

export function useHazmatRunsQuery(id: Ref<string | undefined>, pollWhile: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => [...loadsKey, "runs", id.value] as const),
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<HazmatRunRow[]> => {
      const res = await call<HazmatRunsResponse>(`/api/hazmat/loads/${id.value}/runs`);
      return res.runs;
    },
    refetchInterval: () => (pollWhile.value ? 2_000 : false),
  });
}

function useLoadsMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: loadsKey });
      // Every lifecycle move here changes what the DISPATCH load shows — `HazmatPanel`'s status
      // rail, the board's hazmat chip, the readiness checklist. Those live under a different query
      // key, so without this the panel that STARTED the record kept rendering the state before the
      // move until something else happened to refetch it (H-C1's two surfaces, one record).
      void qc.invalidateQueries({ queryKey: ["dispatch", "load"] });
      void qc.invalidateQueries({ queryKey: ["dispatch", "loads"] });
    },
  });
}

/**
 * D-H23: correct a DRAFT record's declaration. The API refuses this on any other status
 * (`canEditLoad` in the shared state machine), which is the real gate — the UI only mirrors it so a
 * hidden editor is explained rather than a rejected save.
 */
export function useUpdateLoad() {
  return useLoadsMutation((vars: { id: string; patch: HazmatUpdateLoadRequest }) =>
    call<{ id: string }>(`/api/hazmat/loads/${vars.id}`, "PATCH", vars.patch),
  );
}

export function useSubmitLoad() {
  return useLoadsMutation((id: string) => call<{ status: string }>(`/api/hazmat/loads/${id}/submit`, "POST"));
}

export function useAnalyzeLoad() {
  return useLoadsMutation((id: string) => call<{ runId: string }>(`/api/hazmat/loads/${id}/analyze`, "POST"));
}

export function useCancelLoad() {
  return useLoadsMutation((vars: { id: string; reason: string }) =>
    call<{ status: string }>(`/api/hazmat/loads/${vars.id}/cancel`, "POST", { reason: vars.reason }),
  );
}

export { isAnalyzing };
