import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type { TruckCostScheduleInput, TruckCostScheduleRow } from "@silvicom/shared";

/**
 * Truck fixed-cost schedule data layer (T1, TRUCK-COST-ATTRIBUTION-PLAN) — API-only like all of
 * accounting (D-SEP7). Mutations invalidate BOTH this list and the CPM report: a schedule edit
 * changes what the CPM page charges, and a stale report quoting the old lease is precisely the
 * silent imprecision this feature exists to remove.
 */
const KEY = ["accounting", "cost-schedules"] as const;

export function useCostSchedulesQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<TruckCostScheduleRow[]> => {
      const r = await apiFetch<{ schedules: TruckCostScheduleRow[] }>("/api/accounting/cost-schedules");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the cost schedule");
      return r.data.schedules;
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["accounting", "cpm"] });
  };
}

export function useCreateScheduleMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: TruckCostScheduleInput) => {
      const r = await apiFetch<{ schedule: TruckCostScheduleRow }>("/api/accounting/cost-schedules", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the schedule row");
      return r.data.schedule;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateScheduleMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TruckCostScheduleInput> }) => {
      const r = await apiFetch<{ schedule: TruckCostScheduleRow }>(`/api/accounting/cost-schedules/${id}`, {
        method: "PATCH",
        body: patch,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not update the schedule row");
      return r.data.schedule;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteScheduleMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch<Record<string, never>>(`/api/accounting/cost-schedules/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not delete the schedule row");
    },
    onSuccess: invalidate,
  });
}
