import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { EmploymentGapCreate, EmploymentGapsView, RecordedEmploymentGap } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Employment gaps on the record after signing (HW5c, 0538): the applicant's explanations from the
 * signed application and the office's recorded ones, in one read (`employmentGaps.ts`).
 */
const gapsKey = (driverId: string) => ["recruitment", "employment-gaps", driverId] as const;
const path = (driverId: string) => `/api/recruitment/applicants/${driverId}/employment-gaps`;

export function useEmploymentGapsQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => gapsKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<EmploymentGapsView> => {
      const res = await apiFetch<EmploymentGapsView>(path(driverId.value));
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the gaps.");
      return res.data;
    },
  });
}

export function useRecordEmploymentGap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { driverId: string; gap: EmploymentGapCreate }): Promise<RecordedEmploymentGap> => {
      const res = await apiFetch<{ gap: RecordedEmploymentGap }>(path(input.driverId), { method: "POST", body: input.gap });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the gap.");
      return res.data.gap;
    },
    onSettled: (_r, _e, input) => void qc.invalidateQueries({ queryKey: gapsKey(input.driverId) }),
  });
}

export function useWithdrawEmploymentGap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { driverId: string; gapId: string }): Promise<RecordedEmploymentGap> => {
      const res = await apiFetch<{ gap: RecordedEmploymentGap }>(`${path(input.driverId)}/${input.gapId}/withdraw`, { method: "POST" });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not withdraw the gap.");
      return res.data.gap;
    },
    onSettled: (_r, _e, input) => void qc.invalidateQueries({ queryKey: gapsKey(input.driverId) }),
  });
}
