/**
 * Telematics collection coverage, per month, against an ALL-TIME denominator (SAM-S4, D-SAM7).
 *
 * ── WHY THE DENOMINATOR IS THE WHOLE HISTORY ───────────────────────────────────────────────────
 * The Coverage page already carries a "Telematics coverage — fills corroborated" figure, and it is
 * computed over that page's 90-day window. On a recent window it reads ~95% and looks healthy. In
 * production on 2026-09-01, **76.8% of all fills had never had telematics fetched at all**. Both
 * numbers were correct and one of them was useless: a coverage figure whose scope hides the gap is
 * worse than no figure, because it converts an unanswered question into a reassuring answer.
 *
 * ── WHY PER MONTH, AND NOT ONE PERCENTAGE ──────────────────────────────────────────────────────
 * S4's Done-when is that the hole "approaches zero for the period Samsara still serves, and whatever
 * remains is REPORTED per month rather than left as an unexplained gap". That wording is load-bearing.
 * Measured 2026-09-02, the residue is not evenly spread: January comes back `no_data` for 10.8% of the
 * fills attempted, August for 0.6%. A single blended number would average a permanent vendor-side gap
 * at the old end together with a transient backlog at the new end, and an operator reading it could
 * not tell which of the two they were looking at — nor when to stop waiting.
 *
 * ── THE THREE STATES ARE NOT TWO ───────────────────────────────────────────────────────────────
 * `samsara_recon_at is null` (10,644), `samsara_recon_status is null` (10,522) and
 * `samsara_recon_checked_at is null` (11,699) differ by over a thousand rows and mean different
 * things. This module names the one it means: **attempted** is "we asked Samsara", and of those,
 * `no_data` is "Samsara had nothing" — a permanent answer — while **pending** is "we have not asked
 * yet", which the collector tier is still draining. Reporting them as one number is how a backlog and
 * a dead end get mistaken for each other.
 *
 * ── WHY THERE ARE TWO ENTRY POINTS, AND WHY THAT IS NOT TWO DEFINITIONS (Q-SAM8, 2026-09-05) ────
 * Reading this figure used to mean paging every fill the carrier has ever bought — 16 sequential
 * round trips over 15,948 rows, measured in production — which is affordable for a settings
 * diagnostic somebody opens occasionally and not for the Dashboard, where D-SAM7 wants it and where
 * every member lands. So `telematics_coverage_buckets()` (migration 0322) counts in SQL instead.
 *
 * The danger in that move is the one Q-SAM7 rejected its own candidate (c) for: a second
 * implementation of the three-state rule, which reads correctly right up until somebody changes one
 * of them. It is avoided by splitting this module where 0289's `fuel_range_totals` splits — **the
 * aggregate COUNTS, it does not DERIVE** (D-AG1):
 *
 *   * SQL returns a HISTOGRAM of raw column states — `(month, samsara_recon_at is not null,
 *     samsara_recon_status, count)`. It names no bucket, decides nothing, and applies no threshold.
 *     At ~10 months × 2 × 4 statuses that is under a hundred rows, in one round trip.
 *   * `coverageFromBuckets` turns those cells into pending / no-data / reconciled and into the
 *     percentages. It is the ONLY place that mapping exists, and the row-based
 *     `computeTelematicsCoverage` runs it too rather than repeating it.
 *
 * So a change to what "attempted" means is a change to one function, and `agrees with itself whether
 * it counted the rows or was handed the counts` fails if the two ever come apart.
 */

/** One fill, reduced to the three fields this figure is computed from. */
export interface TelematicsCoverageInput {
  fueled_at: string | null;
  samsara_recon_status: string | null;
  samsara_recon_at: string | null;
}

export interface TelematicsCoverageMonth {
  /** `YYYY-MM`, in UTC. */
  month: string;
  fills: number;
  /** Asked, and Samsara had history. */
  reconciled: number;
  /** Asked, and Samsara had nothing — this does not improve by waiting. */
  noData: number;
  /** Never asked. The collector tier is still working through these. */
  pending: number;
  /** `reconciled / fills`, 0–100, rounded to one decimal. */
  coveragePct: number;
}

export interface TelematicsCoverageSummary {
  fills: number;
  reconciled: number;
  noData: number;
  pending: number;
  coveragePct: number;
  /** Newest month first — the order the surface renders. */
  byMonth: TelematicsCoverageMonth[];
  /**
   * The floor `coveragePct` can reach while the tier drains: what coverage would be if every pending
   * fill came back with history. Stated because "approaches zero" has to mean "approaches the
   * reported floor" — see the module header. Null when nothing has been attempted at all, because a
   * ceiling extrapolated from no evidence is a guess dressed as a measurement.
   */
  attainablePct: number | null;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/** UTC month key. Deliberately NOT the station-local business date: this measures a COLLECTOR, and
 *  what it collected against is the instant Samsara serves history for, not the day a carrier books. */
function monthKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One cell of the histogram: a month, the two RAW column states, and how many fills sit there.
 *
 * Deliberately not a bucket name. `attempted` is the value of `samsara_recon_at is not null` and
 * `status` is `samsara_recon_status` verbatim — facts about columns, which is all an aggregate is
 * allowed to know. What those facts MEAN is `coverageFromBuckets`, below and nowhere else.
 */
export interface TelematicsCoverageBucket {
  /** `YYYY-MM` in UTC, or null for a fill with no usable instant — see `coverageFromBuckets`. */
  month: string | null;
  /** `samsara_recon_at is not null`. */
  attempted: boolean;
  /** `samsara_recon_status`, unmapped. */
  status: string | null;
  fills: number;
}

/** Reduce fills to the histogram `telematics_coverage_buckets()` returns. One row becomes one cell. */
export function telematicsCoverageBuckets(
  rows: readonly TelematicsCoverageInput[],
): TelematicsCoverageBucket[] {
  const cells = new Map<string, TelematicsCoverageBucket>();
  for (const r of rows) {
    const month = monthKey(r.fueled_at);
    const attempted = r.samsara_recon_at != null;
    const status = r.samsara_recon_status;
    const key = `${month ?? ""}\u0000${attempted}\u0000${status ?? ""}`;
    const cell = cells.get(key);
    if (cell) cell.fills++;
    else cells.set(key, { month, attempted, status, fills: 1 });
  }
  return [...cells.values()];
}

/**
 * The verdict — the only place a raw column state becomes pending, no-data or reconciled.
 *
 * Both entry points run this: the row-based `computeTelematicsCoverage` counts first and then calls
 * it, and the SQL aggregate hands it cells it counted in the database. See the module header for why
 * the split is here and not somewhere cheaper.
 */
export function coverageFromBuckets(
  buckets: readonly TelematicsCoverageBucket[],
): TelematicsCoverageSummary {
  const months = new Map<string, { fills: number; reconciled: number; noData: number; pending: number }>();
  let fills = 0, reconciled = 0, noData = 0, pending = 0;

  for (const b of buckets) {
    // A fill with no instant cannot be placed in a month, and is not silently binned. The AGGREGATE
    // still returns the cell — deciding to drop it is a judgement, and judgements live here.
    if (!b.month) continue;
    let m = months.get(b.month);
    if (!m) {
      m = { fills: 0, reconciled: 0, noData: 0, pending: 0 };
      months.set(b.month, m);
    }
    m.fills += b.fills;
    fills += b.fills;
    // ATTEMPTED is `samsara_recon_at is not null` — the stamp the recon path writes whether or not it
    // found anything. `samsara_recon_status` alone would misread the 32 rows that came back `no_data`
    // as never-attempted and re-queue them forever.
    if (!b.attempted) {
      m.pending += b.fills;
      pending += b.fills;
    } else if (b.status === "no_data") {
      m.noData += b.fills;
      noData += b.fills;
    } else {
      m.reconciled += b.fills;
      reconciled += b.fills;
    }
  }

  const byMonth = [...months.entries()]
    .map(([month, m]) => ({ month, ...m, coveragePct: pct(m.reconciled, m.fills) }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));

  const attempted = reconciled + noData;
  return {
    fills,
    reconciled,
    noData,
    pending,
    coveragePct: pct(reconciled, fills),
    byMonth,
    // If the pending rows resolve at the rate the attempted ones did, this is where coverage lands.
    attainablePct: attempted > 0 ? pct(reconciled + pending * (reconciled / attempted), fills) : null,
  };
}

/** Coverage from the fills themselves. Counts, then judges — the same judge the aggregate uses. */
export function computeTelematicsCoverage(
  rows: readonly TelematicsCoverageInput[],
): TelematicsCoverageSummary {
  return coverageFromBuckets(telematicsCoverageBuckets(rows));
}
