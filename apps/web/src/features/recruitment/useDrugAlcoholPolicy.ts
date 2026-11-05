import { useQuery } from "@tanstack/vue-query";
import type { DrugAlcoholPolicyInfo } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Which text of the carrier's drug-and-alcohol policy is in use (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2,
 * DAP2's office preview). The version is the API's — a hash of what prints — so the card reads it rather than
 * carrying a copy that would go stale the next time a correction lands (D-DAP6). It changes only with a
 * deploy, so it is never refetched in the background.
 */
export const DRUG_ALCOHOL_POLICY_PREVIEW_PATH = "/api/recruitment/drug-alcohol-policy/preview.pdf";

export function useDrugAlcoholPolicy() {
  return useQuery({
    queryKey: ["recruitment", "drug-alcohol-policy"] as const,
    staleTime: Infinity,
    queryFn: async (): Promise<DrugAlcoholPolicyInfo> => {
      const res = await apiFetch<{ policy: DrugAlcoholPolicyInfo }>("/api/recruitment/drug-alcohol-policy");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the policy.");
      return res.data.policy;
    },
  });
}
