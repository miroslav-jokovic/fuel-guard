import { useQuery } from "@tanstack/vue-query";
import { purchaseBatchLabel, type BehavesLike, type IdleEquipmentRow } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export type IdleCapability = "apu" | "ecu_optimized" | "continuous_only" | "unknown";
export type CrossCheck = "agree" | "disagree" | "na";

export interface TruckIdleCapability {
  unit_number: string;
  /** The purchase batch in plain words (Q-IE7), or null for a truck with no purchase date yet. */
  batch: string | null;
  /** DECLARED equipment (owner's ruling or an office entry, `equipment_source`). */
  has_apu: boolean | null;
  apu_type: string | null;
  has_optimized_idle: boolean | null;
  equipment_source: string | null;
  /** EVIDENCE: the truck's long parks over 45 days, and what they look like (D-IE7). */
  behaves_like: BehavesLike;
  parks: number;
  idling_pct: number | null;
  off_pct: number | null;
  /** The 0043 learned capability — still read by the page's fleet optimized-idle figure until IE6. */
  idle_capability: IdleCapability;
  idle_optimized_pct: number;
  /**
   * Declared vs behaviour: "disagree" is the server's review flag; "na" when the evidence is mixed or
   * thin. A definite behaviour on a truck with nothing recorded is always a review there, so "agree"
   * needs no check of its own that something was recorded.
   */
  cross_check: CrossCheck;
}

/** The server's rows in the tab's shape: review first (the queue a person works), then by unit. */
export function shapeIdleEquipment(data: IdleEquipmentRow[]): TruckIdleCapability[] {
  const rows = data.map(
    (r): TruckIdleCapability => ({
      unit_number: r.unitNumber,
      batch: purchaseBatchLabel(r.batch),
      has_apu: r.hasApu,
      apu_type: r.apuType,
      has_optimized_idle: r.hasOptimizedIdle,
      equipment_source: r.equipmentSource,
      behaves_like: r.behavesLike,
      parks: r.parks,
      idling_pct: r.idlingPct,
      off_pct: r.offPct,
      idle_capability: (r.idleCapability ?? "unknown") as IdleCapability,
      idle_optimized_pct: r.idleOptimizedPct,
      cross_check: r.review
        ? "disagree"
        : r.behavesLike === "battery_apu" || r.behavesLike === "no_apu"
          ? "agree"
          : "na",
    }),
  );
  const rank = (c: CrossCheck) => (c === "disagree" ? 0 : c === "agree" ? 1 : 2);
  return rows.sort(
    (a, b) =>
      rank(a.cross_check) - rank(b.cross_check) ||
      a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }),
  );
}

/**
 * Every in-service truck's DECLARED idle equipment beside its long-park BEHAVIOUR, from
 * `GET /api/idle/equipment` (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1, D-IE7).
 *
 * This used to read `vehicles` from the browser and compare the 0043 learned capability with the
 * flags itself. The comparison now has one home — `needsEquipmentReview` in @silvicom/shared, run by
 * the server against 0403's service-role measurement — and this composable only shapes the answer.
 * Review first (the queue a person works), then by unit. Every truck is listed, so a truck with no
 * declaration or no parks is visible rather than silently missing (audit A1.1).
 */
export function useIdleCapabilities() {
  return useQuery({
    queryKey: ["idle_capabilities"],
    queryFn: async (): Promise<TruckIdleCapability[]> => {
      const res = await apiFetch<{ ok: boolean; data?: IdleEquipmentRow[]; error?: { message?: string } }>(
        "/api/idle/equipment",
      );
      if (!res.ok || !res.data?.ok || !res.data.data) {
        throw new Error(res.data?.error?.message ?? res.error?.message ?? "Could not read the trucks' idle equipment");
      }
      return shapeIdleEquipment(res.data.data);
    },
    refetchInterval: 300_000,
  });
}
