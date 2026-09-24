/**
 * The --service schedule (CA3, COLLECTOR-AUDIT-2026-09-24.md): which feed runs next, and when.
 *
 * Pure — no clock of its own, no I/O — so every promise in the letter to the carrier about cadence
 * is a unit test (`schedule.test.mjs`) rather than a hope. The loop that calls it lives in agent.mjs
 * and runs whatever is due ONE AT A TIME, so the carrier's server never sees two of our statements
 * at once.
 *
 * The cadences are the letter's, section 3. Changing one here changes what we told the carrier; the
 * letter and `review/SILVICOM-READ-ROUTINE.sql` must be updated in the same PR.
 */

import { TIME_ZONE, tzOffset, zonedToUtc } from "./centralTime.mjs";

export { TIME_ZONE }; // the carrier's clock; McLeod stores Central wall time (centralTime.mjs owns it)

/** In priority order: when several are due, the first listed runs first. */
export const JOBS = [
  { name: "loads", everyMs: 60_000 },
  { name: "close", everyMs: 10 * 60_000 },
  { name: "roster", everyMs: 15 * 60_000 },
  // Nightly, outside dispatch hours. A failed night retries every 30 minutes until it succeeds, rather
  // than waiting a whole day or hammering the server every tick.
  { name: "financial", dailyAtHour: 2, retryMs: 30 * 60_000 },
];

/** The UTC instant of a wall-clock hour in `tz` on a given local date. */
export function zonedHourToUtc(year, month, day, hour, tz = TIME_ZONE) {
  return zonedToUtc(year, month, day, hour, 0, 0, tz);
}

/** The most recent occurrence of `hour`:00 in `tz` at or before `now`. */
export function lastDailyAnchor(now, hour, tz = TIME_ZONE) {
  const local = new Date(now + tzOffset(now, tz)); // wall time, read through the UTC getters
  let anchor = zonedHourToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), hour, tz);
  if (anchor > now) {
    const y = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1));
    anchor = zonedHourToUtc(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate(), hour, tz);
  }
  return anchor;
}

/**
 * The names of the jobs due at `now`, in priority order.
 *
 * `runs[name] = { attemptedAt, succeededAt }` (epoch ms). An interval job is due once `everyMs` has
 * passed since its last ATTEMPT — a failing feed waits its normal interval, it is not retried hot.
 * A daily job is due when its last SUCCESS predates today's anchor, throttled by `retryMs`.
 */
export function dueJobs(now, runs = {}, jobs = JOBS) {
  const due = [];
  for (const job of jobs) {
    const r = runs[job.name] ?? {};
    if (job.everyMs) {
      if (r.attemptedAt == null || now - r.attemptedAt >= job.everyMs) due.push(job.name);
      continue;
    }
    const anchor = lastDailyAnchor(now, job.dailyAtHour);
    const doneToday = r.succeededAt != null && r.succeededAt >= anchor;
    const throttled = r.attemptedAt != null && r.attemptedAt >= anchor && now - r.attemptedAt < job.retryMs;
    if (!doneToday && !throttled) due.push(job.name);
  }
  return due;
}
