/**
 * The buying-habits table's data (chunk 9a, Q-F2): the policy premiums as truck-months. The arithmetic
 * and the reasons are `buyingHabitsTable` in shared and `buyingHabitsRead.ts`; this only reads.
 *
 * An ERROR is a thrown query, which the table reports as unavailable and never as "no premiums paid".
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { BuyingHabitsTable } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import type { OpportunityParams } from "./useFuelOpportunities";

export function useBuyingHabitsQuery(params: Ref<OpportunityParams>) {
  return useQuery({
    queryKey: ["buying_habits", params],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async (): Promise<BuyingHabitsTable> => {
      const p = params.value;
      const q = new URLSearchParams({ from: p.from, to: p.to });
      if (p.vehicleIds.length) q.set("vehicles", p.vehicleIds.join(","));
      const res = await apiFetch<{ ok: boolean } & BuyingHabitsTable>(`/api/fueling/buying-habits?${q}`);
      if (!res.ok || !res.data?.ok) throw new Error(res.error?.message ?? "Could not read the buying habits");
      return { rows: res.data.rows, total: res.data.total, byKind: res.data.byKind };
    },
  });
}
