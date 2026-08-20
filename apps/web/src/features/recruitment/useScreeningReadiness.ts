import { useQuery } from "@tanstack/vue-query";
import type { ScreeningReadiness } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * `/api/recruitment/screening-readiness` — how much of the fleet could be screened at all (P0b).
 *
 * The key is deliberately under `["recruitment"]` AND invalidated by the driver mutations, because
 * this report is a projection of `drivers` rows: typing a date of birth on this very page changes
 * the answer, and a stale summary that still says "0 ready" while the operator has just fixed
 * fourteen of them is the version of this screen nobody would trust twice.
 */
export const screeningReadinessKey = ["recruitment", "screening-readiness"] as const;

export function useScreeningReadinessQuery() {
  return useQuery({
    queryKey: screeningReadinessKey,
    queryFn: async (): Promise<ScreeningReadiness> => {
      const res = await apiFetch<ScreeningReadiness>("/api/recruitment/screening-readiness");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load screening readiness.");
      return res.data;
    },
  });
}
