/**
 * Fuel-level state (pure). Samsara's stats API returns RAW/UNSMOOTHED fuelPercent (audit §A), so we smooth it
 * ourselves with a rolling median, then convert to gallons on hand. Capacity uses the learned "effective"
 * value (max of nameplate vs observed max fill) so a truck that fills past its entered capacity isn't clipped.
 */
export interface FuelSample {
  time: string; // ISO
  value: number; // raw fuel percent 0-100
}

/** Rolling median of the most recent `window` raw fuel% samples (odd→middle, even→mean of two middles). */
export function smoothFuelPercent(samples: FuelSample[], window = 7): number | null {
  const vals = samples.filter((s) => Number.isFinite(s.value)).slice(-window).map((s) => s.value);
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Effective tank capacity: the learned observed max fill when it exceeds the entered nameplate, else nameplate. */
export function effectiveTankCapacityGal(tankCapacityGal: number, observedMaxFillGal?: number | null): number {
  return observedMaxFillGal != null && observedMaxFillGal > tankCapacityGal ? observedMaxFillGal : tankCapacityGal;
}

/** Gallons on hand = smoothed fuel% of the effective (full-tank) capacity. Null when no fuel reading. */
export function gallonsOnHand(smoothedPct: number | null, effectiveCapGal: number): number | null {
  return smoothedPct == null ? null : (Math.max(0, Math.min(100, smoothedPct)) / 100) * effectiveCapGal;
}
