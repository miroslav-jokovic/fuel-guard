import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Vehicle, VehicleInput } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export interface VehicleSyncResult {
  total: number;
  created: number;
  updated: number;
  assigned: number;
  needsCompletion: string[];
}

const VEHICLE_COLS =
  "id, org_id, unit_number, make, model, year, plate, vin, fuel_type, tank_capacity_gal, baseline_mpg, current_odometer, status, assigned_driver_id, samsara_vehicle_id, created_at, updated_at";

const vehiclesKey = ["vehicles"] as const;

/** List vehicles for the caller's org (RLS scopes rows). */
export function useVehiclesQuery() {
  return useQuery({
    queryKey: vehiclesKey,
    queryFn: async (): Promise<Vehicle[]> => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(VEHICLE_COLS)
        .order("unit_number", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Vehicle[];
    },
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleInput): Promise<Vehicle> => {
      const { data, error } = await supabase.from("vehicles").insert(input).select(VEHICLE_COLS).single();
      if (error) throw new Error(error.message);
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; input: VehicleInput }): Promise<Vehicle> => {
      const { data, error } = await supabase
        .from("vehicles")
        .update(payload.input)
        .eq("id", payload.id)
        .select(VEHICLE_COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
}

/** Pull powered vehicles (trucks) from Samsara into the fleet (admin). Auto-fills samsara_vehicle_id. */
export function useSyncSamsaraVehicles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<VehicleSyncResult> => {
      const res = await apiFetch<VehicleSyncResult>("/api/integrations/samsara/sync-vehicles", {
        method: "POST",
      });
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not sync vehicles from Samsara");
      }
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehiclesKey });
      qc.invalidateQueries({ queryKey: ["drivers"] });
    },
  });
}

/** Soft-delete: vehicles are retired, never hard-deleted while history exists (audit H5). */
export function useRetireVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("vehicles").update({ status: "retired" }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
}
