import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HandoffSkip, HireApplicant } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/hire` — the Recruitment → DQF handoff (HIRING-PLAN.md H8). */

export interface HiringGap {
  key: string;
  label: string;
  citation: string;
}

export interface HirePreview {
  driverId: string;
  fullName: string;
  status: string;
  skipped: HandoffSkip[];
  outstanding: HiringGap[];
}

export interface HireResult {
  driverId: string;
  hireDate: string;
  filed: number;
  skipped: HandoffSkip[];
  outstanding: HiringGap[];
}

/**
 * What hiring would file, from the same function the hire runs.
 *
 * `enabled` rather than a fetch on open, because the answer changes whenever the employment rows do
 * — an inquiry dated after the drawer was last opened would otherwise show as still undated.
 */
export function useHirePreviewQuery(driverId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "hire-preview", driverId.value] as const),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<HirePreview> => {
      const res = await apiFetch<HirePreview>(`/api/recruitment/drivers/${driverId.value}/hire-preview`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read the file.");
      return res.data;
    },
  });
}

export function useHireApplicant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: HireApplicant): Promise<HireResult> => {
      const res = await apiFetch<HireResult>("/api/recruitment/hire", { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the hire.");
      return res.data;
    },
    /**
     * Both worlds are now stale, and that is the point of the feature: the applicant has left the
     * pipeline and a §391.51 file has appeared in Driver Qualification with records nobody typed.
     */
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recruitment"] });
      void qc.invalidateQueries({ queryKey: ["compliance"] });
      void qc.invalidateQueries({ queryKey: ["drivers"] });
    },
  });
}
