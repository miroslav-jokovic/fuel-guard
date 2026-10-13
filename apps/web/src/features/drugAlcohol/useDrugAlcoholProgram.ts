import { useQuery } from "@tanstack/vue-query";
import type { DrugAlcoholProgram } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** Safety › Drug & Alcohol's one read (MEDSTOP-PLAN.md §6 F-1/F-2). The mirror changes hourly at most. */
export function useDrugAlcoholProgram() {
  return useQuery({
    queryKey: ["drug-alcohol", "program"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DrugAlcoholProgram> => {
      const res = await apiFetch<{ ok: true; data: DrugAlcoholProgram }>("/api/drug-alcohol/program");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the drug and alcohol program");
      return res.data.data;
    },
  });
}
