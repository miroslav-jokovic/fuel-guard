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

export function computeTelematicsCoverage(
  rows: readonly TelematicsCoverageInput[],
): TelematicsCoverageSummary {
  const months = new Map<string, { fills: number; reconciled: number; noData: number; pending: number }>();
  let fills = 0, reconciled = 0, noData = 0, pending = 0;

  for (const r of rows) {
    const key = monthKey(r.fueled_at);
    if (!key) continue; // a fill with no instant cannot be placed in a month, and is not silently binned
    let m = months.get(key);
    if (!m) {
      m = { fills: 0, reconciled: 0, noData: 0, pending: 0 };
      months.set(key, m);
    }
    m.fills++;
    fills++;
    // ATTEMPTED is `samsara_recon_at is not null` — the stamp the recon path writes whether or not it
    // found anything. `samsara_recon_status` alone would misread the 32 rows that came back `no_data`
    // as never-attempted and re-queue them forever.
    if (r.samsara_recon_at == null) {
      m.pending++;
      pending++;
    } else if (r.samsara_recon_status === "no_data") {
      m.noData++;
      noData++;
    } else {
      m.reconciled++;
      reconciled++;
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
