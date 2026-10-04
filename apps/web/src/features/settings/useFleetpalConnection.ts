import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { FleetpalConnectionStatus } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * The FleetPal connection — wraps `/api/integrations/fleetpal/*` (FLEETPAL-INTEGRATION-PLAN.md §8,
 * 2026-10-04). The key never comes back from the server, so nothing here holds one beyond the
 * mutation that sends it.
 */

const QUERY_KEY = ["fleetpal", "config"];

export function useFleetpalStatus() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<FleetpalConnectionStatus> => {
      const res = await apiFetch<FleetpalConnectionStatus>("/api/integrations/fleetpal/config");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the FleetPal connection");
      return res.data;
    },
  });
}

/** Store a key. The server asks FleetPal first and refuses a key FleetPal refuses. */
export function useSaveFleetpalKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string): Promise<void> => {
      const res = await apiFetch<{ ok: true }>("/api/integrations/fleetpal/key", {
        method: "POST",
        body: { apiKey },
      });
      if (!res.ok) throw apiRefusal(res.error, "Could not save the key");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useSetFleetpalEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<void> => {
      const res = await apiFetch<{ ok: true }>(
        `/api/integrations/fleetpal/${enabled ? "enable" : "disable"}`,
        { method: "POST" },
      );
      if (!res.ok) throw apiRefusal(res.error, enabled ? "Could not switch the sweep on" : "Could not switch the sweep off");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
