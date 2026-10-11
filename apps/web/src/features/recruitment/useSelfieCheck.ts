import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { SelfieCheck, SelfieVerdict } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The selfie beside the licence photo, and the office's reading of it (AW6, §6.7). The API signs both
 * photos for five minutes, so the read is never kept past that: `staleTime` stays well inside it, and
 * reopening the drawer asks again rather than showing a picture whose URL has lapsed.
 */
const path = (driverId: string) => `/api/recruitment/applicants/${encodeURIComponent(driverId)}/intake`;
export const selfieCheckKey = (driverId: string) => ["recruitment", "selfie", driverId] as const;

export function useSelfieCheckQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => selfieCheckKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    staleTime: 60_000,
    gcTime: 240_000,
    queryFn: async (): Promise<SelfieCheck> => {
      const res = await apiFetch<SelfieCheck>(`${path(driverId.value)}/selfie`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the photos.");
      return res.data;
    },
  });
}

export function useRecordSelfieVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { driverId: string; verdict: SelfieVerdict }) => {
      // ⚠ The object, never `JSON.stringify` — `apiFetch` serialises the body itself.
      const res = await apiFetch<{ verdict: SelfieVerdict; at: string }>(`${path(input.driverId)}/selfie-verdict`, {
        method: "POST",
        body: { verdict: input.verdict },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the reading.");
      return res.data;
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: selfieCheckKey(input.driverId) });
    },
  });
}
