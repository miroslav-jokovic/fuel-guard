import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Driver, DriverInput } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

const DRIVER_COLS =
  "id, org_id, user_id, full_name, employee_id, phone, status, samsara_driver_id, created_at, updated_at";

const driversKey = ["drivers"] as const;

export interface DriverSyncResult {
  total: number;
  created: number;
  updated: number;
}

/** Pull drivers from Samsara into the roster (admin). Matches by samsara id → phone → name. */
export function useSyncSamsaraDrivers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<DriverSyncResult> => {
      const res = await apiFetch<DriverSyncResult>("/api/integrations/samsara/sync-drivers", {
        method: "POST",
      });
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not sync drivers from Samsara");
      }
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

export function useDriversQuery() {
  return useQuery({
    queryKey: driversKey,
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase
        .from("drivers")
        .select(DRIVER_COLS)
        .order("full_name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Driver[];
    },
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DriverInput): Promise<Driver> => {
      const { data, error } = await supabase.from("drivers").insert(input).select(DRIVER_COLS).single();
      if (error) throw new Error(error.message);
      return data as Driver;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; input: DriverInput }): Promise<Driver> => {
      const { data, error } = await supabase
        .from("drivers")
        .update(payload.input)
        .eq("id", payload.id)
        .select(DRIVER_COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Driver;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

/** Assign (or clear) a driver on a vehicle, then refresh both lists. */
export function useAssignDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { vehicleId: string; driverId: string | null }): Promise<void> => {
      const { error } = await supabase
        .from("vehicles")
        .update({ assigned_driver_id: payload.driverId })
        .eq("id", payload.vehicleId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: driversKey });
    },
  });
}
