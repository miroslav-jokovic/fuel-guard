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
  | "offDuty"
  | "sleeperBed"
  | "driving"
  | "onDuty"
  | "yardMove"
  | "personalConveyance";

/** Our normalized, storage-facing duty status. `unknown` covers anything unrecognized (never guessed). */
export type HosStatus =
  | "off_duty"
  | "sleeper"
  | "driving"
  | "on_duty"
  | "yard_move"
  | "personal_conveyance"
  | "unknown";

const STATUS_MAP: Record<string, HosStatus> = {
  offduty: "off_duty",
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
}

interface RawLog {
  logStartTime?: string;
  startTime?: string;
  time?: string;
  dutyStatus?: string;
  hosStatusType?: string;
}
interface RawDriverLogs {
  driver?: { id?: string | number };
  driverId?: string | number;
  id?: string | number;
  logs?: RawLog[];
}

const startOf = (l: RawLog): number => Date.parse(l.logStartTime ?? l.startTime ?? l.time ?? "");
const statusOf = (l: RawLog): HosStatus => normalizeHosStatus(l.dutyStatus ?? l.hosStatusType);

/**
 * Parse the merged `data[]` from GET /fleet/hos/logs into contiguous duty-status segments per driver.
 * Logs are status CHANGES: each log holds from its start until the driver's next log start; the final open
 * log runs to `windowEndMs` (or stays null). Robust to a driver appearing across multiple pages — all their
 * logs are gathered, de-duplicated by (start,status), and ordered before segments are built.
 */
export function parseHosLogs(
  data: unknown[],
  opts: { windowEndMs?: number } = {},
): HosSegment[] {
  // Gather every driver's logs (a driver may recur across pages).
  const byDriver = new Map<string, Map<number, HosStatus>>();
  for (const raw of data) {
    const item = raw as RawDriverLogs;
    const driverId =
      item.driver?.id != null ? String(item.driver.id) : item.driverId != null ? String(item.driverId) : item.id != null ? String(item.id) : null;
    if (!driverId || !Array.isArray(item.logs)) continue;
    const logs = byDriver.get(driverId) ?? new Map<number, HosStatus>();
    for (const l of item.logs) {
      const t = startOf(l);
      if (!Number.isFinite(t)) continue;
      logs.set(t, statusOf(l)); // last write wins on an exact duplicate timestamp
    }
    byDriver.set(driverId, logs);
  }

  const segments: HosSegment[] = [];
  for (const [driverId, logs] of byDriver) {
    const starts = [...logs.keys()].sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const startMs = starts[i]!;
      const endMs = i + 1 < starts.length ? starts[i + 1]! : (opts.windowEndMs ?? null);
      // Drop a zero/negative-length segment (two logs at the same instant already merged above).
      if (endMs != null && endMs <= startMs) continue;
      segments.push({ driverId, status: logs.get(startMs)!, startMs, endMs });
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

/**
 * Split a time range [startMs,endMs) by duty kind, from a driver's segments (already filtered to that driver
 * or a single-driver truck window). Segments with a null end are treated as running to `endMs`. Overlap is
 * clamped to the range; uncovered time is simply not counted (caller decides how to treat gaps).
 */
export function hosOverlapSeconds(segments: HosSegment[], startMs: number, endMs: number): HosOverlap {
  const acc: HosOverlap = { restSec: 0, workSec: 0, drivingSec: 0, excludedSec: 0, unknownSec: 0, coveredSec: 0 };
  if (!(endMs > startMs)) return acc;
  for (const s of segments) {
    const segEnd = s.endMs ?? endMs;
    const lo = Math.max(startMs, s.startMs);
    const hi = Math.min(endMs, segEnd);
    if (hi <= lo) continue;
    const sec = (hi - lo) / 1000;
    acc.coveredSec += sec;
    switch (hosDutyKind(s.status)) {
      case "rest": acc.restSec += sec; break;
      case "work": acc.workSec += sec; break;
      case "driving": acc.drivingSec += sec; break;
      case "excluded": acc.excludedSec += sec; break;
      default: acc.unknownSec += sec; break;
    }
  }
  return acc;
}
