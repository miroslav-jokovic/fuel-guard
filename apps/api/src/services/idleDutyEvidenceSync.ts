import type { SupabaseClient } from "@supabase/supabase-js";
import { IDLE_SOURCE_WINDOW_DAYS, idleCalendarStartIso } from "./idleWindow.js";
import {
  buildHosVehicleTimelines,
  hosVehicleOverlapSeconds,
  hosVehicleTimelineOverlapSeconds,
  normalizeHosStatus,
  type HosSegment,
  type HosVehicleOverlap,
  type HosVehicleTimeline,
  type HosStatus,
} from "@fuelguard/shared";

export type IdleDutyEvidenceStatus = "sufficient" | "insufficient" | "ambiguous";

export interface IdleDutyEvidenceSyncResult {
  sessions: number;
  sufficient: number;
  insufficient: number;
  ambiguous: number;
  rowsWritten: number;
}

const PAGE_SIZE = 1000;
/** Rows per apply_idle_hos_evidence call — one round trip per chunk, not per row. */
const WRITE_CHUNK = 500;
const SEGMENT_PAD_MS = 72 * 3_600_000;
/** v2: duty segments reach a truck through the driver↔vehicle assignment timeline, not only the logbook. */
const EVIDENCE_VERSION = "vehicle-hos-v2" as const;

interface ParkSessionRow {
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

interface HosSegmentRow {
  driver_id: string | null;
  samsara_driver_id: string | null;
  vehicle_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

/** Time-ranged driver↔vehicle assignment (0051) — keyed by SAMSARA ids on both sides. */
export interface AssignmentRow {
  vehicle_samsara_id: string;
  driver_samsara_id: string;
  start_at: string;
  end_at: string | null;
}

interface IdleEventRow {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
}

/**
 * HOS evidence owns only these columns; the capability sync owns the base park-session columns. That
 * ownership split has to be expressed as an UPDATE, not as an upsert carrying a subset of columns.
 *
 * WHY (incident 2026-08-10 — this took down BOTH sync_hos and sync_idle). A PostgREST upsert compiles to
 * `INSERT … ON CONFLICT (id) DO UPDATE`, and Postgres evaluates NOT NULL on the proposed tuple BEFORE
 * conflict arbitration. idle_park_sessions.vehicle_id / started_at / ended_at / duration_sec / idle_sec /
 * off_sec / mode are all NOT NULL with no default (migration 0076), so an upsert that omits them fails
 * with `null value in column "vehicle_id" … violates not-null constraint` even though every row it
 * targets already exists. The job then failed before syncIdleRollup ran, so the Idling page went stale
 * too. `apply_idle_hos_evidence` (migration 0174) is the set-based UPDATE equivalent: org-scoped by
 * parameter, one round trip per chunk, and unable to resurrect a session the capability sync deleted.
 */
interface ParkSessionEvidenceWrite {
  id: string;
  hos_evidence_status: IdleDutyEvidenceStatus;
  hos_covered_sec: number;
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_driving_sec: number;
  hos_excluded_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_evidence_version: typeof EVIDENCE_VERSION;
}

interface DutyEvidenceValues {
  status: IdleDutyEvidenceStatus;
  overlap: HosVehicleOverlap;
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle duty evidence ${operation} failed: ${error.message}`);
}

function roundedSeconds(value: number): number {
  return Math.max(0, Math.round(value));
}

function boundedCoveredSeconds(value: number, durationSec: number): number {
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

export function buildEvidence(
  segmentsByVehicle: Map<string, HosSegment[]>,
  segmentsByDriver: Map<string, HosSegment[]>,
  events: IdleEventRow[],
  session: Pick<ParkSessionRow, "vehicle_id" | "started_at" | "duration_sec"> & {
    ended_at: string | null;
  },
  vehicleTimelines: Map<string, HosVehicleTimeline>,
): DutyEvidenceValues {
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
    return { status, overlap };
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
  return { status, overlap };
}

async function readSessions(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  endIso: string,
): Promise<ParkSessionRow[]> {
  const out: ParkSessionRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("idle_park_sessions")
      .select(
        "id, org_id, vehicle_id, started_at, ended_at, duration_sec, idle_sec, off_sec, cycles, mode",
      )
      .eq("org_id", orgId)
      .gte("started_at", fromIso)
      .lt("started_at", endIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "session read");
    const batch = (data ?? []) as ParkSessionRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

async function readHosSegments(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  endIso: string,
): Promise<HosSegmentRow[]> {
  const out: HosSegmentRow[] = [];
  const paddedFromIso = new Date(Date.parse(fromIso) - SEGMENT_PAD_MS).toISOString();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("hos_duty_segments")
      .select("driver_id, samsara_driver_id, vehicle_id, status, started_at, ended_at")
      .eq("org_id", orgId)
      .gte("started_at", paddedFromIso)
      .lte("started_at", endIso)
      .or(`ended_at.is.null,ended_at.gte.${paddedFromIso}`)
      .order("started_at", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "HOS segment read");
    const batch = (data ?? []) as HosSegmentRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

/** vehicles.samsara_vehicle_id → vehicles.id, so samsara-keyed assignments resolve to our fleet rows. */
async function readVehicleIdBySamsara(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, samsara_vehicle_id")
      .eq("org_id", orgId)
      .not("samsara_vehicle_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "vehicle read");
    const batch = (data ?? []) as { id: string; samsara_vehicle_id: string }[];
    for (const row of batch) map.set(row.samsara_vehicle_id, row.id);
    if (batch.length < PAGE_SIZE) return map;
  }
}

/** Assignment intervals overlapping the (padded) window — same pad as the segments they will clip. */
async function readAssignments(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  endIso: string,
): Promise<AssignmentRow[]> {
  const out: AssignmentRow[] = [];
  const paddedFromIso = new Date(Date.parse(fromIso) - SEGMENT_PAD_MS).toISOString();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("driver_vehicle_assignments")
      .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
      .eq("org_id", orgId)
      .lte("start_at", endIso)
      .or(`end_at.is.null,end_at.gte.${paddedFromIso}`)
      .order("start_at", { ascending: true })
      .order("vehicle_samsara_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "assignment read");
    const batch = (data ?? []) as AssignmentRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

async function readIdleEvents(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  endIso: string,
): Promise<IdleEventRow[]> {
  const out: IdleEventRow[] = [];
  const paddedFromIso = new Date(Date.parse(fromIso) - SEGMENT_PAD_MS).toISOString();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("idle_events")
      .select("vehicle_id, driver_id, started_at, duration_sec")
      .eq("org_id", orgId)
      .gte("started_at", paddedFromIso)
      .lte("started_at", endIso)
      .order("started_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "idle event read");
    const batch = (data ?? []) as IdleEventRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

function mapSegments(rows: HosSegmentRow[]): {
  byVehicle: Map<string, HosSegment[]>;
  byDriver: Map<string, HosSegment[]>;
  bySamsaraDriver: Map<string, HosSegment[]>;
} {
  const byVehicle = new Map<string, HosSegment[]>();
  const byDriver = new Map<string, HosSegment[]>();
  const bySamsaraDriver = new Map<string, HosSegment[]>();
  for (const row of rows) {
    const startMs = Date.parse(row.started_at);
    const endMs = row.ended_at == null ? null : Date.parse(row.ended_at);
    if (
      !Number.isFinite(startMs) ||
      (endMs != null && (!Number.isFinite(endMs) || endMs <= startMs))
    )
      continue;
    const status: HosStatus = normalizeHosStatus(row.status);
    if (row.driver_id == null && row.vehicle_id == null && row.samsara_driver_id == null) continue;
    const segment: HosSegment = {
      driverId: row.driver_id ?? "unresolved",
      vehicleId: row.vehicle_id,
      status,
      startMs,
      endMs,
    };
    if (row.vehicle_id != null) {
      const vehicleList = byVehicle.get(row.vehicle_id) ?? [];
      vehicleList.push(segment);
      byVehicle.set(row.vehicle_id, vehicleList);
    }
    if (row.driver_id != null) {
      const driverList = byDriver.get(row.driver_id) ?? [];
      driverList.push(segment);
      byDriver.set(row.driver_id, driverList);
    }
    if (row.samsara_driver_id != null) {
      const samsaraList = bySamsaraDriver.get(row.samsara_driver_id) ?? [];
      samsaraList.push(segment);
      bySamsaraDriver.set(row.samsara_driver_id, samsaraList);
    }
  }
  return { byVehicle, byDriver, bySamsaraDriver };
}

/**
 * Attribute duty segments to trucks through the driver↔vehicle assignment timeline (0051).
 *
 * WHY (incident 2026-08-11 — "5/177 trucks with confident data"). A duty segment carries a vehicle_id
 * only when the Samsara LOG entry did, and that is essentially only driving entries: the sleeper and
 * off-duty segments that decide overnight idle almost never name a truck. In production that left an
 * HOS duty overlay on 4 of 190 trucks (2%), so the avoidable-idle model — which refuses to judge
 * continuous idle without duty evidence — excluded 97% of the fleet as "uncertain". The link the
 * logbook omits already exists in driver_vehicle_assignments (persisted by the vehicle sync, extended
 * by operator-derived intervals): clip each assigned driver's segments to the assignment interval and
 * credit them to that truck.
 *
 * Safety properties, in order:
 *  - A segment whose OWN logbook truck is a DIFFERENT vehicle is never re-attributed — the driver's
 *    log contradicts the assignment, and the log wins.
 *  - A wrong same-window assignment cannot silently flip a verdict: conflicting duty KINDS overlapping
 *    on one truck are marked ambiguous by the vehicle timeline, and ambiguous sessions are excluded
 *    from scoring rather than guessed (buildHosVehicleTimelines).
 *  - Team drivers double-covering a truck stay correct: same-kind overlap is counted once.
 */
export function deriveAssignedVehicleSegments(
  assignments: AssignmentRow[],
  vehicleIdBySamsara: Map<string, string>,
  segmentsBySamsaraDriver: Map<string, HosSegment[]>,
  windowEndMs: number,
): Map<string, HosSegment[]> {
  const derived = new Map<string, HosSegment[]>();
  for (const assignment of assignments) {
    const vehicleId = vehicleIdBySamsara.get(assignment.vehicle_samsara_id);
    if (vehicleId == null) continue;
    const assignStartMs = Date.parse(assignment.start_at);
    const assignEndMs = assignment.end_at == null ? windowEndMs : Date.parse(assignment.end_at);
    if (!Number.isFinite(assignStartMs) || !Number.isFinite(assignEndMs)) continue;
    if (assignEndMs <= assignStartMs) continue;
    for (const segment of segmentsBySamsaraDriver.get(assignment.driver_samsara_id) ?? []) {
      // The driver's own logbook named a different truck for this segment → the log wins, skip.
      if (segment.vehicleId != null && segment.vehicleId !== vehicleId) continue;
      const segmentEndMs = segment.endMs ?? windowEndMs;
      const clippedStartMs = Math.max(segment.startMs, assignStartMs);
      const clippedEndMs = Math.min(segmentEndMs, assignEndMs);
      if (!(clippedEndMs > clippedStartMs)) continue;
      const list = derived.get(vehicleId) ?? [];
      list.push({ ...segment, vehicleId, startMs: clippedStartMs, endMs: clippedEndMs });
      derived.set(vehicleId, list);
    }
  }
  return derived;
}

export async function syncIdleDutyEvidence(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number; endIso?: string } = {},
): Promise<IdleDutyEvidenceSyncResult> {
  const days = opts.sinceDays ?? IDLE_SOURCE_WINDOW_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new RangeError("Idle duty evidence sinceDays must be an integer from 1 to 400");
  }
  const endIso = opts.endIso ?? new Date().toISOString();
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs))
    throw new RangeError("Idle duty evidence endIso must be a valid ISO timestamp");
  const fromIso = idleCalendarStartIso(endIso, days);
  const sessions = await readSessions(admin, orgId, fromIso, endIso);
  if (sessions.length === 0)
    return { sessions: 0, sufficient: 0, insufficient: 0, ambiguous: 0, rowsWritten: 0 };
  const [hosRows, events, vehicleIdBySamsara, assignments] = await Promise.all([
    readHosSegments(admin, orgId, fromIso, endIso),
    readIdleEvents(admin, orgId, fromIso, endIso),
    readVehicleIdBySamsara(admin, orgId),
    readAssignments(admin, orgId, fromIso, endIso),
  ]);
  const {
    byVehicle: segmentsByVehicle,
    byDriver: segmentsByDriver,
    bySamsaraDriver: segmentsBySamsaraDriver,
  } = mapSegments(hosRows);
  // Merge assignment-derived segments into the per-vehicle view BEFORE the timelines are built, so the
  // timeline's overlap/conflict handling applies to them exactly as to logbook-tagged segments.
  const assignedSegments = deriveAssignedVehicleSegments(
    assignments,
    vehicleIdBySamsara,
    segmentsBySamsaraDriver,
    endMs,
  );
  for (const [vehicleId, segments] of assignedSegments) {
    const list = segmentsByVehicle.get(vehicleId) ?? [];
    for (const segment of segments) list.push(segment);
    segmentsByVehicle.set(vehicleId, list);
  }
  const vehicleTimelines = buildHosVehicleTimelines(segmentsByVehicle, Date.parse(fromIso), endMs);
  const writes: ParkSessionEvidenceWrite[] = [];
  let sufficient = 0;
  let insufficient = 0;
  let ambiguous = 0;

  for (const session of sessions) {
    const evidence = buildEvidence(
      segmentsByVehicle,
      segmentsByDriver,
      events,
      session,
      vehicleTimelines,
    );
    if (evidence.status === "sufficient") sufficient += 1;
    else if (evidence.status === "ambiguous") ambiguous += 1;
    else insufficient += 1;
    writes.push({
      id: session.id,
      hos_evidence_status: evidence.status,
      // The database constraint compares this to the persisted integer duration_sec. The timestamp
      // overlap is fractional at millisecond precision, so round and clamp to that stored duration.
      hos_covered_sec: boundedCoveredSeconds(evidence.overlap.coveredSec, session.duration_sec),
      hos_rest_sec: roundedSeconds(evidence.overlap.restSec),
      hos_work_sec: roundedSeconds(evidence.overlap.workSec),
      hos_driving_sec: roundedSeconds(evidence.overlap.drivingSec),
      hos_excluded_sec: roundedSeconds(evidence.overlap.excludedSec),
      hos_unknown_sec: roundedSeconds(evidence.overlap.unknownSec),
      hos_ambiguous_sec: roundedSeconds(evidence.overlap.ambiguousSec),
      hos_evidence_version: EVIDENCE_VERSION,
    });
  }

  // rowsWritten is what the DATABASE reports it changed, not the size of the payload we sent — a
  // session removed by capability reconciliation between the read and this write is simply not counted.
  let rowsWritten = 0;
  for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
    const { data, error } = await admin.rpc("apply_idle_hos_evidence", {
      p_org: orgId,
      p_rows: writes.slice(i, i + WRITE_CHUNK),
    });
    requireDatabaseSuccess(error, "session evidence update");
    rowsWritten += typeof data === "number" ? data : 0;
  }
  return { sessions: sessions.length, sufficient, insufficient, ambiguous, rowsWritten };
}
