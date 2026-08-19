import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  EmploymentHistory,
  EmploymentHistoryCreate,
  EmploymentHistoryUpdate,
  RecruitmentRosterRow,
} from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment` — the §391.21(b)(10) employment list (0208). */

const rosterKey = ["recruitment", "roster"] as const;
const historyKey = (driverId: string) => ["recruitment", "employment", driverId] as const;

export function useRecruitmentRosterQuery() {
  return useQuery({
    queryKey: rosterKey,
    queryFn: async (): Promise<RecruitmentRosterRow[]> => {
      const res = await apiFetch<{ drivers: RecruitmentRosterRow[] }>("/api/recruitment/roster");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load recruitment.");
      return res.data.drivers;
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

/** Every mutation invalidates the driver's list AND the fleet roster — the roster's gap arithmetic
 *  is derived from these rows, so a stale roster would contradict the page you just edited. */
function useInvalidate() {
  const qc = useQueryClient();
  return (driverId: string) => {
    void qc.invalidateQueries({ queryKey: historyKey(driverId) });
    void qc.invalidateQueries({ queryKey: rosterKey });
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
