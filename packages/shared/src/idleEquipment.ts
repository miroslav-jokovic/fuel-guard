import type { ApuType } from "./constants.js";

export interface IdleEquipmentSuggestion {
  apuType?: ApuType | null;
  hasOptimizedIdle?: boolean | null;
  /** Short chip label for the UI. */
  label: string;
  /** Why we suggest it — shown so the admin can sanity-check before applying. */
  reason: string;
}

/**
 * Suggest idle-reduction equipment from a vehicle's make/model/year. Deliberately CONSERVATIVE — only
 * high-confidence hints an admin confirms with one click (never auto-applied), so a wrong guess can't silently
 * skew scoring. Today: a modern Freightliner Cascadia ships with OEM "Optimized Idle". Returns null otherwise.
 */
export function suggestIdleEquipment(v: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
}): IdleEquipmentSuggestion | null {
  const model = (v.model ?? "").toLowerCase();
  const year = v.year ?? null;
  if (model.includes("cascadia") && (year == null || year >= 2017)) {
    return {
      hasOptimizedIdle: true,
      label: "Optimized idle",
      reason: "Freightliner Cascadia — OEM Optimized Idle is standard on this model.",
    };
  }
  return null;
}
