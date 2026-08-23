import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantDispositionCreate, ApplicantDispositionRow } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { pipelineKey } from "@/features/recruitment/useEmployment";

/**
 * Why an application ended without a hire (0238).
 *
 * ⚠ Recording one invalidates the PIPELINE as well as this list. The board carries the newest
 * decision per applicant, so a decline recorded on the driver's page that left the board unchanged
 * would send the next recruiter to chase somebody the carrier already turned down.
 */
const dispositionsKey = (driverId: string) => ["recruitment", "dispositions", driverId] as const;

export function useDispositionsQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => dispositionsKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicantDispositionRow[]> => {
      const res = await apiFetch<{ dispositions: ApplicantDispositionRow[] }>(
        `/api/recruitment/drivers/${driverId.value}/dispositions`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the decisions.");
      return res.data.dispositions;
    },
  });
}

export function useRecordDisposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ApplicantDispositionCreate): Promise<ApplicantDispositionRow> => {
      const res = await apiFetch<{ disposition: ApplicantDispositionRow }>(
        "/api/recruitment/dispositions",
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the decision.");
      return res.data.disposition;
    },
    onSuccess: (_row, body) => {
      void qc.invalidateQueries({ queryKey: dispositionsKey(body.driver_id) });
      void qc.invalidateQueries({ queryKey: pipelineKey });
    },
  });
}
