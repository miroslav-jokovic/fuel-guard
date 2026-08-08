/**
 * Trailers data layer. Lives in `composables/` rather than `features/fleet/` because seven
 * surfaces across four features read it — dispatch, hazmat, fuel and the fleet pages themselves.
 * `check-feature-boundaries` names promotion out of a feature as the intended fix for exactly
 * this shape, and the alternative (an entry in the ALLOW set) would have to be repeated for every
 * feature that needs a trailer list next.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { Trailer, TrailerInput } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const COLS =
  "id, org_id, unit_number, make, model, year, plate, trailer_type, is_reefer, reefer_tank_capacity_gal, status, assigned_vehicle_id, samsara_asset_id, created_at, updated_at";

const trailersKey = ["trailers"] as const;

export function useTrailersQuery() {
  return useQuery({
    queryKey: trailersKey,
    queryFn: async (): Promise<Trailer[]> => {
      const { data, error } = await supabase
        .from("trailers")
        .select(COLS)
        .order("unit_number", { ascending: true });
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
      const { data, error } = await supabase
        .from("trailers")
        .update(payload.input)
        .eq("id", payload.id)
        .select(COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Trailer;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trailersKey }),
  });
}

/** Bulk-update selected trailers (mark reefer, set tank capacity, change status). */
export function useBulkUpdateTrailers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      ids: string[];
      patch: Partial<Pick<Trailer, "is_reefer" | "reefer_tank_capacity_gal" | "status">>;
    }): Promise<number> => {
      if (!payload.ids.length) return 0;
      const { error } = await supabase.from("trailers").update(payload.patch).in("id", payload.ids);
      if (error) throw new Error(error.message);
      return payload.ids.length;
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

// Samsara trailer sync now runs as a background job (kind `sync_trailers`) — the Trailers page drives it
// via useBackgroundSync + the jobs ledger, so there's no inline-mutation hook here anymore (plan WQ1c).
