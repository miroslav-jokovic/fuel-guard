import {
  hosOverlapSeconds,
  hosVehicleOverlapSeconds,
  type HosSegment,
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

/** Build direct parked-session HOS evidence, then fall back to explicitly attributed idle events. */
export function buildSessionDutyEvidence(
  session: IdleDutySessionInput,
  events: IdleDutyEventInput[],
  segmentsByDriver: Map<string, HosSegment[]>,
  segmentsByVehicle: Map<string, HosSegment[]>,
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
  if (vehicleSegments.length > 0) {
    const overlap = hosVehicleOverlapSeconds(vehicleSegments, session.vehicle_id, startMs, endMs);
    const unknownSec =
      overlap.unknownSec +
      overlap.drivingSec +
      overlap.excludedSec +
      Math.max(0, idleSec - overlap.coveredSec);
    return {
      status:
        overlap.ambiguousSec > 0
          ? "ambiguous"
          : overlap.coveredSec >= idleSec && unknownSec <= 0
            ? "sufficient"
            : "insufficient",
      restSec: overlap.restSec,
      workSec: overlap.workSec,
      unknownSec,
      ambiguousSec: overlap.ambiguousSec,
      graceSec: Math.min(overlap.workSec, 15 * 60),
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
    graceSec: Math.min(workSec, 15 * 60),
  };
}
