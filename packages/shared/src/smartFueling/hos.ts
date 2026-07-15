/**
 * Hours-of-Service math (pure; FMCSA 49 CFR 395.3, audit-confirmed). Legal remaining DRIVING time is the
 * MINIMUM of the 11-h drive, 14-h shift, and 60/70-h cycle clocks — any can bind first. The 30-min break is a
 * mid-route SEGMENTER (a fuel stop of >=30 min satisfies it), tracked separately for stop placement, and does
 * not reduce total range. Team drivers alternate, so combined legal driving is the sum of each driver's remaining.
 */
import { hoursFromMs } from "./units.js";

export interface HosClocks {
  driveRemainingMs: number | null;
  shiftRemainingMs: number | null;
  cycleRemainingMs: number | null;
  timeUntilBreakMs: number | null;
}

/** Legal remaining driving time = min(drive, shift, cycle). Null when no clock is present. */
export function legalDriveMs(c: HosClocks): number | null {
  const vals = [c.driveRemainingMs, c.shiftRemainingMs, c.cycleRemainingMs].filter((x): x is number => x != null && x >= 0);
  return vals.length ? Math.min(...vals) : null;
}

/** Combined legal driving time for a team (drivers swap): sum of each driver's individually-legal remaining. */
export function combineTeamLegalDriveMs(driverClocks: HosClocks[]): number | null {
  const each = driverClocks.map(legalDriveMs).filter((x): x is number => x != null);
  return each.length ? each.reduce((a, b) => a + b, 0) : null;
}

/** Conservative reachable miles from legal driving time at a reserve-padded average speed (well below posted). */
export function hosReachableMiles(legalMs: number | null, avgSpeedMph = 55): number | null {
  return legalMs == null ? null : hoursFromMs(legalMs) * avgSpeedMph;
}
