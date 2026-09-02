/**
 * When the spend figures in this window were last derived (FUEL-T5, A6, D-FUI18).
 *
 * ── THE PROBLEM, MEASURED ──────────────────────────────────────────────────────────────────────
 * `fuel_spend_days` is a rollup, and its scheduler rebuilds only the trailing `REBUILD_DAYS = 14`.
 * Everything older was derived once, on the day the rollup shipped, and has never been re-derived
 * through any correction since. Measured in production 2026-09-01: **29,114 rows whose `updated_at`
 * all fall between 2026-08-25 and 2026-08-31** — so a reader asking for March gets figures built in
 * August from whatever the data looked like then, and the page says nothing at all about it.
 *
 * That is not a rebuild-policy problem to fix here. A rollup that only rebuilds a trailing window is a
 * reasonable design; a rollup that does so **silently** is not. A6 is a labelling fix, and this is the
 * label. (Whether `REBUILD_DAYS` should change at all is Q-FUI9, deliberately left to the owner.)
 *
 * ── WHY THE OLDEST BUILD IN THE WINDOW, AND NOT THE NEWEST ─────────────────────────────────────
 * A window spanning the rebuild boundary contains rows built last night AND rows built in August. The
 * newest would describe the freshest corner of the answer and flatter the rest; the average would
 * describe nothing that exists. **The oldest is the only one that is a promise**: every figure in this
 * window is at least this current. It is the same choice `readSamsaraWebhookStatus` makes about an
 * all-time denominator, and for the same reason — a freshness figure whose scope hides the stale part
 * is worse than none.
 *
 * ── PURE, SO THE PAGE AND THE PDF CANNOT DISAGREE ──────────────────────────────────────────────
 * `fuelSpendReport.ts` already carries a scar about this: its price-line query drifted from the
 * screen's, so the document said "no fill could be matched to a posted price" while the page beside it
 * measured 1,201 of them. Both surfaces call this function, so the sentence they print is the same
 * sentence.
 */

/** The trailing window the rollup scheduler rebuilds. Mirrors `REBUILD_DAYS` in the API scheduler. */
export const SPEND_REBUILD_DAYS = 14;

export interface RollupFreshness {
  /** Oldest `fuel_spend_days.updated_at` in the window, ISO, or null when the window holds no rows. */
  builtAt: string | null;
  /** Whole days between that build and `now`. Null when nothing was built. */
  ageDays: number | null;
  /**
   * True when the oldest build predates the rebuild window, i.e. some figure here has not been
   * re-derived since it was first written and no correction has reached it.
   */
  stale: boolean;
  /** One sentence, plain word first. Null when there is nothing to qualify. */
  lead: string | null;
  /**
   * The same fact in a few words, for a document's meta block where a sentence does not fit. Carries
   * the warning too — a compact form that drops the stale flag would be the shorter, wronger half.
   */
  short: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param oldestBuiltAt oldest `updated_at` among the rows the surface is about to render
 * @param now           evaluation instant, passed in so this stays pure and testable
 */
export function describeRollupFreshness(
  oldestBuiltAt: string | null | undefined,
  now: Date,
  rebuildDays: number = SPEND_REBUILD_DAYS,
): RollupFreshness {
  const empty = { builtAt: null, ageDays: null, stale: false, lead: null, short: null };
  if (!oldestBuiltAt) return empty;
  const t = Date.parse(oldestBuiltAt);
  if (!Number.isFinite(t)) return empty;

  // Floor, not round: "rebuilt 2 days ago" must not appear while it is still one day and a half old.
  // A figure's age is a claim, and claims round toward the reader's caution.
  const ageDays = Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
  const stale = ageDays > rebuildDays;

  return {
    builtAt: new Date(t).toISOString(),
    ageDays,
    stale,
    lead: stale
      ? `Some figures here were last rebuilt ${ageDays} days ago. The nightly rebuild only reaches back ${rebuildDays} days, so corrections made since have not been applied to the older part of this window.`
      : ageDays === 0
        ? "Figures rebuilt today."
        : `Figures rebuilt ${ageDays} day${ageDays === 1 ? "" : "s"} ago.`,
    short: stale
      ? `${ageDays} days ago — older than the ${rebuildDays}-day rebuild`
      : ageDays === 0
        ? "today"
        : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`,
  };
}
