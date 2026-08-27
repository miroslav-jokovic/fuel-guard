import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Vehicle, VehicleInput } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";

const VEHICLE_COLS =
  "id, org_id, unit_number, make, model, year, plate, vin, fuel_type, tank_capacity_gal, tank_capacity_source, baseline_mpg, current_odometer, status, assigned_driver_id, samsara_vehicle_id, samsara_fuel_percent, samsara_fuel_at, samsara_missing_since, has_apu, apu_type, has_optimized_idle, idle_capability, created_at, updated_at";

/** WP-CAP provenance: a capacity typed through the app is a HUMAN entry — stamp it 'manual' so it's
 *  distinguishable from a learner self-heal ('auto'). The stamp is transparency, not a veto: a manual
 *  value that contradicts the sensor-measured capacity is still auto-corrected (audit-logged). */
const withCapacitySource = (
  input: VehicleInput,
): VehicleInput & { tank_capacity_source?: string } =>
  input.tank_capacity_gal != null ? { ...input, tank_capacity_source: "manual" } : input;

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
    // Surface background stats-sync updates (odometer / fuel level) without a manual reload.
    refetchInterval: 60_000,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleInput): Promise<Vehicle> => {
      const { data, error } = await supabase
        .from("vehicles")
        .insert(withCapacitySource(input))
        .select(VEHICLE_COLS)
        .single();
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
        .update(withCapacitySource(payload.input))
        .eq("id", payload.id)
        .select(VEHICLE_COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
}

// Samsara vehicle sync now runs as a background job (kind `sync_vehicles`) — the Vehicles page drives it
// via useBackgroundSync + the jobs ledger, so there's no inline-mutation hook here anymore (plan WQ1c).

/** Bulk-set idle-reduction capability (APU / Optimized-Idle) on many trucks at once. RLS scopes writes to the
 *  caller's org and to roles that manage the fleet. Only the provided keys are changed. */
export function useBulkUpdateVehicles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      ids: string[];
      patch: Partial<Pick<Vehicle, "has_apu" | "has_optimized_idle" | "apu_type">>;
    }): Promise<number> => {
      if (!payload.ids.length) return 0;
      const { error } = await supabase.from("vehicles").update(payload.patch).in("id", payload.ids);
      if (error) throw new Error(error.message);
      return payload.ids.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
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
