/**
 * The open fuel findings, one row per kind — what the Fuel Costs savings strip shows (FS-STRIP, Q-FSV15
 * ruling 1). The ranking and the API's reasons are in `summariseOpportunities` and
 * `findingsOpportunities.ts`; this only reads.
 *
 * An ERROR is a thrown query, which the strip reports as unavailable and never as "nothing is waiting".
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { FuelOpportunity } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export interface OpportunityParams {
  from: string;
  to: string;
  vehicleIds: string[];
}

export function useFuelOpportunitiesQuery(params: Ref<OpportunityParams>) {
  return useQuery({
    queryKey: ["fuel_opportunities", params],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async (): Promise<FuelOpportunity[]> => {
      const p = params.value;
      const q = new URLSearchParams({ from: p.from, to: p.to });
      if (p.vehicleIds.length) q.set("vehicles", p.vehicleIds.join(","));
      const res = await apiFetch<{ ok: boolean; rows: FuelOpportunity[] }>(`/api/fueling/findings/opportunities?${q}`);
      if (!res.ok || !res.data?.ok) throw new Error(res.error?.message ?? "Could not read the open findings");
      return res.data.rows;
    },
  });
}
