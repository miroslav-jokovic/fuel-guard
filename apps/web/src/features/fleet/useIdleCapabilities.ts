import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export type IdleCapability = "apu" | "ecu_optimized" | "continuous_only" | "unknown";
export type CrossCheck = "agree" | "disagree" | "na";

export interface TruckIdleCapability {
  unit_number: string;
  /** Manual source of truth (Vehicles page): does the truck have an APU / optimized-idle option? */
  has_apu: boolean | null;
  /** Learned from engine-state park sessions (cross-check only). */
  idle_capability: IdleCapability;
  idle_optimized_pct: number;
  /** Manual flag vs learned capability: do they agree? "na" when either side is unknown. */
  cross_check: CrossCheck;
}

/** Does the learned capability imply an idle-reduction option (APU or ECU auto start/stop)? */
function learnedHasOption(c: IdleCapability): boolean {
  return c === "apu" || c === "ecu_optimized";
}
function crossCheck(hasApu: boolean | null, learned: IdleCapability): CrossCheck {
  if (hasApu == null || learned === "unknown") return "na";
  return hasApu === learnedHasOption(learned) ? "agree" : "disagree";
}

/**
 * Every non-retired truck's idle capability: the MANUAL APU flag (source of truth) alongside the LEARNED
 * capability (cross-check), so an admin can see where telematics disagrees with the recorded equipment. Sorted
 * disagreements first (the review queue), then lowest optimized-idle. Shows all trucks — not just the ones the
 * learner could classify — so nothing is silently hidden (audit A1.1).
 */
export function useIdleCapabilities() {
  return useQuery({
    queryKey: ["idle_capabilities"],
    queryFn: async (): Promise<TruckIdleCapability[]> => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("unit_number, has_apu, idle_capability, idle_optimized_pct")
        .neq("status", "retired");
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as { unit_number: string; has_apu: boolean | null; idle_capability: string | null; idle_optimized_pct: number | string | null }[]).map(
        (v) => {
          const learned = (v.idle_capability ?? "unknown") as IdleCapability;
          return {
            unit_number: v.unit_number,
            has_apu: v.has_apu ?? null,
            idle_capability: learned,
            idle_optimized_pct: v.idle_optimized_pct == null ? 0 : Number(v.idle_optimized_pct),
            cross_check: crossCheck(v.has_apu ?? null, learned),
          };
        },
      );
      // Disagreements first (review queue), then lowest optimized-idle adoption.
      const rank = (c: CrossCheck) => (c === "disagree" ? 0 : c === "agree" ? 1 : 2);
      return rows.sort((a, b) => rank(a.cross_check) - rank(b.cross_check) || a.idle_optimized_pct - b.idle_optimized_pct);
    },
    refetchInterval: 120_000,
  });
}
