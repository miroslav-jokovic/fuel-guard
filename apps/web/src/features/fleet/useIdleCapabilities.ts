import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export type IdleCapability = "apu" | "ecu_optimized" | "continuous_only" | "unknown";
export type CrossCheck = "agree" | "disagree" | "na";

export interface TruckIdleCapability {
  unit_number: string;
  /** Manual source of truth (Vehicles page): is the truck engine-off capable at rest (real APU)? */
  has_apu: boolean | null;
  /** Idle-reduction equipment detail (Vehicles page). */
  apu_type: string | null;
  /** OEM optimized idle recorded (Vehicles page). Distinct from has_apu. */
  has_optimized_idle: boolean | null;
  /** Learned from engine-state park sessions (cross-check only). */
  idle_capability: IdleCapability;
  idle_optimized_pct: number;
  /** Manual flag vs learned capability: do they agree? "na" when either side is unknown. */
  cross_check: CrossCheck;
}

/**
 * Compare the LEARNED behavior (from engine-state park sessions) against the RECORDED equipment, now that APU and
 * OEM optimized idle are separate manual flags. Each learned capability is checked against the flag it implies:
 * 'apu' ↔ has_apu, 'ecu_optimized' ↔ has_optimized_idle. 'continuous_only' means the truck showed no idle-
 * reduction in use, so a recorded APU or optimized idle is a mismatch worth a look. "na" when the relevant manual
 * flag is unset (nothing to compare).
 */
function crossCheck(
  hasApu: boolean | null,
  hasOptimizedIdle: boolean | null,
  learned: IdleCapability,
): CrossCheck {
  switch (learned) {
    case "unknown":
      return "na";
    case "apu":
      return hasApu == null ? "na" : hasApu ? "agree" : "disagree";
    case "ecu_optimized":
      return hasOptimizedIdle == null ? "na" : hasOptimizedIdle ? "agree" : "disagree";
    case "continuous_only":
      if (hasApu == null && hasOptimizedIdle == null) return "na";
      return hasApu === true || hasOptimizedIdle === true ? "disagree" : "agree";
  }
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
        .select(
          "unit_number, has_apu, apu_type, has_optimized_idle, idle_capability, idle_optimized_pct",
        )
        .neq("status", "retired");
      if (error) throw new Error(error.message);
      const rows = (
        (data ?? []) as {
          unit_number: string;
          has_apu: boolean | null;
          apu_type: string | null;
          has_optimized_idle: boolean | null;
          idle_capability: string | null;
          idle_optimized_pct: number | string | null;
        }[]
      ).map((v) => {
        const learned = (v.idle_capability ?? "unknown") as IdleCapability;
        return {
          unit_number: v.unit_number,
          has_apu: v.has_apu ?? null,
          apu_type: v.apu_type ?? null,
          has_optimized_idle: v.has_optimized_idle ?? null,
          idle_capability: learned,
          idle_optimized_pct: v.idle_optimized_pct == null ? 0 : Number(v.idle_optimized_pct),
          cross_check: crossCheck(v.has_apu ?? null, v.has_optimized_idle ?? null, learned),
        };
      });
      // Disagreements first (review queue), then lowest optimized-idle adoption.
      const rank = (c: CrossCheck) => (c === "disagree" ? 0 : c === "agree" ? 1 : 2);
      return rows.sort(
        (a, b) =>
          rank(a.cross_check) - rank(b.cross_check) || a.idle_optimized_pct - b.idle_optimized_pct,
      );
    },
    refetchInterval: 120_000,
  });
}
