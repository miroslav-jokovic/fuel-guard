/**
 * Hours-of-Service (HOS) duty status — parsing Samsara ELD logs into contiguous duty-status segments, and
 * overlaying them onto a time range (e.g. a park session) to split idle by WHY the truck was parked.
 *
 * This is the "why was it parked" signal telematics alone lacks: a Sleeper-Berth / Off-Duty park is
 * rest-period hotel-load idle (the APU-replaceable target); On-Duty-not-driving is work (loading, dock,
 * inspection). See docs/plans/IDLE-AVOIDABLE-HOS.md.
 *
 * Verified against the Samsara API (GET /fleet/hos/logs): the response envelope is the standard
 * `{ data, pagination:{endCursor,hasNextPage} }`, and the duty-status enum is
 * offDuty | sleeperBed | driving | onDuty | yardMove | personalConveyance. The nested per-log field names
 * are handled defensively (logStartTime with fallbacks) so a minor shape difference degrades gracefully
 * rather than dropping data silently; the sync asserts the live shape on first run.
 */

/** Samsara's raw HOS duty-status strings (GET /fleet/hos/logs). */
export type SamsaraDutyStatus =
  "offDuty" | "sleeperBed" | "driving" | "onDuty" | "yardMove" | "personalConveyance";

/** Our normalized, storage-facing duty status. `unknown` covers anything unrecognized (never guessed). */
export type HosStatus =
  "off_duty" | "sleeper" | "driving" | "on_duty" | "yard_move" | "personal_conveyance" | "unknown";

const STATUS_MAP: Record<string, HosStatus> = {
  offduty: "off_duty",
  sleeper: "sleeper",
  sleeperbed: "sleeper",
  sleeperberth: "sleeper", // tolerate the alternate spelling seen in some docs/SDKs
  driving: "driving",
  onduty: "on_duty",
  ondutynotdriving: "on_duty",
  yardmove: "yard_move",
  personalconveyance: "personal_conveyance",
};

/** Map a raw Samsara duty status to our normalized value (case/space-insensitive). Unrecognized → unknown. */
export function normalizeHosStatus(raw: string | null | undefined): HosStatus {
  if (!raw) return "unknown";
  return STATUS_MAP[raw.toLowerCase().replace(/[\s_-]/g, "")] ?? "unknown";
}

/**
 * How a duty status counts for avoidable-idle purposes:
 *  - `rest`     — Sleeper Berth / Off Duty: hotel-load idle, the APU-replaceable target.
 *  - `work`     — On Duty not driving: loading / dock / inspection — grace then avoidable (per plan).
 *  - `driving`  — not a park; excluded from park-idle attribution.
 *  - `excluded` — Yard Move / Personal Conveyance: special ELD states, not counted as rest or work.
 *  - `unknown`  — unrecognized / no log: never guessed.
 */
export type HosDutyKind = "rest" | "work" | "driving" | "excluded" | "unknown";

export function hosDutyKind(status: HosStatus): HosDutyKind {
  switch (status) {
    case "sleeper":
    case "off_duty":
      return "rest";
    case "on_duty":
      return "work";
    case "driving":
      return "driving";
    case "yard_move":
    case "personal_conveyance":
      return "excluded";
    default:
      return "unknown";
  }
}

/** One contiguous duty-status interval for a driver. `endMs` null = still open at the window edge. */
export interface HosSegment {
  driverId: string;
  status: HosStatus;
  startMs: number;
  endMs: number | null;
  /** Samsara vehicle id the log entry was made in (WP-ATTR — the LOGBOOK truck). Optional so existing
   *  consumers/tests that build segments without it are untouched; null/undefined = not recorded. */
  vehicleId?: string | null;
}

interface RawLog {
  logStartTime?: string;
  startTime?: string;
  time?: string;
  logEndTime?: string;
  endTime?: string;
  hosStatusType?: string;
  dutyStatus?: string;
  /** Samsara attaches the vehicle the log was recorded in (WP-ATTR). Handled defensively like the rest. */
  vehicle?: { id?: string | number };
  vehicleId?: string | number;
}
interface RawDriverLogs {
  driver?: { id?: string | number };
  driverId?: string | number;
  id?: string | number;
  hosLogs?: RawLog[]; // Samsara's actual field on GET /fleet/hos/logs
  logs?: RawLog[]; // tolerated fallback
}

const startOf = (l: RawLog): number => Date.parse(l.logStartTime ?? l.startTime ?? l.time ?? "");
const endOf = (l: RawLog): number => Date.parse(l.logEndTime ?? l.endTime ?? "");
const statusOf = (l: RawLog): HosStatus => normalizeHosStatus(l.hosStatusType ?? l.dutyStatus);
const vehicleOf = (l: RawLog): string | null =>
  l.vehicle?.id != null ? String(l.vehicle.id) : l.vehicleId != null ? String(l.vehicleId) : null;

/**
 * Parse the merged `data[]` from GET /fleet/hos/logs into duty-status segments per driver. Samsara nests the
 * entries under `hosLogs` (each with logStartTime, logEndTime, hosStatusType). A segment uses the log's own
 * logEndTime when present; otherwise it runs to the driver's next log start, and the final open log to
 * `windowEndMs` (or null). Robust to a driver recurring across pages — logs are gathered, de-duped by start,
 * and ordered before segments are built.
 */
export function parseHosLogs(data: unknown[], opts: { windowEndMs?: number } = {}): HosSegment[] {
  // Gather every driver's logs (a driver may recur across pages). Keyed by start instant → status + its own
  // end (from logEndTime when Samsara supplies it).
  const byDriver = new Map<
    string,
    Map<number, { status: HosStatus; endMs: number | null; vehicleId: string | null }>
  >();
  for (const raw of data) {
    const item = raw as RawDriverLogs;
    const driverId =
      item.driver?.id != null
        ? String(item.driver.id)
        : item.driverId != null
          ? String(item.driverId)
          : item.id != null
            ? String(item.id)
            : null;
    const logs = item.hosLogs ?? item.logs;
    if (!driverId || !Array.isArray(logs)) continue;
    const byStart =
      byDriver.get(driverId) ??
      new Map<number, { status: HosStatus; endMs: number | null; vehicleId: string | null }>();
    for (const l of logs) {
      const t = startOf(l);
      if (!Number.isFinite(t)) continue;
      const e = endOf(l);
      byStart.set(t, {
        status: statusOf(l),
        endMs: Number.isFinite(e) ? e : null,
        vehicleId: vehicleOf(l),
      }); // last write wins on an exact dup
    }
    byDriver.set(driverId, byStart);
  }

  const segments: HosSegment[] = [];
  for (const [driverId, byStart] of byDriver) {
    const starts = [...byStart.keys()].sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const startMs = starts[i]!;
      const rec = byStart.get(startMs)!;
      // Prefer the log's own end; else the next log's start; else the window edge.
      const endMs =
        rec.endMs ?? (i + 1 < starts.length ? starts[i + 1]! : (opts.windowEndMs ?? null));
      if (endMs != null && endMs <= startMs) continue; // drop zero/negative-length
      // vehicleId is only present when the log carried one — existing consumers comparing whole
      // segment objects are untouched by the WP-ATTR field.
      segments.push({
        driverId,
        status: rec.status,
        startMs,
        endMs,
        ...(rec.vehicleId != null ? { vehicleId: rec.vehicleId } : {}),
      });
    }
  }
  segments.sort((a, b) => a.startMs - b.startMs || a.driverId.localeCompare(b.driverId));
  return segments;
}

export interface HosOverlap {
  restSec: number;
  workSec: number;
  drivingSec: number;
  excludedSec: number;
  unknownSec: number;
  /** Seconds of the range covered by ANY duty segment (rest+work+driving+excluded+unknown). */
  coveredSec: number;
}

export interface HosVehicleOverlap extends HosOverlap {
  /** Time where different duty kinds overlap for the same vehicle; never assigned to a bucket. */
  ambiguousSec: number;
  /** Number of vehicle-linked HOS intervals that contributed to the range. */
  segmentCount: number;
}

/**
 * Split a time range [startMs,endMs) by duty kind, from a driver's segments (already filtered to that driver
 * or a single-driver truck window). Segments with a null end are treated as running to `endMs`. Overlap is
 * clamped to the range; uncovered time is simply not counted (caller decides how to treat gaps).
 */
export function hosOverlapSeconds(
  segments: HosSegment[],
  startMs: number,
  endMs: number,
): HosOverlap {
  const acc: HosOverlap = {
    restSec: 0,
    workSec: 0,
    drivingSec: 0,
    excludedSec: 0,
    unknownSec: 0,
    coveredSec: 0,
  };
  if (!(endMs > startMs)) return acc;
  for (const s of segments) {
    const segEnd = s.endMs ?? endMs;
    const lo = Math.max(startMs, s.startMs);
    const hi = Math.min(endMs, segEnd);
    if (hi <= lo) continue;
    const sec = (hi - lo) / 1000;
    acc.coveredSec += sec;
    switch (hosDutyKind(s.status)) {
      case "rest":
        acc.restSec += sec;
        break;
      case "work":
        acc.workSec += sec;
        break;
      case "driving":
        acc.drivingSec += sec;
        break;
      case "excluded":
        acc.excludedSec += sec;
        break;
      default:
        acc.unknownSec += sec;
        break;
    }
  }
  return acc;
}

/**
 * Split a parked vehicle range using only HOS intervals explicitly linked to that vehicle.
 *
 * HOS logs are driver records, and team-driver intervals can overlap on one truck. This sweep counts time
 * once: duplicate intervals with the same duty kind are harmless, while conflicting duty kinds become
 * ambiguous instead of being double-counted or guessed as rest/work.
 */
export function hosVehicleOverlapSeconds(
  segments: HosSegment[],
  vehicleId: string,
  startMs: number,
  endMs: number,
): HosVehicleOverlap {
  const result: HosVehicleOverlap = {
    restSec: 0,
    workSec: 0,
    drivingSec: 0,
    excludedSec: 0,
    unknownSec: 0,
    coveredSec: 0,
    ambiguousSec: 0,
    segmentCount: 0,
  };
  if (!(endMs > startMs)) return result;

  const relevant = segments.filter((segment) => {
    if (segment.vehicleId !== vehicleId) return false;
    const segmentEnd = segment.endMs ?? endMs;
    return segmentEnd > startMs && segment.startMs < endMs;
  });
  result.segmentCount = relevant.length;
  if (relevant.length === 0) return result;

  const boundaries = new Set<number>([startMs, endMs]);
  for (const segment of relevant) {
    boundaries.add(Math.max(startMs, segment.startMs));
    boundaries.add(Math.min(endMs, segment.endMs ?? endMs));
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const lo = ordered[i]!;
    const hi = ordered[i + 1]!;
    if (!(hi > lo)) continue;
    const activeKinds = new Set<HosDutyKind>();
    for (const segment of relevant) {
      const segmentEnd = segment.endMs ?? endMs;
      if (segment.startMs < hi && segmentEnd > lo) activeKinds.add(hosDutyKind(segment.status));
    }
    const seconds = (hi - lo) / 1000;
    if (activeKinds.size === 0) continue;
    result.coveredSec += seconds;
    if (activeKinds.size > 1) {
      result.ambiguousSec += seconds;
      continue;
    }
    const kind = activeKinds.values().next().value as HosDutyKind;
    switch (kind) {
      case "rest":
        result.restSec += seconds;
        break;
      case "work":
        result.workSec += seconds;
        break;
      case "driving":
        result.drivingSec += seconds;
        break;
      case "excluded":
        result.excludedSec += seconds;
        break;
      default:
        result.unknownSec += seconds;
        break;
    }
  }
  return result;
}

/** One driver's CURRENT HOS snapshot, from GET /fleet/hos/clocks (currentDutyStatus + currentVehicle). */
export interface HosCurrentStatus {
  driverId: string;
  status: HosStatus;
  vehicleId: string | null;
  vehicleName: string | null;
}

/**
 * Parse the merged `data[]` from GET /fleet/hos/clocks into each driver's current duty status + current truck.
 * Samsara nests the status under `currentDutyStatus.hosStatusType` and the truck under `currentVehicle`. This
 * is the live "current status for all drivers" feed (the same endpoint fuel planning uses), so the Drivers
 * page / Assignments board don't need the historical logs for "who is on duty right now".
 */
export function parseHosClocks(data: unknown[]): HosCurrentStatus[] {
  const out: HosCurrentStatus[] = [];
  for (const raw of data) {
    const item = raw as {
      driver?: { id?: string | number };
      currentVehicle?: { id?: string | number; name?: string };
      currentDutyStatus?: { hosStatusType?: string };
    };
    const driverId = item.driver?.id != null ? String(item.driver.id) : null;
    if (!driverId) continue;
    out.push({
      driverId,
      status: normalizeHosStatus(item.currentDutyStatus?.hosStatusType),
      vehicleId: item.currentVehicle?.id != null ? String(item.currentVehicle.id) : null,
      vehicleName: item.currentVehicle?.name ?? null,
    });
  }
  return out;
}
