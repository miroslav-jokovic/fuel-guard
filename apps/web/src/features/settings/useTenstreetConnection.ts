import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { TenstreetConnectionSave, TenstreetConnectionStatus, TenstreetKeyIssued } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * The Tenstreet connection — wraps `/api/recruitment/tenstreet/connection` (TENSTREET-INTAKE-PLAN TS4). The URL's
 * secret comes back once, from `useRotateTenstreetKey`, and is held only by the card that shows it; the status never
 * carries it (the server stores its fingerprint).
 */

const PATH = "/api/recruitment/tenstreet/connection";
const QUERY_KEY = ["recruitment", "tenstreet", "connection"];

export function useTenstreetConnection() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<TenstreetConnectionStatus> => {
      const res = await apiFetch<TenstreetConnectionStatus>(PATH);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the Tenstreet connection");
      return res.data;
    },
  });
}

/** Save the Company ID, the mode and the switch. Switching ON answers 403 step-up until the password is given again. */
export function useSaveTenstreetConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TenstreetConnectionSave): Promise<void> => {
      const res = await apiFetch<{ ok: true }>(PATH, { method: "PUT", body: input });
      if (!res.ok) throw apiRefusal(res.error, "Could not save the Tenstreet settings");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** A new address. Always asks for the password again; the old address stops working at once. */
export function useRotateTenstreetKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TenstreetKeyIssued> => {
      const res = await apiFetch<TenstreetKeyIssued>(`${PATH}/rotate-key`, { method: "POST" });
      if (!res.ok || !res.data) throw apiRefusal(res.error, "Could not make a new address");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
