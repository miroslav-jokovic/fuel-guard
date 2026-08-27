/**
 * Duty-evidence math for one park session — pure, and shared by everything that needs the verdict inputs:
 * the sync that persists the per-session columns, the rollup that aggregates them, and the operator
 * verifier that recomputes them from source.
 *
 * Split out of `idleDutyEvidenceSync` when that module crossed the 500-line budget. Keeping exactly ONE
 * implementation matters more than the line count here: there were briefly two, only one had callers, and
 * a fix applied to the wrong one silently did nothing in production (audit 2026-08-13).
 */
import {
  hosVehicleOverlapSeconds,
  hosVehicleTimelineOverlapSeconds,
  type HosSegment,
  type HosVehicleOverlap,
  type HosVehicleTimeline,
} from "@silvicom/shared";

export type IdleDutyEvidenceStatus = "sufficient" | "insufficient" | "ambiguous";

export interface ParkSessionRow {
  id: string;
  org_id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  idle_sec: number;
  off_sec: number;
  cycles: number;
  mode: string;
}

export interface IdleEventRow {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
}

export interface DutyEvidenceValues {
  status: IdleDutyEvidenceStatus;
  overlap: HosVehicleOverlap;
}

export function roundedSeconds(value: number): number {
  return Math.max(0, Math.round(value));
}

export function boundedCoveredSeconds(value: number, durationSec: number): number {
  return Math.min(roundedSeconds(value), roundedSeconds(durationSec));
}

function includeUncoveredSeconds(
  overlap: HosVehicleOverlap,
  durationSec: number,
): HosVehicleOverlap {
  return {
    ...overlap,
    unknownSec:
      overlap.unknownSec +
      overlap.drivingSec +
      overlap.excludedSec +
      Math.max(0, durationSec - overlap.coveredSec),
  };
}

/**
 * Re-weight a duty overlap measured over the park's WALL CLOCK onto the park's IDLE seconds.
 *
 * The HOS overlay spans the whole park, engine-off stretches included, but every consumer of this
 * evidence is apportioning IDLE seconds — `hos_rest_sec` is read as "idle that happened during rest", and
 * the reducible-idle measure is computed straight from it. Unweighted, a 12 h sleeper park holding 9 h of
 * idle reported 12 h of rest idle: more rest than the truck had idle at all (unit 688 showed 393 h of rest
 * against 366 h of continuous idle over 30 days). It also inflated the on-duty grace, which is derived
 * from workSec.
 *
 * Where inside the park the engine was idling is not recorded — only the park's totals are — so idle is
 * apportioned across the duty statuses in the same proportion they covered the park. That is an explicit
 * assumption, and it is strictly better than counting wall-clock seconds as idle seconds. Coverage-derived
 * STATUS is judged on the raw overlap, since coverage is a property of the timeline, not of the idle
 * scaled onto it.
 */
function idleWeighted(overlap: HosVehicleOverlap, idleSec: number): HosVehicleOverlap {
  if (!(idleSec >= 0) || !(overlap.coveredSec > idleSec)) return overlap;
  const scale = idleSec / overlap.coveredSec;
  return {
    ...overlap,
    restSec: overlap.restSec * scale,
    workSec: overlap.workSec * scale,
    drivingSec: overlap.drivingSec * scale,
    excludedSec: overlap.excludedSec * scale,
    unknownSec: overlap.unknownSec * scale,
    ambiguousSec: overlap.ambiguousSec * scale,
    coveredSec: overlap.coveredSec * scale,
  };
}

export function buildEvidence(
  segmentsByVehicle: Map<string, HosSegment[]>,
  segmentsByDriver: Map<string, HosSegment[]>,
  events: IdleEventRow[],
  session: Pick<ParkSessionRow, "vehicle_id" | "started_at" | "duration_sec" | "idle_sec"> & {
    ended_at: string | null;
  },
  vehicleTimelines: Map<string, HosVehicleTimeline>,
): DutyEvidenceValues {
  const idleSec = Math.max(0, Number(session.idle_sec) || 0);
  const startMs = Date.parse(session.started_at);
  const endMs = session.ended_at == null ? NaN : Date.parse(session.ended_at);
  const durationSecExact =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? (endMs - startMs) / 1000
      : 0;
  const vehicleSegments = segmentsByVehicle.get(session.vehicle_id) ?? [];
  const vehicleTimeline = vehicleTimelines.get(session.vehicle_id);
  if (vehicleSegments.length > 0) {
    const overlap = includeUncoveredSeconds(
      vehicleTimeline != null
        ? hosVehicleTimelineOverlapSeconds(vehicleTimeline, startMs, endMs)
        : hosVehicleOverlapSeconds(vehicleSegments, session.vehicle_id, startMs, endMs),
      durationSecExact,
    );
    const fullCoverage = durationSecExact > 0 && overlap.coveredSec >= durationSecExact;
    const status: IdleDutyEvidenceStatus =
      overlap.ambiguousSec > 0
        ? "ambiguous"
        : fullCoverage && overlap.unknownSec === 0
          ? "sufficient"
          : "insufficient";
    return { status, overlap: idleWeighted(overlap, idleSec) };
  }

  const fallbackSegments: HosSegment[] = [];
  for (const event of events) {
    if (event.vehicle_id !== session.vehicle_id || event.driver_id == null) continue;
    const eventStartMs = Date.parse(event.started_at);
    const eventDurationSec = Math.max(0, Number(event.duration_sec));
    const eventEndMs = eventStartMs + eventDurationSec * 1000;
    const overlapStartMs = Math.max(startMs, eventStartMs);
    const overlapEndMs = Math.min(endMs, eventEndMs);
    if (!Number.isFinite(eventStartMs) || !(overlapEndMs > overlapStartMs)) continue;
    for (const segment of segmentsByDriver.get(event.driver_id) ?? []) {
      const segmentEndMs = segment.endMs ?? overlapEndMs;
      const segmentStartMs = Math.max(overlapStartMs, segment.startMs);
      const clippedEndMs = Math.min(overlapEndMs, segmentEndMs);
      if (!(clippedEndMs > segmentStartMs)) continue;
      fallbackSegments.push({
        ...segment,
        vehicleId: session.vehicle_id,
        startMs: segmentStartMs,
        endMs: clippedEndMs,
      });
    }
  }
  const overlap = includeUncoveredSeconds(
    hosVehicleOverlapSeconds(fallbackSegments, session.vehicle_id, startMs, endMs),
    durationSecExact,
  );
  const fullCoverage = durationSecExact > 0 && overlap.coveredSec >= durationSecExact;
  const status: IdleDutyEvidenceStatus =
    overlap.ambiguousSec > 0
      ? "ambiguous"
      : fullCoverage && overlap.unknownSec === 0
        ? "sufficient"
        : "insufficient";
  return { status, overlap: idleWeighted(overlap, idleSec) };
}
