import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export interface TruckIdleCapability {
  unit_number: string;
  idle_capability: "apu" | "ecu_optimized" | "continuous_only" | "unknown";
  idle_optimized_pct: number;
}

/** Per-truck learned idle capability (from the engineStates park-session analysis), worst adoption first. */
export function useIdleCapabilities() {
  return useQuery({
    queryKey: ["idle_capabilities"],
    queryFn: async (): Promise<TruckIdleCapability[]> => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("unit_number, idle_capability, idle_optimized_pct")
        .not("idle_capability", "is", null);
      if (error) throw new Error(error.message);
      return ((data ?? []) as { unit_number: string; idle_capability: string; idle_optimized_pct: number | string | null }[])
        .map((v) => ({ unit_number: v.unit_number, idle_capability: v.idle_capability as TruckIdleCapability["idle_capability"], idle_optimized_pct: v.idle_optimized_pct == null ? 0 : Number(v.idle_optimized_pct) }))
        .sort((a, b) => a.idle_optimized_pct - b.idle_optimized_pct);
    },
    refetchInterval: 120_000,
  });
}
