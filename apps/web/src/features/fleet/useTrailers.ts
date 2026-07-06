import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Trailer, TrailerInput } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export interface TrailerSyncResult {
  total: number;
  created: number;
  updated: number;
  paired: number;
}

const COLS =
  "id, org_id, unit_number, make, model, year, plate, reefer_tank_capacity_gal, status, assigned_vehicle_id, samsara_asset_id, created_at, updated_at";

const trailersKey = ["trailers"] as const;

export function useTrailersQuery() {
  return useQuery({
    queryKey: trailersKey,
    queryFn: async (): Promise<Trailer[]> => {
      const { data, error } = await supabase.from("trailers").select(COLS).order("unit_number", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Trailer[];
    },
    refetchInterval: 60_000,
  });
}

export function useCreateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TrailerInput): Promise<Trailer> => {
      const { data, error } = await supabase.from("trailers").insert(input).select(COLS).single();
      if (error) throw new Error(error.message);
      return data as Trailer;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trailersKey }),
  });
}

export function useUpdateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; input: TrailerInput }): Promise<Trailer> => {
      const { data, error } = await supabase.from("trailers").update(payload.input).eq("id", payload.id).select(COLS).single();
      if (error) throw new Error(error.message);
      return data as Trailer;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trailersKey }),
  });
}

export function useRetireTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("trailers").update({ status: "retired" }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trailersKey }),
  });
}

export function useSyncSamsaraTrailers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TrailerSyncResult> => {
      const res = await apiFetch<TrailerSyncResult>("/api/integrations/samsara/sync-trailers", { method: "POST" });
      if (res.status === 409) throw new Error("A trailer sync is already running — it'll finish shortly.");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not sync trailers from Samsara");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trailersKey }),
  });
}
