import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { MedstopApiKeyInput, MedstopConnectionStatus } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * The Med-Stop connection — wraps `/api/integrations/medstop/*` (MEDSTOP-PLAN.md §6, MS1). The key
 * never comes back from the server; nothing here holds one beyond the mutation that sends it.
 */

const QUERY_KEY = ["medstop", "config"];

export function useMedstopStatus() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<MedstopConnectionStatus> => {
      const res = await apiFetch<MedstopConnectionStatus>("/api/integrations/medstop/config");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the Med-Stop connection");
      return res.data;
    },
  });
}

/** Store a key. The server asks Med-Stop first, from its own address, and refuses a key Med-Stop refuses. */
export function useSaveMedstopKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MedstopApiKeyInput): Promise<void> => {
      const res = await apiFetch<{ ok: true }>("/api/integrations/medstop/key", { method: "POST", body: input });
      if (!res.ok) throw apiRefusal(res.error, "Could not save the key");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useSetMedstopEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<void> => {
      const res = await apiFetch<{ ok: true }>(`/api/integrations/medstop/${enabled ? "enable" : "disable"}`, { method: "POST" });
      if (!res.ok) throw apiRefusal(res.error, enabled ? "Could not switch the sweep on" : "Could not switch the sweep off");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
