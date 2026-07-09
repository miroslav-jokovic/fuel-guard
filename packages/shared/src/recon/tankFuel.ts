import { tankPercentNear, reconcileTankFill, type TankReading } from "../samsara.js";

/**
 * S4 — Tank & fuel-level module. The ONLY place tank levels + the tank-fill reconciliation are computed.
 * Pure: given the parsed fuel-% readings, the fill anchor, the billed gallons, the tank capacity, and the
 * (optional) tank-rise event's post-fill %, it returns the before/after levels and the short/observed-rise.
 * No I/O, no other-signal dependencies.
 */
export interface TankFuelResult {
  /** Tank level (%) just before the fill — the reliable reading for the physical tank-space check. */
  pctBefore: number | null;
  /** Displayed tank level (%) just after the fill: the tank-rise event's after-% when present, else the
   *  post-fill plateau peak. */
  pctAfter: number | null;
  /** Observed tank rise across the fill, gallons (from the plateau — what actually settled in the tank). */
  observedRiseGal: number | null;
  /** Billed gallons minus observed rise, gallons (advisory). null = not measurable. */
  shortGal: number | null;
}

/** Milliseconds after the stop within which the tank is expected to have finished registering the fill. */
const POST_FILL_PLATEAU_MS = 3 * 3_600_000;

export function resolveTankFuel(
  fuelReadings: TankReading[],
  matchedAt: string | null,
  gallons: number | null,
  tankCapacityGal: number | null,
  tankRisePctAfter: number | null,
  trusted = true,
): TankFuelResult {
  // pctBefore is only meaningful when we have a REAL, trusted fill moment. Without one (no tank-rise
  // event and no matched stop → matchedAt null, or a weak anchor), reading the tank level at an
  // unverified/date-only time would compare the billed gallons against an unrelated tank level and
  // false-fire the physical tank-space check. In that case return no before-level (rule stays silent).
  if (fuelReadings.length === 0 || matchedAt == null || !trusted) {
    return { pctBefore: null, pctAfter: tankRisePctAfter, observedRiseGal: null, shortGal: null };
  }
  const before = tankPercentNear(fuelReadings, matchedAt, "before", 120);
  const pctBefore = before?.percent ?? null;
  // Post-fill level = the PEAK reading within a few hours after the stop (fueling takes time to register).
  const t = new Date(matchedAt).getTime();
  const plateauReadings = fuelReadings.filter((r) => {
    const rt = new Date(r.time).getTime();
    return rt >= t && rt - t <= POST_FILL_PLATEAU_MS;
  });
  const plateau = plateauReadings.length ? Math.max(...plateauReadings.map((r) => r.percent)) : null;

  // short / observed-rise are measured from the plateau (what settled in the tank), NOT the tank-rise
  // event's instantaneous after-% — preserving the previous inline behaviour exactly.
  const recon = reconcileTankFill({ gallonsBilled: gallons, pctBefore, pctAfter: plateau, tankCapacityGal });
  return {
    pctBefore,
    pctAfter: tankRisePctAfter ?? plateau, // tank-rise event wins for the DISPLAYED after-level
    observedRiseGal: recon?.observedRiseGal ?? null,
    shortGal: recon?.shortGal ?? null,
  };
}
