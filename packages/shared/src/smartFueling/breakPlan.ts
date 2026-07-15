/**
 * FMCSA 30-minute break optimization for fuel stops (49 CFR 395.3(a)(3)(ii)): a driver must take a 30-min
 * break before accumulating 8 hours of driving, and a fueling stop of >=30 min satisfies it. So if a planned
 * fuel stop lands near where the break comes due, combining fuel + break saves the driver ~30 min of clock.
 * Pure + deterministic: given when the break is due (from Samsara HOS) and the route's average speed, we
 * translate the break to a mile marker and find the best fuel stop to pair it with.
 */

export const FUEL_BREAK_MINUTES = 30;

export interface BreakAdvice {
  /** Miles from the start when the 30-min break comes due (null if HOS break clock is unavailable). */
  breakDueMiles: number | null;
  breakDueHours: number | null;
  /** Index into the provided stop mileposts that best covers the break, or null if none is close enough. */
  coincidesStopIndex: number | null;
  /** Minutes saved by combining fuel + break (FUEL_BREAK_MINUTES when a stop coincides, else 0). */
  savesMinutes: number;
}

export interface BreakAdviceInput {
  /** Samsara clocks.break.timeUntilBreakDurationMs — ms of driving left before the break is required. */
  timeUntilBreakMs: number | null;
  /** Route average speed (route distance / drive time), mph. Used to place the break on the mile axis. */
  avgSpeedMph: number;
  /** milesAhead of each planned fuel stop, in order. */
  stopsMilesAhead: number[];
  /** How near a stop must be to the break-due mile to count as covering it. */
  windowMiles?: number;
}

/**
 * A stop covers the break when it is within `windowMiles` of the break-due point AND at/at-or-before it (a
 * driver may break early but not late). Among qualifying stops we pick the one closest to the break-due mile.
 */
export function breakFuelAdvice(input: BreakAdviceInput): BreakAdvice {
  const { timeUntilBreakMs, avgSpeedMph, stopsMilesAhead, windowMiles = 60 } = input;
  if (timeUntilBreakMs == null || !(avgSpeedMph > 0)) {
    return { breakDueMiles: null, breakDueHours: null, coincidesStopIndex: null, savesMinutes: 0 };
  }
  const breakDueHours = timeUntilBreakMs / 3_600_000;
  const breakDueMiles = breakDueHours * avgSpeedMph;

  let best: number | null = null;
  let bestDist = Infinity;
  stopsMilesAhead.forEach((m, i) => {
    // Allow a small overshoot (10 mi) past the break line for practicality, but favor at-or-before.
    if (m > breakDueMiles + 10) return;
    const d = Math.abs(m - breakDueMiles);
    if (d <= windowMiles && d < bestDist) {
      best = i;
      bestDist = d;
    }
  });

  return {
    breakDueMiles: Math.round(breakDueMiles * 10) / 10,
    breakDueHours: Math.round(breakDueHours * 10) / 10,
    coincidesStopIndex: best,
    savesMinutes: best != null ? FUEL_BREAK_MINUTES : 0,
  };
}
