import { daysInRange, type CalendarDay } from "./calendarDay.js";

/**
 * Is the Med-Stop connection about to stop, or has it? (MEDSTOP-PLAN §7A.20). Pure; the api's
 * scheduler asks it every hour and tells the admins, and Settings › Med-Stop warns from the same
 * first threshold, so the page and the notice never disagree about when "soon" begins.
 */

/**
 * D-MSUX21: the days before a key's expiry on which an admin is told — one notice per threshold per
 * key. The first is the warning window Settings › Med-Stop shows.
 */
export const MEDSTOP_KEY_NOTICE_DAYS = [30, 14, 7, 3, 1, 0] as const;

/**
 * D-MSUX22: how long without a successful sweep counts as stopped. The sweep runs hourly, so three
 * missed runs; past the Drug & Alcohol page's own two-hour caution, so the page warns first.
 */
export const MEDSTOP_SWEEP_STALE_HOURS = 3;

/**
 * The notice threshold the key has reached: the smallest of `MEDSTOP_KEY_NOTICE_DAYS` not below the
 * days left, so a tick that missed a day still sends the threshold it fell into. "expired" once the
 * day has passed; null when no expiry is recorded or it is further off than the first threshold.
 */
export function medstopKeyThreshold(expiresOn: CalendarDay | null, today: CalendarDay): number | "expired" | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return "expired";
  const daysLeft = daysInRange(today, expiresOn) - 1;
  const reached = MEDSTOP_KEY_NOTICE_DAYS.filter((t) => daysLeft <= t);
  return reached.length > 0 ? Math.min(...reached) : null;
}

/**
 * What is wrong with the sweep, if anything. `lastSyncedAt` is the last ATTEMPT (the handler stamps it
 * on success and failure alike), so a failed sweep is told by `lastError`, and a sweep that stopped
 * running altogether by the attempt's age. A connection never swept yet is not judged: its first sweep
 * is at most an hour away, and Settings › Med-Stop says "never".
 */
export function medstopSweepTrouble(
  lastSyncedAt: string | null,
  lastError: string | null,
  nowMs: number,
): "failed" | "stopped" | null {
  if (!lastSyncedAt) return null;
  if (lastError) return "failed";
  const at = Date.parse(lastSyncedAt);
  return Number.isFinite(at) && nowMs - at > MEDSTOP_SWEEP_STALE_HOURS * 3_600_000 ? "stopped" : null;
}
