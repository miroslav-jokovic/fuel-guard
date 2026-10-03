/**
 * D-IE9's gate (IE5 of FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md): does the idle engine agree with the
 * truck's own computer, on enough truck-days, for long enough, to replace today's idle figures? Pure:
 * the measurements are `idle_engine_days` (ours) and `vehicle_engine_days` (Samsara's per-day split of
 * the engine's states); everything decided about them is decided here.
 *
 * ── THE TWO CHECKS, AS RULED ──────────────────────────────────────────────────────────────────────
 *  1. RUNNING — our running time (driving + stopped running + brief stops) within ±3% of the ECU's
 *     engine-hours delta for the day (`obdEngineSeconds`, IE2a). This is the check that can be WRONG
 *     only if we are: the ECU counts its own hours.
 *  2. STOPPED RUNNING — our stopped running (stopped running + brief stops) within ±5% of Samsara's
 *     idle seconds for the day. Looser because Samsara's idle is ITS motion call, which D-IE1 replaced
 *     with ours (3 mph, 60 s debounce) — some disagreement is the point of the engine, and the check
 *     is that the two do not disagree by much.
 *  A truck-day passes when every check it is judged on passes. The gate passes when at least
 *  `minDays` final days have been judged and at least 95% of the judged truck-days pass.
 *
 * ── WHICH TRUCK-DAYS ARE JUDGED ───────────────────────────────────────────────────────────────────
 *  - FINAL days only: a day the collector will not rewrite. The nightly run rewrites the two local
 *    days before it, so once a nightly has started on a day, that day has had its last write
 *    (`finalThrough`, from the jobs ledger). Judging a day the nightly has yet to fill would fail it for
 *    the gateway that uploads late, which is exactly what the nightly is for.
 *  - WHOLE days: all 24 of our hours stored (the engine's first day, 10/02, began at 07:00 local).
 *  - RUNNING is judged when the ECU counter has a delta in all 24 hours (an hour without one is a sum
 *    of 23 hours against 24) and either side shows at least an hour: the counter steps in 180 s, so
 *    ±3% of less than an hour is inside one step. A day where one side says 0 and the other 2 h is
 *    judged, and fails.
 *  - STOPPED RUNNING is judged when Samsara has the day and either side shows at least an hour.
 *  A truck-day judged on neither check is not counted at all (a truck parked with the engine off all
 *  day agrees with everything and proves nothing).
 */

export const IDLE_PARITY = {
  runningTolerance: 0.03,
  stoppedTolerance: 0.05,
  minJudgedSec: 3600,
  passShare: 0.95,
  minDays: 14,
} as const;

/** One truck-day, both sides. Seconds; `samsaraIdleSec` null when Samsara has no row for the day. */
export interface IdleParityDay {
  vehicleId: string;
  /** YYYY-MM-DD, the org's local day. */
  day: string;
  hours: number;
  runningSec: number;
  stoppedSec: number;
  ecuSec: number;
  ecuHours: number;
  samsaraIdleSec: number | null;
}

export interface IdleParityCheck {
  ours: number;
  theirs: number;
  /** (ours − theirs) ÷ theirs; null when theirs is 0 (a check judged on a zero always fails). */
  diff: number | null;
  pass: boolean;
}

export interface IdleParityJudged {
  vehicleId: string;
  day: string;
  running: IdleParityCheck | null;
  stopped: IdleParityCheck | null;
  pass: boolean;
}

function check(ours: number, theirs: number, tolerance: number): IdleParityCheck {
  const diff = theirs > 0 ? (ours - theirs) / theirs : null;
  return { ours, theirs, diff, pass: diff != null && Math.abs(diff) <= tolerance };
}

/** Judge one truck-day; null when it is not judged at all (not final, not whole, or nothing to judge). */
export function judgeIdleParityDay(d: IdleParityDay, finalThrough: string | null): IdleParityJudged | null {
  if (finalThrough == null || d.day > finalThrough || d.hours < 24) return null;
  const min = IDLE_PARITY.minJudgedSec;
  const running =
    d.ecuHours >= 24 && Math.max(d.runningSec, d.ecuSec) >= min
      ? check(d.runningSec, d.ecuSec, IDLE_PARITY.runningTolerance)
      : null;
  const stopped =
    d.samsaraIdleSec != null && Math.max(d.stoppedSec, d.samsaraIdleSec) >= min
      ? check(d.stoppedSec, d.samsaraIdleSec, IDLE_PARITY.stoppedTolerance)
      : null;
  if (!running && !stopped) return null;
  return { vehicleId: d.vehicleId, day: d.day, running, stopped, pass: (running?.pass ?? true) && (stopped?.pass ?? true) };
}

export interface IdleParityTruck {
  vehicleId: string;
  judgedDays: number;
  failedDays: number;
  /** The judged day each check missed by most, signed — the number a person looks at first. */
  worstRunningDiff: number | null;
  worstStoppedDiff: number | null;
}

export interface IdleParityReport {
  finalThrough: string | null;
  /** Distinct final days with at least one judged truck-day. */
  days: string[];
  truckDays: { judged: number; passed: number; runningJudged: number; runningPassed: number; stoppedJudged: number; stoppedPassed: number };
  /** passed ÷ judged; null with nothing judged. */
  share: number | null;
  /** Days still needed before the gate can pass (0 once `minDays` are in). */
  daysNeeded: number;
  pass: boolean;
  /** Every truck with a failed day, most failed days first. */
  disagreements: IdleParityTruck[];
}

const worse = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.abs(b) > Math.abs(a) ? b : a);

export function idleParityReport(rows: readonly IdleParityDay[], finalThrough: string | null): IdleParityReport {
  const judged = rows.map((r) => judgeIdleParityDay(r, finalThrough)).filter((j): j is IdleParityJudged => j != null);
  const days = [...new Set(judged.map((j) => j.day))].sort();
  const t = { judged: judged.length, passed: 0, runningJudged: 0, runningPassed: 0, stoppedJudged: 0, stoppedPassed: 0 };
  const byTruck = new Map<string, IdleParityTruck>();
  for (const j of judged) {
    if (j.pass) t.passed += 1;
    if (j.running) { t.runningJudged += 1; if (j.running.pass) t.runningPassed += 1; }
    if (j.stopped) { t.stoppedJudged += 1; if (j.stopped.pass) t.stoppedPassed += 1; }
    const k = byTruck.get(j.vehicleId) ?? { vehicleId: j.vehicleId, judgedDays: 0, failedDays: 0, worstRunningDiff: null, worstStoppedDiff: null };
    k.judgedDays += 1;
    if (!j.pass) k.failedDays += 1;
    k.worstRunningDiff = worse(k.worstRunningDiff, j.running?.diff ?? null);
    k.worstStoppedDiff = worse(k.worstStoppedDiff, j.stopped?.diff ?? null);
    byTruck.set(j.vehicleId, k);
  }
  const share = t.judged > 0 ? t.passed / t.judged : null;
  const daysNeeded = Math.max(0, IDLE_PARITY.minDays - days.length);
  return {
    finalThrough,
    days,
    truckDays: t,
    share,
    daysNeeded,
    pass: daysNeeded === 0 && share != null && share >= IDLE_PARITY.passShare,
    disagreements: [...byTruck.values()]
      .filter((k) => k.failedDays > 0)
      .sort((a, b) => b.failedDays - a.failedDays || a.vehicleId.localeCompare(b.vehicleId)),
  };
}

/**
 * The last day the collector will never rewrite, from the latest finished nightly run's window start
 * (`stats.from`, the local midnight two days before it ran): that first day of its window has had its
 * last write. Null with no nightly yet — nothing is final.
 */
export function idleParityFinalThrough(nightlyFromIso: string | null, timeZone: string): string | null {
  if (!nightlyFromIso) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    Date.parse(nightlyFromIso),
  );
}
