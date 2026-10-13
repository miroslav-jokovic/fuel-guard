import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { Ref } from "vue";
import type { MedstopOrderInput, MedstopOrderPlaced, MedstopOrderPreview, MedstopOrderablePerson, MedstopSite } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Ordering a Med-Stop test (MEDSTOP-PLAN.md §7A.4, UX3) — wraps `/api/drug-alcohol/order*`. The
 * preview is the api's own build of the payload; placing sends the same inputs, which the api
 * rebuilds with the same function, so what the drawer showed is what goes.
 */
export interface OrderContext {
  enabled: boolean;
  contactSet: boolean;
  people: MedstopOrderablePerson[];
}

const unwrap = async <T>(path: string, init: Parameters<typeof apiFetch>[1] | undefined, fallback: string): Promise<T> => {
  const res = await apiFetch<{ ok: true; data: T }>(path, init);
  if (!res.ok || !res.data) throw Object.assign(new Error(res.error?.message ?? fallback), { code: res.error?.code });
  return res.data.data;
};

export function useOrderContext(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ["drug-alcohol", "order", "context"],
    enabled,
    queryFn: () => unwrap<OrderContext>("/api/drug-alcohol/order/context", undefined, "Could not load who can be ordered a test"),
  });
}

export type SiteSearch = Pick<MedstopOrderInput, "service" | "requestDate" | "requestTime"> & ({ zip: string } | { driverId: string });

export async function searchSites(q: SiteSearch): Promise<{ sites: MedstopSite[]; near: string | null }> {
  const params = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
  return unwrap(`/api/drug-alcohol/order/sites?${params}`, undefined, "Could not search for collection sites");
}

export function useOrderPreview() {
  return useMutation({
    mutationFn: (input: MedstopOrderInput) =>
      unwrap<MedstopOrderPreview>("/api/drug-alcohol/order/preview", { method: "POST", body: input }, "Could not prepare the order"),
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MedstopOrderInput) =>
      unwrap<MedstopOrderPlaced>("/api/drug-alcohol/order", { method: "POST", body: input }, "Could not place the order"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drug-alcohol"] }),
  });
}
