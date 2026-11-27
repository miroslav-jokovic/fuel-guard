import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { CareersPageSave, CareersPageStatus } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * The carrier's public careers page — wraps `/api/recruitment/careers-page` (APPLY-PAGE-PLAN AP1): the handle its
 * address is built from, the switch, the accommodation contact, and which openings are on it.
 */

const PATH = "/api/recruitment/careers-page";
const QUERY_KEY = ["recruitment", "careers-page"];

export function useCareersPage() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<CareersPageStatus> => {
      const res = await apiFetch<CareersPageStatus>(PATH);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the careers page");
      return res.data;
    },
  });
}

/** Save the page. Switching ON answers 403 step-up until the password is given again. */
export function useSaveCareersPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CareersPageSave): Promise<void> => {
      const res = await apiFetch<{ ok: true }>(PATH, { method: "PUT", body: input });
      if (!res.ok) throw apiRefusal(res.error, "Could not save the careers page");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
