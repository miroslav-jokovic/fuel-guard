import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  ApplicantDispositionRow,
  ApplicantRequirement,
  ApplicantStage,
  EmploymentHistory,
  EmploymentHistoryCreate,
  EmploymentHistoryUpdate,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment` — the §391.21(b)(10) employment list (0208). */

/** Exported since U1: `useCreateApplicant` puts a row on this board without going through any
 *  mutation in this file, so it needs the key to invalidate. */
export const pipelineKey = ["recruitment", "pipeline"] as const;

/** One applicant, as the pipeline reports them. The stage is DERIVED server-side by the same pure
 *  function this app could call — never a stored column that can drift from the file. */
export interface PipelineApplicant {
  driver_id: string;
  full_name: string;
  applied_on: string;
  date_of_birth_recorded: boolean;
  employers: number;
  employers_in_window: number;
  cmv_employers: number;
  gap_days: number;
  stage: ApplicantStage;
  outstanding: ApplicantRequirement[];
  releases_complete: boolean;
  /**
   * The newest decision about this application, or null while it is still open (0238).
   *
   * ⚠ A decided applicant does NOT leave the board. They are still `status = applicant`, and taking
   * them off the list is what archiving does (0235) — a separate act, deliberately, because "we said
   * no" and "stop showing me this row" are different facts and a recruiter may want either without
   * the other.
   */
  disposition: ApplicantDispositionRow | null;
}
const historyKey = (driverId: string) => ["recruitment", "employment", driverId] as const;

/**
 * The applicant board. `archived` asks for the OTHER half of the same list (migration 0235) rather
 * than a second endpoint: the "Archived" chip is a filter over one set of people, and two endpoints
 * would let the two views drift in stage computation, ordering or columns.
 *
 * The flag is part of the query KEY, so switching the chip is a cache hit on the way back rather than
 * a refetch, and `useArchiveDriver` invalidating `pipelineKey` clears both halves at once.
 */
export function usePipelineQuery(archived?: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => [...pipelineKey, archived?.value === true] as const),
    queryFn: async (): Promise<PipelineApplicant[]> => {
      const res = await apiFetch<{ applicants: PipelineApplicant[] }>(
        `/api/recruitment/pipeline${archived?.value === true ? "?archived=true" : ""}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the pipeline.");
      return res.data.applicants;
    },
  });
}

export function useEmploymentHistoryQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => historyKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<EmploymentHistory[]> => {
      const res = await apiFetch<{ history: EmploymentHistory[] }>(
        `/api/recruitment/drivers/${driverId.value}/employment`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load employment history.");
      return res.data.history;
    },
  });
}

/** Every mutation invalidates the driver's list AND the pipeline — the pipeline's stage is derived
 *  from these rows, so a stale board would contradict the page you just edited. */
function useInvalidate() {
  const qc = useQueryClient();
  return (driverId: string) => {
    void qc.invalidateQueries({ queryKey: historyKey(driverId) });
    void qc.invalidateQueries({ queryKey: pipelineKey });
  };
}

export function useAddEmployment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: EmploymentHistoryCreate): Promise<EmploymentHistory> => {
      const res = await apiFetch<{ employment: EmploymentHistory }>("/api/recruitment/employment", {
        method: "POST",
        body: input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the employer.");
      return res.data.employment;
    },
    onSuccess: (_e, input) => invalidate(input.driver_id),
  });
}

export function useUpdateEmployment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (payload: {
      id: string;
      driverId: string;
      input: EmploymentHistoryUpdate;
    }): Promise<EmploymentHistory> => {
      const res = await apiFetch<{ employment: EmploymentHistory }>(
        `/api/recruitment/employment/${payload.id}`,
        { method: "PATCH", body: payload.input },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not update the employer.");
      return res.data.employment;
    },
    onSuccess: (_e, payload) => invalidate(payload.driverId),
  });
}

export function useRemoveEmployment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (payload: { id: string; driverId: string }): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/employment/${payload.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not remove the employer.");
    },
    onSuccess: (_e, payload) => invalidate(payload.driverId),
  });
}
