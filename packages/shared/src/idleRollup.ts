/**
 * Idle rollup — the pure math behind `idle_rollup_days`: ONE row per (vehicle, calendar day) that
 * pre-aggregates everything the Idling page needs, so the browser reads ~trucks×days rows instead of
 * paging raw event tables (idle_events alone is ~70k rows/30 days) and re-aggregating on every refresh.
 * That client-side pattern is what hit Postgres' statement timeout as the tables grew.
 *
 * Each row carries:
 *  - engine-time totals (from vehicle_engine_days — passed through, same grain),
 *  - the park-session idle split by mode (managed vs continuous, from idle_park_sessions) — sufficient to
 *    reconstruct `computeAvoidable` exactly, since it only ever SUMS sessions by mode,
 *  - the HOS duty overlay (rest / on-duty / other idle, from idle_events × hos_duty_segments),
 *  - the day's dominant driver (idle-event operators + assignment day-overlap — the same signals the
 *    driver leaderboard combined in the browser).
 *
 * Day bucketing follows the org's operating timezone when one is passed (`tz`) — the SAME clock
 * `aggregateEngineDays` cuts `vehicle_engine_days` on — and falls back to UTC when it is not. Sessions and
 * assignment intervals that span a midnight are split across the days they cover rather than credited whole
 * to the day they started, so a night's rest is not stranded on one side of the boundary. Pure and
 * deterministic — no I/O, fully unit-tested.
 */
import { dayInTz } from "./dashboard.js";
import { zonedWallTimeToUtcIso } from "./efsImport/index.js";

export interface RollupEngineDay {
  vehicleId: string;
  day: string; // YYYY-MM-DD
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
}

export interface RollupSession {
  vehicleId: string;
  startedAtMs: number;
  /** Session end. Omitted → the session is treated as landing wholly on its start day. */
  endedAtMs?: number;
  idleSec: number;
  /** idle_park_sessions.mode: continuous | optimized_cycling | apu_or_off */
  mode: string;
  optimizedEnvelope?: RollupEnvelopeEvidence;
  dutyEvidence?: RollupDutyEvidence;
}

export type RollupEnvelopeEvidenceStatus =
  "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";

export type RollupEnvelopeEvidenceSource = "documented_default" | "learned_behavioral" | "none";

export interface RollupEnvelopeEvidence {
  status: RollupEnvelopeEvidenceStatus;
  source: RollupEnvelopeEvidenceSource;
  insideSec: number;
  outsideSec: number;
  unknownSec: number;
  ambiguousSec: number;
}

export type RollupDutyEvidenceStatus =
  "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";

export interface RollupDutyEvidence {
  status: RollupDutyEvidenceStatus;
  restSec: number;
  workSec: number;
  unknownSec: number;
  ambiguousSec: number;
  graceSec: number;
}

/**
 * @deprecated The rollup no longer consumes Samsara idle events: the duty split comes from park sessions
 * and attribution from driver<->vehicle assignments. Retained only for callers still shaping event rows.
 */
export interface RollupIdleEvent {
  vehicleId: string;
  /** Our driver id (idle_events.driver_id), null when Samsara had no operator. */
  driverId: string | null;
  startMs: number;
  durationSec: number;
}

/** A driver↔vehicle assignment interval already resolved to OUR ids. */
export interface RollupAssignment {
  vehicleId: string;
  driverId: string;
  startMs: number;
  endMs: number | null;
}

export interface IdleRollupDay {
  vehicleId: string;
  day: string;
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
  managedIdleSec: number;
  continuousIdleSec: number;
  restIdleSec: number;
  workIdleSec: number;
  otherIdleSec: number;
  optimizedEnvelopeInsideSec: number;
  optimizedEnvelopeOutsideSec: number;
  optimizedEnvelopeUnknownSec: number;
  optimizedEnvelopeAmbiguousSec: number;
  optimizedEnvelopeStatus: RollupEnvelopeEvidenceStatus;
  optimizedEnvelopeSource: RollupEnvelopeEvidenceSource;
  hosRestSec: number;
  hosWorkSec: number;
  hosUnknownSec: number;
  hosAmbiguousSec: number;
  hosGraceSec: number;
  hosEvidenceStatus: RollupDutyEvidenceStatus;
  attributedDriverId: string | null;
}

const DAY_MS = 86_400_000;

/**
 * The calendar-day boundary this rollup is cut on. `vehicle_engine_days` is bucketed on the ORG's operating
 * timezone (aggregateEngineDays with a DST-correct `tz`), so sessions and events have to be cut on the same
 * clock or the two halves of one night land in different rows and the per-day fit below clips real idle away.
 * `tz` omitted → UTC, which is what this module did before an org clock was threaded through.
 */
interface DayBoundary {
  key: (ms: number) => string;
  nextMidnight: (ms: number) => number;
}

function dayBoundary(tz?: string | null): DayBoundary {
  if (!tz) {
    return {
      key: (ms) => new Date(ms).toISOString().slice(0, 10),
      nextMidnight: (ms) => Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS,
    };
  }
  const key = (ms: number): string => dayInTz(new Date(ms).toISOString(), tz);
  return {
    key,
    nextMidnight: (ms) => {
      const nextDay = new Date(Date.parse(`${key(ms)}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
      return Date.parse(zonedWallTimeToUtcIso(nextDay, "00:00:00", tz));
    },
  };
}

/**
 * Split [startMs, endMs) into per-day shares of 1, keyed on the given boundary. A session that spans a
 * midnight contributes to every day it covers, in proportion to the wall-clock time spent there — the same
 * split `aggregateEngineDays` performs on the engine-state intervals it is reconciled against.
 */
function dayShares(boundary: DayBoundary, startMs: number, endMs: number): Map<string, number> {
  const shares = new Map<string, number>();
  const span = endMs - startMs;
  if (!(span > 0)) return shares.set(boundary.key(startMs), 1);
  for (let from = startMs; from < endMs; ) {
    const to = Math.min(endMs, boundary.nextMidnight(from));
    if (!(to > from)) break; // defensive: a non-advancing boundary must not spin
    const k = boundary.key(from);
    shares.set(k, (shares.get(k) ?? 0) + (to - from) / span);
    from = to;
  }
  return shares.size > 0 ? shares : shares.set(boundary.key(startMs), 1);
}

type Acc = Omit<IdleRollupDay, "attributedDriverId">;

function accFor(map: Map<string, Acc>, vehicleId: string, day: string): Acc {
  const key = `${vehicleId}|${day}`;
  let a = map.get(key);
  if (!a) {
    a = {
      vehicleId,
      day,
      driveSec: 0,
      idleSec: 0,
      offSec: 0,
      coverageSec: 0,
      managedIdleSec: 0,
      continuousIdleSec: 0,
      restIdleSec: 0,
      workIdleSec: 0,
      otherIdleSec: 0,
      optimizedEnvelopeInsideSec: 0,
      optimizedEnvelopeOutsideSec: 0,
      optimizedEnvelopeUnknownSec: 0,
      optimizedEnvelopeAmbiguousSec: 0,
      optimizedEnvelopeStatus: "not_applicable",
      optimizedEnvelopeSource: "none",
      hosRestSec: 0,
      hosWorkSec: 0,
      hosUnknownSec: 0,
      hosAmbiguousSec: 0,
      hosGraceSec: 0,
      hosEvidenceStatus: "not_applicable",
    };
    map.set(key, a);
  }
  return a;
}

const topOf = (m: Map<string, number> | undefined): string | null => {
  if (!m) return null;
  let best: string | null = null;
  let bestDur = -1;
  for (const [d, du] of m)
    if (du > bestDur) {
      best = d;
      bestDur = du;
    }
  return best;
};

/** Accumulate attribution weight for a driver on a (vehicle, day) and on the vehicle overall. */
function addWeight(
  byDay: Map<string, Map<string, number>>,
  byVeh: Map<string, Map<string, number>>,
  vehicleId: string,
  day: string,
  driverId: string,
  sec: number,
): void {
  const kd = `${vehicleId}|${day}`;
  const md = byDay.get(kd) ?? new Map<string, number>();
  md.set(driverId, (md.get(driverId) ?? 0) + sec);
  byDay.set(kd, md);
  const mv = byVeh.get(vehicleId) ?? new Map<string, number>();
  mv.set(driverId, (mv.get(driverId) ?? 0) + sec);
  byVeh.set(vehicleId, mv);
}

/**
 * Build the rollup rows for a window. HOS can join by vehicle even when its driver is unresolved; driver-keyed
 * segments remain the fallback for logs without a vehicle link. Rows exist for every (vehicle, day) that has
 * ANY signal (engine time, a park session, or an idle event), so nothing observed is dropped.
 */
export function buildIdleRollupDays(input: {
  engineDays: RollupEngineDay[];
  sessions: RollupSession[];
  assignments: RollupAssignment[];
  /** Window bounds — open-ended assignments are clamped here (never iterated to infinity). */
  windowStartMs: number;
  windowEndMs: number;
  /** The org's operating timezone — must match the one `vehicle_engine_days` was bucketed on. UTC when unset. */
  tz?: string | null;
}): IdleRollupDay[] {
  const boundary = dayBoundary(input.tz);
  const dayOf = boundary.key;
  const acc = new Map<string, Acc>();
  const weightByDay = new Map<string, Map<string, number>>();
  const weightByVeh = new Map<string, Map<string, number>>();

  for (const d of input.engineDays) {
    const a = accFor(acc, d.vehicleId, d.day);
    a.driveSec += Math.max(0, d.driveSec);
    a.idleSec += Math.max(0, d.idleSec);
    a.offSec += Math.max(0, d.offSec);
    a.coverageSec += Math.max(0, d.coverageSec);
  }

  // Park sessions: SPLIT across every day the session spans, in proportion to the wall-clock time it spent
  // in each (audit 2026-08-13). Previously the whole session was bucketed on its START day while engine-day
  // idle was split at midnight — and since the per-day fit below clips classified idle down to that day's
  // OBSERVED idle, an overnight rest lost every second that belonged to the following morning. In production
  // 18% of sessions crossed a midnight but carried 39% of all session idle, and 27% of rollup rows sat pinned
  // at the clip cap: 4,432 h of classified idle per 30 days was being discarded, almost all of it the
  // overnight rest idle this feature exists to measure.
  for (const s of input.sessions) {
    const idleSec = Math.max(0, s.idleSec);
    const shares = dayShares(boundary, s.startedAtMs, s.endedAtMs ?? s.startedAtMs);
    for (const [day, share] of shares) {
      const a = accFor(acc, s.vehicleId, day);
      if (s.mode === "continuous") a.continuousIdleSec += idleSec * share;
      else a.managedIdleSec += idleSec * share; // apu_or_off | optimized_cycling
      if (s.mode === "continuous" && s.optimizedEnvelope != null) {
        a.optimizedEnvelopeInsideSec += Math.max(0, s.optimizedEnvelope.insideSec) * share;
        a.optimizedEnvelopeOutsideSec += Math.max(0, s.optimizedEnvelope.outsideSec) * share;
        a.optimizedEnvelopeUnknownSec += Math.max(0, s.optimizedEnvelope.unknownSec) * share;
        a.optimizedEnvelopeAmbiguousSec += Math.max(0, s.optimizedEnvelope.ambiguousSec) * share;
        const statusRank: Record<RollupEnvelopeEvidenceStatus, number> = {
          not_applicable: 0,
          sufficient: 1,
          insufficient: 2,
          ambiguous: 3,
          unavailable: 4,
        };
        if (statusRank[s.optimizedEnvelope.status] > statusRank[a.optimizedEnvelopeStatus])
          a.optimizedEnvelopeStatus = s.optimizedEnvelope.status;
        if (s.optimizedEnvelope.source === "learned_behavioral")
          a.optimizedEnvelopeSource = "learned_behavioral";
        else if (a.optimizedEnvelopeSource === "none")
          a.optimizedEnvelopeSource = s.optimizedEnvelope.source;
      }
      // Display split (rest / on-duty / other) — from the park's OWN duty overlay, EVERY mode, not from
      // Samsara's idle events (audit 2026-08-13). The row used to carry two different HOS splits: these
      // columns from an idle-event overlay, and the hos_* columns below from the park sessions that
      // actually drive the verdict. They disagreed by construction, and the event-derived pair was the
      // one on screen.
      if (s.dutyEvidence != null) {
        a.restIdleSec += Math.max(0, s.dutyEvidence.restSec) * share;
        a.workIdleSec += Math.max(0, s.dutyEvidence.workSec) * share;
        // Unknown already folds in driving / excluded / uncovered seconds upstream.
        a.otherIdleSec +=
          (Math.max(0, s.dutyEvidence.unknownSec) + Math.max(0, s.dutyEvidence.ambiguousSec)) * share;
      }
      // Verdict buckets stay CONTINUOUS-only: managed idle is the good behaviour, never a waste candidate.
      if (s.mode === "continuous" && s.dutyEvidence != null) {
        a.hosRestSec += Math.max(0, s.dutyEvidence.restSec) * share;
        a.hosWorkSec += Math.max(0, s.dutyEvidence.workSec) * share;
        a.hosUnknownSec += Math.max(0, s.dutyEvidence.unknownSec) * share;
        a.hosAmbiguousSec += Math.max(0, s.dutyEvidence.ambiguousSec) * share;
        a.hosGraceSec += Math.max(0, s.dutyEvidence.graceSec) * share;
        const statusRank: Record<RollupDutyEvidenceStatus, number> = {
          not_applicable: 0,
          sufficient: 1,
          insufficient: 2,
          ambiguous: 3,
          unavailable: 4,
        };
        if (statusRank[s.dutyEvidence.status] > statusRank[a.hosEvidenceStatus])
          a.hosEvidenceStatus = s.dutyEvidence.status;
      }
    }
  }

  // Attribution: the driver<->vehicle ASSIGNMENT intervals, and nothing else (audit 2026-08-13).
  // Idle-event operators used to add weight here too, which put Samsara's idling feed in the driver
  // leaderboard's path for no benefit: measured over 30 days, assignments cover 98.7% of truck-days
  // against the events' 84.3%, the two agree on 95.8% of the days both can speak to, and NOT ONE row
  // loses its driver when the event signal is removed. The weights were never comparable either — an
  // assignment contributes up to 86,400 s of a day while an idle event contributes its own duration, so
  // assignments already decided nearly every day. Clamped to the window: an open interval (endMs null)
  // runs to the window end, never beyond.
  for (const asg of input.assignments) {
    const s = Math.max(asg.startMs, input.windowStartMs);
    const e = Math.min(asg.endMs ?? input.windowEndMs, input.windowEndMs);
    if (!(e > s)) continue;
    for (let from = s; from < e; ) {
      const to = Math.min(e, boundary.nextMidnight(from));
      if (!(to > from)) break; // defensive: a non-advancing boundary must not spin
      addWeight(weightByDay, weightByVeh, asg.vehicleId, dayOf(from), asg.driverId, (to - from) / 1000);
      from = to;
    }
  }

  const rows: IdleRollupDay[] = [];
  const roundSeconds = (value: number): number => Math.round(value);
  for (const [key, a] of acc) {
    // WHY (idle precision incident 2026-08-12): engine-day totals and park sessions are independently
    // synced. Apply the same proportional fit used by computeAvoidable before persisting derived buckets,
    // so a downstream consumer cannot observe managed+continuous idle above the day's observed idle.
    const classifiedIdleSec = a.managedIdleSec + a.continuousIdleSec;
    const observedIdleSec = Math.max(0, a.idleSec);
    const sessionScale =
      classifiedIdleSec > observedIdleSec && classifiedIdleSec > 0
        ? observedIdleSec / classifiedIdleSec
        : 1;
    // Idle no park session covered (stops under the 30-minute floor). We know how much there was but not
    // WHEN, so it cannot be placed against a duty status — it is "other", never silently rest.
    const shortIdleSec = Math.max(
      0,
      observedIdleSec - (a.managedIdleSec + a.continuousIdleSec) * sessionScale,
    );
    rows.push({
      vehicleId: a.vehicleId,
      day: a.day,
      driveSec: roundSeconds(a.driveSec),
      idleSec: roundSeconds(a.idleSec),
      offSec: roundSeconds(a.offSec),
      coverageSec: roundSeconds(a.coverageSec),
      managedIdleSec: roundSeconds(a.managedIdleSec * sessionScale),
      continuousIdleSec: roundSeconds(a.continuousIdleSec * sessionScale),
      restIdleSec: roundSeconds(a.restIdleSec),
      workIdleSec: roundSeconds(a.workIdleSec),
      otherIdleSec: roundSeconds(a.otherIdleSec + shortIdleSec),
      optimizedEnvelopeInsideSec: roundSeconds(a.optimizedEnvelopeInsideSec),
      optimizedEnvelopeOutsideSec: roundSeconds(a.optimizedEnvelopeOutsideSec),
      optimizedEnvelopeUnknownSec: roundSeconds(a.optimizedEnvelopeUnknownSec),
      optimizedEnvelopeAmbiguousSec: roundSeconds(a.optimizedEnvelopeAmbiguousSec),
      optimizedEnvelopeStatus: a.optimizedEnvelopeStatus,
      optimizedEnvelopeSource: a.optimizedEnvelopeSource,
      hosRestSec: roundSeconds(a.hosRestSec),
      hosWorkSec: roundSeconds(a.hosWorkSec),
      hosUnknownSec: roundSeconds(a.hosUnknownSec),
      hosAmbiguousSec: roundSeconds(a.hosAmbiguousSec),
      hosGraceSec: roundSeconds(a.hosGraceSec),
      hosEvidenceStatus: a.hosEvidenceStatus,
      attributedDriverId: topOf(weightByDay.get(key)) ?? topOf(weightByVeh.get(a.vehicleId)),
    });
  }
  rows.sort((x, y) => x.vehicleId.localeCompare(y.vehicleId) || x.day.localeCompare(y.day));
  return rows;
}
