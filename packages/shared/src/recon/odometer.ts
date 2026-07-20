import { odometerAtTimeSourced, type OdometerSource, type SamsaraSample } from "../samsara/index.js";

/**
 * S3 — Odometer-at-fill module. The ONLY place the fueling-time odometer is read. Given the GPS/odometer
 * samples and the fill anchor, it interpolates/reconstructs the odometer AT that instant — but ONLY when the
 * caller certifies the anchor is trustworthy (a tank-rise, an at-station in-city stop, or GPS-confirmed
 * proximity). `trusted` is an explicit input, not derived here, so this module never depends on the location
 * or tank modules' internals — it just reads what it's told to. Pure.
 */
export interface OdometerReading {
  miles: number;
  /** The anchor instant the reading was taken at. */
  at: string;
  source: OdometerSource;
}

export function resolveOdometer(
  samples: SamsaraSample[],
  at: string | null,
  trusted: boolean,
  opts: { maxInterpGapMin?: number; maxReconstructGapMin?: number } = {},
): OdometerReading | null {
  if (!at || !trusted) return null;
  const reading = odometerAtTimeSourced(samples, at, {
    maxInterpGapMin: opts.maxInterpGapMin ?? 30,
    maxReconstructGapMin: opts.maxReconstructGapMin ?? 180,
  });
  return reading ? { miles: reading.miles, at, source: reading.source } : null;
}
