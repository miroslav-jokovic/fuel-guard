import { computed, toValue, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { CardFraudIncidentDetail, CardFraudIncidentTransition } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * One card-fraud incident, and moving it (F02-F04 chunks 8c2/8c3). Through the API only: the table is
 * deny-all to the browser (0438), and the API cuts the card to its last four.
 */
export function useCardFraudIncident(id: Ref<string | null>) {
  return useQuery({
    queryKey: ["card-fraud-incident", id],
    enabled: computed(() => !!toValue(id)),
    queryFn: async (): Promise<CardFraudIncidentDetail> => {
      const res = await apiFetch<{ ok: boolean; incident: CardFraudIncidentDetail }>(`/api/card-fraud-incidents/${toValue(id)}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the incident");
      return res.data.incident;
    },
  });
}

export function useCardFraudIncidentTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string } & CardFraudIncidentTransition): Promise<void> => {
      const { id, ...body } = v;
      const res = await apiFetch(`/api/card-fraud-incidents/${id}/transition`, { method: "POST", body });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not update the incident");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["card-fraud-incident"] });
      void qc.invalidateQueries({ queryKey: ["findings"] });
    },
  });
}
