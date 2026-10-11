/**
 * D-IE9's gate (IE5 of FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md): does the idle engine agree with the
 * truck's own computer, on enough truck-days, for long enough, to replace today's idle figures? Pure:
 * the measurements are `idle_engine_days` (ours) and `vehicle_engine_days` (Samsara's per-day split of
 * the engine's states); everything decided about them is decided here.
 *
 * ── THE TWO CHECKS: ONE JUDGES, ONE INFORMS (Q-IE17, ruled 2026-10-03) ─────────────────────────────
 *  1. RUNNING — our running time (driving + stopped running + brief stops) within ±3% of the ECU's
 *     engine-hours delta for the day (`obdEngineSeconds`, IE2a). This is the check that can be WRONG
 *     only if we are: the ECU counts its own hours. It is THE gate: a truck-day passes when it passes.
 *  2. STOPPED RUNNING — our stopped running (stopped running + brief stops) against Samsara's idle
 *     seconds for the day, ±5%: computed and shown, never judged. D-IE9 first judged it too; the first
 *     final day (10/01) failed it on 103 of 128 truck-days, ours HIGHER on 127, and the gateway's own GPS
 *     says ours is right: Samsara turns a stop into "Idle" 2–3 minutes after the truck stands still
 *     (307 flips on 40 trucks: none under 60 s, median 166 s, a quarter 9 min or more) and books those
 *     minutes as driving. Counting the stopped minutes Samsara calls "On" as its idle, 89 of 122 days
 *     agree instead of 24. A check against a reference that is wrong one way can only fail, so it
 *     informs. Evidence: FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §7, 2026-10-03.
 *  The gate passes when at least `minDays` final days have been judged and at least 95% of the judged
 *  truck-days pass.
 *
 * ── WHICH TRUCK-DAYS ARE JUDGED ───────────────────────────────────────────────────────────────────
 *  - FINAL days only: a day the collector will not rewrite. The nightly run rewrites the two local
 *    days before it, so once a nightly has started on a day, that day has had its last write
 *    (`finalThrough`, from the jobs ledger). Judging a day the nightly has yet to fill would fail it for
 *    the gateway that uploads late, which is exactly what the nightly is for.
 *  - WHOLE days: all 24 of our hours stored (the engine's first day, 10/02, began at 07:00 local).
 *  - RUNNING is judged when the ECU counter has a delta in all 24 hours (an hour without one is a sum
 *    of 23 hours against 24) and either side shows at least an hour. A day where one side says 0 and
 *    the other 2 h is judged, and fails. The tolerance is ±3% or one counter step (180 s), whichever is
 *    larger: the counter steps in 180 s, so on a day under 1.67 h ±3% is narrower than the counter can
 *    read, and a day would fail on the counter's rounding alone (none have yet; 2026-10-03 research).
 *  - COVERAGE is judged on every final whole day where Samsara's own record covers the whole day: if
 *    ours has an hour or more of `no_data` there, the day is judged and FAILS, whatever running says.
 *    Measured 2026-10-03: 649 idled 37.6 h that we stored as `no_data` (a collector carry-in defect,
 *    since fixed), and the gate never saw it — an hour with no engine state has no engine-seconds delta
 *    either, so the day was not judged rather than failed. Missing a day the reference measured is not
 *    agreeing with it.
 *  - STOPPED RUNNING is computed when Samsara has the whole day and either side shows at least an
 *    hour, on a truck-day that running is judged on.
 *  A truck-day running is not judged on is not counted at all (a truck parked with the engine off all
 *  day agrees with everything and proves nothing).
 */

export const IDLE_PARITY = {
  runningTolerance: 0.03,
  stoppedTolerance: 0.05,
  minJudgedSec: 3600,
  /** One step of `obdEngineSeconds`: the narrowest disagreement the counter can show. */
  counterStepSec: 180,
  /** An hour of our `no_data` on a day Samsara covers whole fails the day. */
  maxNoDataSec: 3600,
  passShare: 0.95,
  minDays: 14,
} as const;

/** One truck-day, both sides. Seconds; `samsaraIdleSec` null when Samsara has no WHOLE row for the day. */
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
  /** Our `no_data` seconds for the day. */
  noDataSec: number;
  /** Samsara's record covers the whole local day (`coverage_sec ≥ hours`). */
  samsaraWholeDay: boolean;
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
  /** Null on a day judged on coverage alone (the ECU had no whole day either). */
  running: IdleParityCheck | null;
  /** Information only (Q-IE17): never decides `pass`. */
  stopped: IdleParityCheck | null;
  /** An hour or more of our `no_data` on a day Samsara covers whole: fails the day. */
  coverageGap: boolean;
  /** Running passed and there is no coverage gap. */
  pass: boolean;
}

/** Within `tolerance` of theirs, or within `floorSec` when that is wider (a counter's one step). */
function check(ours: number, theirs: number, tolerance: number, floorSec = 0): IdleParityCheck {
  const diff = theirs > 0 ? (ours - theirs) / theirs : null;
  const within = Math.abs(ours - theirs) <= Math.max(tolerance * theirs, floorSec);
  return { ours, theirs, diff, pass: diff != null && within };
}

/** Judge one truck-day; null when it is not judged at all (not final, not whole, nothing judgeable). */
export function judgeIdleParityDay(d: IdleParityDay, finalThrough: string | null): IdleParityJudged | null {
  if (finalThrough == null || d.day > finalThrough || d.hours < 24) return null;
  const min = IDLE_PARITY.minJudgedSec;
  const running =
    d.ecuHours >= 24 && Math.max(d.runningSec, d.ecuSec) >= min
      ? check(d.runningSec, d.ecuSec, IDLE_PARITY.runningTolerance, IDLE_PARITY.counterStepSec)
      : null;
  const coverageGap = d.samsaraWholeDay && d.noDataSec >= IDLE_PARITY.maxNoDataSec;
  if (!running && !coverageGap) return null;
  const stopped =
    running && d.samsaraIdleSec != null && Math.max(d.stoppedSec, d.samsaraIdleSec) >= min
      ? check(d.stoppedSec, d.samsaraIdleSec, IDLE_PARITY.stoppedTolerance)
      : null;
  return { vehicleId: d.vehicleId, day: d.day, running, stopped, coverageGap, pass: !coverageGap && running != null && running.pass };
}

export interface IdleParityTruck {
  vehicleId: string;
  judgedDays: number;
  failedDays: number;
  /** Judged days that failed on coverage: an hour or more of ours missing where Samsara saw the day. */
  gapDays: number;
  /** The judged day each check missed by most, signed — the number a person looks at first. */
  worstRunningDiff: number | null;
  worstStoppedDiff: number | null;
}

export interface IdleParityReport {
  finalThrough: string | null;
  /** Distinct final days with at least one judged truck-day. */
  days: string[];
  truckDays: {
    judged: number;
    passed: number;
    runningJudged: number;
    runningPassed: number;
    stoppedJudged: number;
    stoppedPassed: number;
    /** Judged days failed on coverage (`coverageGap`). */
    coverageGaps: number;
  };
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
  const t = { judged: judged.length, passed: 0, runningJudged: 0, runningPassed: 0, stoppedJudged: 0, stoppedPassed: 0, coverageGaps: 0 };
  const byTruck = new Map<string, IdleParityTruck>();
  for (const j of judged) {
    if (j.pass) t.passed += 1;
    if (j.running) { t.runningJudged += 1; if (j.running.pass) t.runningPassed += 1; }
    if (j.stopped) { t.stoppedJudged += 1; if (j.stopped.pass) t.stoppedPassed += 1; }
    if (j.coverageGap) t.coverageGaps += 1;
    const k = byTruck.get(j.vehicleId) ?? { vehicleId: j.vehicleId, judgedDays: 0, failedDays: 0, gapDays: 0, worstRunningDiff: null, worstStoppedDiff: null };
    k.judgedDays += 1;
    if (!j.pass) k.failedDays += 1;
    if (j.coverageGap) k.gapDays += 1;
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

// ── THE TWO TABLES AS STORED, AND THE VIEW BOTH READERS SERVE (IE-ADMIN, §4 Q-FSV17) ───────────────
// Two services read the gate: the office API (`/api/idle/engine/parity`) and the platform console
// (`/admin/orgs/:id/idle-engine`). Each runs its own queries — the console may not import `apps/api`
// (`lint:boundaries`) — so everything decided about the rows lives here, once: which columns, how a
// stored row becomes a truck-day, and when Samsara's day counts as whole.

/** `idle_engine_days` (0404): the columns the gate reads. */
export const IDLE_ENGINE_DAY_COLUMNS =
  "vehicle_id, day, hours, driving_sec, stopped_running_sec, brief_stop_sec, no_data_sec, engine_sec, engine_sec_hours";

export interface IdleEngineDayRow {
  vehicle_id: string;
  day: string;
  hours: number;
  driving_sec: number;
  stopped_running_sec: number;
  brief_stop_sec: number;
  no_data_sec: number;
  // bigint: PostgREST may send it as a string.
  engine_sec: number | string;
  engine_sec_hours: number;
}

/** `vehicle_engine_days`: Samsara's idle for the same truck and local day, and how much of it the sync saw. */
export const SAMSARA_ENGINE_DAY_COLUMNS = "vehicle_id, day, idle_sec, coverage_sec";

export interface SamsaraEngineDayRow {
  vehicle_id: string;
  day: string;
  idle_sec: number | string | null;
  coverage_sec: number | null;
}

/**
 * Pair each of our stored days with Samsara's for the same truck and local day. Samsara's idle counts
 * only when its coverage spans the whole local day: `aggregateEngineDays` counts a state until the NEXT
 * sample, so a truck still idling when the sync last ran has that open stretch missing (775 on 10/01:
 * 15.4 h covered, 1.2 h idle stored, 9.8 h idle by Samsara's own states). Our `hours` is the local
 * day's length (a DST day is 23 or 25), so the bar moves with it.
 */
export function idleParityDays(
  ours: readonly IdleEngineDayRow[],
  theirs: readonly SamsaraEngineDayRow[],
): IdleParityDay[] {
  const samsara = new Map(theirs.map((r) => [`${r.vehicle_id}|${r.day}`, r]));
  return ours.map((r) => {
    const t = samsara.get(`${r.vehicle_id}|${r.day}`);
    const whole = t != null && t.coverage_sec != null && t.coverage_sec >= r.hours * 3600;
    const s = whole ? t.idle_sec : null;
    return {
      vehicleId: r.vehicle_id,
      day: r.day,
      hours: r.hours,
      runningSec: r.driving_sec + r.stopped_running_sec + r.brief_stop_sec,
      stoppedSec: r.stopped_running_sec + r.brief_stop_sec,
      ecuSec: Number(r.engine_sec),
      ecuHours: r.engine_sec_hours,
      samsaraIdleSec: s == null ? null : Number(s),
      noDataSec: r.no_data_sec,
      samsaraWholeDay: whole,
    };
  });
}

/** The gate as both services serve it: the report, the org's timezone, and units on the disagreements. */
export interface IdleEngineParityView extends Omit<IdleParityReport, "disagreements"> {
  timezone: string;
  disagreements: (IdleParityTruck & { unit: string })[];
}

export function idleEngineParityView(
  report: IdleParityReport,
  timezone: string,
  unitById: ReadonlyMap<string, string>,
): IdleEngineParityView {
  return {
    ...report,
    timezone,
    disagreements: report.disagreements.map((d) => ({ ...d, unit: unitById.get(d.vehicleId) ?? "—" })),
  };
}

/**
 * Where the rollout stands, as one word both views badge: `pass` once the gate passes, `checking` while
 * fewer than `minDays` final days are in, `disagreeing` with the days in and the share short of the bar.
 */
export type IdleParityStage = "pass" | "checking" | "disagreeing";

export function idleParityStage(report: Pick<IdleParityReport, "pass" | "daysNeeded">): IdleParityStage {
  if (report.pass) return "pass";
  return report.daysNeeded > 0 ? "checking" : "disagreeing";
}
