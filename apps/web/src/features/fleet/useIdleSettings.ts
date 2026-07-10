import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export interface IdleSettings {
  comfort_low_f: number;
  comfort_high_f: number;
  min_idle_minutes: number;
  suggested_low_f: number | null;
  suggested_high_f: number | null;
}

/** The org's idle comfort band + the learned (data-driven) suggestion. Read-only display. */
export function useIdleSettings() {
  return useQuery({
    queryKey: ["idle_settings"],
    queryFn: async (): Promise<IdleSettings | null> => {
      const { data, error } = await supabase
        .from("idle_settings")
        .select("comfort_low_f, comfort_high_f, min_idle_minutes, suggested_low_f, suggested_high_f")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const n = (v: number | string | null) => (v == null ? null : Number(v));
      return {
        comfort_low_f: Number(data.comfort_low_f),
        comfort_high_f: Number(data.comfort_high_f),
        min_idle_minutes: Number(data.min_idle_minutes),
        suggested_low_f: n(data.suggested_low_f),
        suggested_high_f: n(data.suggested_high_f),
      };
    },
    refetchInterval: 120_000,
  });
}
