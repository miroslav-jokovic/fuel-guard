/**
 * What the fuel-spend sweep PROMISES, in one place, because two modules need the same promise.
 *
 * `fuelSpendRollupScheduler.ts` keeps the promise; `fuelSweepFreshness.ts` judges whether it was
 * kept. If each held its own copy of the cadence, the judge could be recalibrated without the
 * scheduler moving — or, far more likely, the scheduler could be sped up or slowed down and the
 * judge would go on measuring against a number nobody remembered was there. The staleness threshold
 * below is therefore DERIVED from the cadence rather than chosen: see `SWEEP_STALE_AFTER_MS`.
 *
 * They live apart from both files only to avoid an import cycle between them (the scheduler calls
 * the freshness pass; the freshness pass needs the scheduler's cadence). Nothing else belongs here.
 */

/** How often the scheduler LOOKS. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How stale a sweep must be before it is redone.
 *
 * The gap between this and the check interval is what stops a daily cadence drifting later every
 * day: at a 6-hour check, a 24-hour due window would sweep every 24–30 hours and lose most of a day
 * a week. Twenty hours means the check that lands nearest each 24-hour mark is the one that fires.
 */
export const SWEEP_DUE_AFTER_MS = 20 * 60 * 60 * 1000;

/** Long enough that a boot storm during a deploy loop does not stampede the database. */
export const BOOT_DELAY_MS = 2 * 60 * 1000;

/** The trailing window each sweep rebuilds. Mirrored by `SPEND_REBUILD_DAYS` in `@silvicom/shared`. */
export const REBUILD_DAYS = 14;

/**
 * When a marker is old enough to be a FINDING rather than a sweep waiting its turn — derived, not
 * picked.
 *
 * A healthy org's marker is never older than `SWEEP_DUE_AFTER_MS + CHECK_INTERVAL_MS` at the moment
 * a check runs: the sweep becomes due at 20 hours and the next check is at most 6 hours after that,
 * so 26 hours is ordinary and says nothing. One more check interval on top means the sweep came due
 * and then TWO consecutive attempts did not complete it — a pattern, not a blip, and the exact
 * shape of the 2026-09-13 → 09-20 outage, which failed every six hours for seven days.
 *
 * A single failed attempt is not silent either; it files its own finding off the job row, which is
 * a different sentence with a different action ("it will retry") and so is not folded into this one.
 */
export const SWEEP_STALE_AFTER_MS = SWEEP_DUE_AFTER_MS + 2 * CHECK_INTERVAL_MS;

/**
 * Past this, the figures on the fuel pages are no longer "a bit behind" — a reader looking at a
 * month is looking at a month with days missing from its end, and the MPG clamp (queue item 2) is
 * silently shortening their window every time they load the page.
 */
export const SWEEP_CRITICAL_AFTER_MS = 72 * 60 * 60 * 1000;
