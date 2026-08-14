import {
  ON_DUTY_GRACE_SEC,
  hosVehicleTimelineOverlapSeconds,
  hosOverlapSeconds,
  hosVehicleOverlapSeconds,
  type HosSegment,
  type HosVehicleTimeline,
  type RollupDutyEvidence,
} from "@fuelguard/shared";

export interface IdleDutySessionInput {
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  idle_sec: number;
  mode: string;
}

export interface IdleDutyEventInput {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Re-weight a duty overlap measured over the park's WALL CLOCK onto the park's IDLE seconds.
 *
 * The HOS overlay covers the whole park — including the stretches the engine was OFF — but every consumer
 * of this evidence is apportioning IDLE seconds. Without this, a 12 h sleeper park with 9 h of idle
 * reported 12 h of "rest idle": more rest than the truck had idle (unit 688 showed 393 h of rest against
 * 366 h of continuous idle over 30 days). That over-count fed the rest/work split on the truck row, and
 * it inflated the on-duty grace, which is derived from workSec.
 *
 * Where inside the park the engine was idling is not recorded — only the park's totals are — so idle is
 * apportioned across the duty statuses in the same proportion they covered the park. That is an explicit
 * assumption, and it is strictly better than crediting wall-clock seconds as idle seconds. The RAW overlap
 * still decides `status`, since coverage is a property of the timeline, not of the idle it is scaled onto.
 */
function idleWeightedOverlap<T extends { coveredSec: number }>(overlap: T, idleSec: number): T {
  if (!(overlap.coveredSec > idleSec) || idleSec < 0) return overlap;
  const scale = idleSec / overlap.coveredSec;
  const scaled = { ...overlap } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlap))
    if (typeof value === "number") scaled[key] = value * scale;
  return scaled as T;
}

/** Build direct parked-session HOS evidence, then fall back to explicitly attributed idle events. */
export function buildSessionDutyEvidence(
  session: IdleDutySessionInput,
  events: IdleDutyEventInput[],
  segmentsByDriver: Map<string, HosSegment[]>,
  segmentsByVehicle: Map<string, HosSegment[]>,
  vehicleTimelines?: Map<string, HosVehicleTimeline>,
): RollupDutyEvidence | undefined {
  if (session.mode !== "continuous") return undefined;
  const startMs = Date.parse(session.started_at);
  const endMs = session.ended_at == null ? NaN : Date.parse(session.ended_at);
  const idleSec = Math.max(0, finiteNumber(session.idle_sec) ?? 0);
  if (!Number.isFinite(startMs) || !(endMs > startMs) || idleSec <= 0)
    return {
      status: "unavailable",
      restSec: 0,
      workSec: 0,
      unknownSec: idleSec,
      ambiguousSec: 0,
      graceSec: 0,
    };

  const vehicleSegments = segmentsByVehicle.get(session.vehicle_id) ?? [];
  const vehicleTimeline = vehicleTimelines?.get(session.vehicle_id);
  if (vehicleTimeline != null || vehicleSegments.length > 0) {
    const rawOverlap =
      vehicleTimeline != null
        ? hosVehicleTimelineOverlapSeconds(vehicleTimeline, startMs, endMs)
        : hosVehicleOverlapSeconds(vehicleSegments, session.vehicle_id, startMs, endMs);
    const overlap = idleWeightedOverlap(rawOverlap, idleSec);
    const unknownSec =
      overlap.unknownSec +
      overlap.drivingSec +
      overlap.excludedSec +
      Math.max(0, idleSec - overlap.coveredSec);
    return {
      status:
        rawOverlap.ambiguousSec > 0
          ? "ambiguous"
          : rawOverlap.coveredSec >= idleSec && unknownSec <= 0
            ? "sufficient"
            : "insufficient",
      restSec: overlap.restSec,
      workSec: overlap.workSec,
      unknownSec,
      ambiguousSec: overlap.ambiguousSec,
      graceSec: Math.min(overlap.workSec, ON_DUTY_GRACE_SEC),
    };
  }

  let restSec = 0;
  let workSec = 0;
  let unknownSec = 0;
  let coveredSec = 0;
  for (const event of events) {
    if (event.vehicle_id !== session.vehicle_id) continue;
    const eventStartMs = Date.parse(event.started_at);
    const eventDurationSec = Math.max(0, finiteNumber(event.duration_sec) ?? 0);
    const eventEndMs = eventStartMs + eventDurationSec * 1000;
    const overlapStartMs = Math.max(startMs, eventStartMs);
    const overlapEndMs = Math.min(endMs, eventEndMs);
    if (!(Number.isFinite(eventStartMs) && overlapEndMs > overlapStartMs)) continue;
    const eventSec = (overlapEndMs - overlapStartMs) / 1000;
    if (event.driver_id == null) {
      unknownSec += eventSec;
      continue;
    }
    const overlap = hosOverlapSeconds(
      segmentsByDriver.get(event.driver_id) ?? [],
      overlapStartMs,
      overlapEndMs,
    );
    restSec += overlap.restSec;
    workSec += overlap.workSec;
    unknownSec +=
      overlap.unknownSec +
      overlap.drivingSec +
      overlap.excludedSec +
      Math.max(0, eventSec - overlap.coveredSec);
    coveredSec += overlap.coveredSec;
  }
  unknownSec += Math.max(0, idleSec - coveredSec - unknownSec);
  return {
    status: unknownSec <= 0 && coveredSec >= idleSec ? "sufficient" : "insufficient",
    restSec,
    workSec,
    unknownSec,
    ambiguousSec: 0,
    graceSec: Math.min(workSec, ON_DUTY_GRACE_SEC),
  };
}
