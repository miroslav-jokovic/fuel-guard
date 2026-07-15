/**
 * Fuel consumption + weight model (pure). Range is NOT miles-only: the reefer (and idling) burn gallons while
 * adding no miles (audit C3/H10), so range accounts for reefer burn while driving. MPG is always DERATED by a
 * safety factor — never plan on optimistic MPG. reeferGalPerHour is an ESTIMATE pending calibration (Phase 7);
 * set it to 0 for a dry van or a reefer known to be off.
 */
export const DIESEL_LB_PER_GAL = 7.05;
/** Default idle burn (matches idleScoring) and a mid-range reefer burn — both overridable + to be calibrated. */
export const DEFAULT_IDLE_GAL_PER_HOUR = 0.8;
export const DEFAULT_REEFER_GAL_PER_HOUR = 0.75;

export interface BurnModel {
  effMpg: number;
  idleGalPerHour: number;
  reeferGalPerHour: number;
}

/** Derated MPG for feasibility: baseline × safety factor (fallback when baseline is missing). */
export function effectiveMpg(baselineMpg: number | null | undefined, safetyFactor: number, fallbackMpg = 6): number {
  const base = baselineMpg && baselineMpg > 0 ? baselineMpg : fallbackMpg;
  return base * safetyFactor;
}

/** Gallons burned over a leg: driving + reefer(hours) + idle(hours). */
export function legBurnGal(miles: number, driveHours: number, idleHours: number, m: BurnModel): number {
  return miles / m.effMpg + driveHours * m.reeferGalPerHour + idleHours * m.idleGalPerHour;
}

/** How far `gallons` take the truck, counting reefer burn WHILE driving (gal/mi = 1/mpg + reeferGph/speed). */
export function rangeMilesOnGallons(gallons: number, m: BurnModel, avgSpeedMph = 55): number {
  const galPerMile = 1 / m.effMpg + (avgSpeedMph > 0 ? m.reeferGalPerHour / avgSpeedMph : 0);
  return galPerMile > 0 ? Math.max(0, gallons) / galPerMile : 0;
}

/** Gallons that can be added without exceeding the legal gross weight (0 when already at/over the cap). */
export function weightLegalFillGal(currentGrossLb: number, maxGrossLb: number, lbPerGal = DIESEL_LB_PER_GAL): number {
  return Math.max(0, (maxGrossLb - currentGrossLb) / lbPerGal);
}
