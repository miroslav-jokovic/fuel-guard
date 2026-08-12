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
 * Day bucketing is UTC (`toISOString().slice(0,10)`), matching what the page previously did client-side,
 * so numbers do not shift with this move. Pure and deterministic — no I/O, fully unit-tested.
 */
import { hosOverlapSeconds, type HosSegment } from "./hos.js";
import {
  buildHosVehicleTimelines,
  hosVehicleTimelineOverlapSeconds,
  type HosVehicleTimeline,
} from "./hosVehicleTimeline.js";

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
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

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
  events: RollupIdleEvent[];
  segmentsByDriver: Map<string, HosSegment[]>;
  segmentsByVehicle?: Map<string, HosSegment[]>;
  vehicleTimelines?: Map<string, HosVehicleTimeline>;
  assignments: RollupAssignment[];
  /** Window bounds — open-ended assignments are clamped here (never iterated to infinity). */
  windowStartMs: number;
  windowEndMs: number;
}): IdleRollupDay[] {
  const acc = new Map<string, Acc>();
  const weightByDay = new Map<string, Map<string, number>>();
  const weightByVeh = new Map<string, Map<string, number>>();
  const vehicleTimelines =
    input.vehicleTimelines ??
    (input.segmentsByVehicle != null
      ? buildHosVehicleTimelines(input.segmentsByVehicle, input.windowStartMs, input.windowEndMs)
      : new Map<string, HosVehicleTimeline>());

  for (const d of input.engineDays) {
    const a = accFor(acc, d.vehicleId, d.day);
    a.driveSec += Math.max(0, d.driveSec);
    a.idleSec += Math.max(0, d.idleSec);
    a.offSec += Math.max(0, d.offSec);
    a.coverageSec += Math.max(0, d.coverageSec);
  }

  // Park sessions: whole session bucketed to its START day (exactly how the page bucketed avoidable
  // attribution before), split managed vs continuous by mode.
  for (const s of input.sessions) {
    const a = accFor(acc, s.vehicleId, dayOf(s.startedAtMs));
    if (s.mode === "continuous") a.continuousIdleSec += Math.max(0, s.idleSec);
    else a.managedIdleSec += Math.max(0, s.idleSec); // apu_or_off | optimized_cycling
    if (s.mode === "continuous" && s.optimizedEnvelope != null) {
      a.optimizedEnvelopeInsideSec += Math.max(0, s.optimizedEnvelope.insideSec);
      a.optimizedEnvelopeOutsideSec += Math.max(0, s.optimizedEnvelope.outsideSec);
      a.optimizedEnvelopeUnknownSec += Math.max(0, s.optimizedEnvelope.unknownSec);
      a.optimizedEnvelopeAmbiguousSec += Math.max(0, s.optimizedEnvelope.ambiguousSec);
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
    if (s.mode === "continuous" && s.dutyEvidence != null) {
      a.hosRestSec += Math.max(0, s.dutyEvidence.restSec);
      a.hosWorkSec += Math.max(0, s.dutyEvidence.workSec);
      a.hosUnknownSec += Math.max(0, s.dutyEvidence.unknownSec);
      a.hosAmbiguousSec += Math.max(0, s.dutyEvidence.ambiguousSec);
      a.hosGraceSec += Math.max(0, s.dutyEvidence.graceSec);
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

  // Idle events: HOS duty overlay + operator attribution weight. No driver / no segments → other
  // (honest — never guessed as rest).
  for (const ev of input.events) {
    const dur = Math.max(0, ev.durationSec);
    if (dur <= 0) continue;
    const a = accFor(acc, ev.vehicleId, dayOf(ev.startMs));
    const vehicleTimeline = vehicleTimelines.get(ev.vehicleId);
    if (vehicleTimeline != null) {
      const o = hosVehicleTimelineOverlapSeconds(
        vehicleTimeline,
        ev.startMs,
        ev.startMs + dur * 1000,
      );
      a.restIdleSec += o.restSec;
      a.workIdleSec += o.workSec;
      a.otherIdleSec +=
        o.drivingSec +
        o.excludedSec +
        o.unknownSec +
        o.ambiguousSec +
        Math.max(0, dur - o.coveredSec);
    } else {
      const segs = ev.driverId ? input.segmentsByDriver.get(ev.driverId) : undefined;
      if (!segs || segs.length === 0) {
        a.otherIdleSec += dur;
      } else {
        const o = hosOverlapSeconds(segs, ev.startMs, ev.startMs + dur * 1000);
        a.restIdleSec += o.restSec;
        a.workIdleSec += o.workSec;
        a.otherIdleSec +=
          o.drivingSec + o.excludedSec + o.unknownSec + Math.max(0, dur - o.coveredSec);
      }
    }
    if (ev.driverId)
      addWeight(weightByDay, weightByVeh, ev.vehicleId, dayOf(ev.startMs), ev.driverId, dur);
  }

  // Assignment intervals: fold each interval's per-day overlap into the same attribution weights (the
  // signal that covers trucks that drove but never idled). Clamped to the window — an open interval
  // (endMs null) runs to the window end, never beyond.
  for (const asg of input.assignments) {
    const s = Math.max(asg.startMs, input.windowStartMs);
    const e = Math.min(asg.endMs ?? input.windowEndMs, input.windowEndMs);
    if (!(e > s)) continue;
    for (let dayStart = Math.floor(s / DAY_MS) * DAY_MS; dayStart < e; dayStart += DAY_MS) {
      const ov = Math.min(e, dayStart + DAY_MS) - Math.max(s, dayStart);
      if (ov > 0)
        addWeight(
          weightByDay,
          weightByVeh,
          asg.vehicleId,
          dayOf(dayStart),
          asg.driverId,
          ov / 1000,
        );
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
      otherIdleSec: roundSeconds(a.otherIdleSec),
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
