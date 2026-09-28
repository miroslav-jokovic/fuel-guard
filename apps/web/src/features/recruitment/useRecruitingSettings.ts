import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { RecruitingSettings, RecruitingSettingsView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The carrier's link lifetime and reminder (APPLICATION-FLOW-V2-PLAN.md S2, Q-AW41), on the recruitment
 * section's own door like the Representatives beside it on Settings → Recruiting.
 */
export const recruitingSettingsKey = ["recruitment", "settings"] as const;

export function useRecruitingSettings() {
  return useQuery({
    queryKey: recruitingSettingsKey,
    queryFn: async (): Promise<RecruitingSettingsView> => {
      const res = await apiFetch<RecruitingSettingsView>("/api/recruitment/settings");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the recruiting settings.");
      return res.data;
    },
  });
}

export function useSaveRecruitingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecruitingSettings): Promise<RecruitingSettingsView> => {
      const res = await apiFetch<RecruitingSettingsView>("/api/recruitment/settings", { method: "PUT", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the recruiting settings.");
      return res.data;
    },
    onSuccess: (view) => qc.setQueryData(recruitingSettingsKey, view),
  });
}
