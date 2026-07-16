import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { RouteFuelSettingsForm } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const COLS =
  "reserve_pct, mpg_safety_factor, emergency_fill_gallons, min_purchase_gal, corridor_miles, deviation_threshold_mi, price_ttl_hours, always_fill_full, fill_cap_pct, plan_def, preferred_brands, avoid_brands, emergency_brands, enabled_brands, avoid_states, fuel_before_states, default_height_in, default_length_in, default_width_in, default_axle_count, default_gross_weight_lb";

export type RouteFuelSettings = RouteFuelSettingsForm;

/** The org's planned-fueling settings (null → not configured yet; the UI shows defaults). */
export function useRouteFuelSettings() {
  return useQuery({
    queryKey: ["route_fuel_settings"],
    queryFn: async (): Promise<Partial<RouteFuelSettings> | null> => {
      const { data, error } = await supabase.from("route_fuel_settings").select(COLS).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Partial<RouteFuelSettings> | null) ?? null;
    },
    refetchInterval: 120_000,
  });
}

/** Save the org's planned-fueling settings (admin only, enforced by RLS). */
export function useSaveRouteFuelSettings() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (form: RouteFuelSettingsForm): Promise<void> => {
      if (!session.orgId) throw new Error("No active organization.");
      const { error } = await supabase
        .from("route_fuel_settings")
        .upsert({ org_id: session.orgId, ...form, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["route_fuel_settings"] }),
  });
}
