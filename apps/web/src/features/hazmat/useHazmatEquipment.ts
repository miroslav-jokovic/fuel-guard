import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";
import type { MaybeRefOrGetter } from "vue";

/**
 * Hazmat's read of the fleet's trailers (H-C2). The cargo-tank profile table, its API and its page
 * are gone — capacity and compartments live ON the trailer/vehicle rows (D-H3), entered on the
 * Trailers page when a trailer is marked `tanker` (D-H4). This is a minimal query kept inside the
 * hazmat feature to avoid importing the fleet feature's internals (the boundary rule).
 */
export interface TrailerOption {
  id: string;
  unit_number: string;
  /** Equipment type (D-H4) — what `resolveVehicleKind` reads to decide bulk vs non-bulk. */
  trailer_type: string | null;
  /** Cargo-tank capacity in gallons (H-C2) — null = unknown. */
  cargo_capacity_gal: number | null;
  cargo_compartments: Array<{ index: number; capacityGal: number }> | null;
}

export function useHazmatTrailersQuery(options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
  return useQuery({
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    queryKey: ["hazmat", "trailer-options"] as const,
    queryFn: async (): Promise<TrailerOption[]> => {
      const { data, error } = await supabase
        .from("trailers")
        .select("id, unit_number, trailer_type, cargo_capacity_gal, cargo_compartments")
        .order("unit_number", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TrailerOption[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
