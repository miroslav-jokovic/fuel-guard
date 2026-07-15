/**
 * Fuel-level state (pure). Samsara's stats API returns RAW/UNSMOOTHED fuelPercent (audit §A), so we smooth it
 * ourselves with a rolling median, then convert to gallons on hand. Capacity uses the learned "effective"
 * value (max of nameplate vs observed max fill) so a truck that fills past its entered capacity isn't clipped.
 */
export interface FuelSample {
  time: string; // ISO
  value: number; // raw fuel percent 0-100
}

/**
 * Current fuel percent for PLANNING. Samsara's latest gauge reading is authoritative, so we trust it — but a
 * single uncorroborated jump (one bad sample) falls back to the median of recent samples. A real fill is a
 * LARGE, PERSISTENT step, so it corroborates within a sample or two and is reflected immediately. The old wide
 * rolling median lagged real fills badly — a truck that fueled an hour ago could still read near-empty because
 * most of the window was pre-fill, which then read as below-reserve and made the plan infeasible.
 */
export function currentFuelPercent(samples: FuelSample[]): number | null {
  const vals = samples.filter((s) => Number.isFinite(s.value)).map((s) => s.value);
  if (vals.length === 0) return null;
  const latest = vals[vals.length - 1]!;
  if (vals.length < 3) return latest;
  const prev = vals[vals.length - 2]!;
  // An upward jump can only come from fueling (a tank does not spontaneously rise) → trust it immediately,
  // so a just-fueled truck reads full even when samples are sparse.
  if (latest > prev + 5) return latest;
  // Steady / normal small drift → trust the current gauge.
  if (Math.abs(latest - prev) <= 5) return latest;
  // A downward jump could be a lone low glitch → robust median of recent samples rejects it (a real drop
  // corroborates on the next sample and is then reflected).
  const recent = vals.slice(-5);
  const sorted = [...recent].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** @deprecated use currentFuelPercent — kept as a thin alias so nothing breaks mid-refactor. */
export const smoothFuelPercent = currentFuelPercent;

/** Effective tank capacity: the learned observed max fill when it exceeds the entered nameplate, else nameplate. */
export function effectiveTankCapacityGal(tankCapacityGal: number, observedMaxFillGal?: number | null): number {
  return observedMaxFillGal != null && observedMaxFillGal > tankCapacityGal ? observedMaxFillGal : tankCapacityGal;
}

/** Gallons on hand = smoothed fuel% of the effective (full-tank) capacity. Null when no fuel reading. */
export function gallonsOnHand(smoothedPct: number | null, effectiveCapGal: number): number | null {
  return smoothedPct == null ? null : (Math.max(0, Math.min(100, smoothedPct)) / 100) * effectiveCapGal;
}
