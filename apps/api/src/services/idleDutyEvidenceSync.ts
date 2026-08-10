import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hosVehicleOverlapSeconds,
  normalizeHosStatus,
  type HosSegment,
  type HosVehicleOverlap,
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
const UPSERT_CHUNK = 500;
const SEGMENT_PAD_MS = 72 * 3_600_000;
const EVIDENCE_VERSION = "vehicle-hos-v1" as const;

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
  vehicle_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface IdleEventRow {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
}

interface ParkSessionEvidenceWrite {
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

function buildEvidence(
  segmentsByVehicle: Map<string, HosSegment[]>,
  segmentsByDriver: Map<string, HosSegment[]>,
  events: IdleEventRow[],
  session: ParkSessionRow,
): DutyEvidenceValues {
  const startMs = Date.parse(session.started_at);
  const endMs = Date.parse(session.ended_at);
  const durationSecExact =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? (endMs - startMs) / 1000
      : 0;
  const vehicleSegments = segmentsByVehicle.get(session.vehicle_id) ?? [];
  if (vehicleSegments.length > 0) {
    const overlap = includeUncoveredSeconds(
      hosVehicleOverlapSeconds(vehicleSegments, session.vehicle_id, startMs, endMs),
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
      .select("driver_id, vehicle_id, status, started_at, ended_at")
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
} {
  const byVehicle = new Map<string, HosSegment[]>();
  const byDriver = new Map<string, HosSegment[]>();
  for (const row of rows) {
    const startMs = Date.parse(row.started_at);
    const endMs = row.ended_at == null ? null : Date.parse(row.ended_at);
    if (
      !Number.isFinite(startMs) ||
      (endMs != null && (!Number.isFinite(endMs) || endMs <= startMs))
    )
      continue;
    const status: HosStatus = normalizeHosStatus(row.status);
    if (row.driver_id == null && row.vehicle_id == null) continue;
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
  }
  return { byVehicle, byDriver };
}

export async function syncIdleDutyEvidence(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number; endIso?: string } = {},
): Promise<IdleDutyEvidenceSyncResult> {
  const days = opts.sinceDays ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new RangeError("Idle duty evidence sinceDays must be an integer from 1 to 400");
  }
  const endIso = opts.endIso ?? new Date().toISOString();
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs))
    throw new RangeError("Idle duty evidence endIso must be a valid ISO timestamp");
  const fromIso = new Date(endMs - days * 86_400_000).toISOString();
  const sessions = await readSessions(admin, orgId, fromIso, endIso);
  if (sessions.length === 0)
    return { sessions: 0, sufficient: 0, insufficient: 0, ambiguous: 0, rowsWritten: 0 };
  const [hosRows, events] = await Promise.all([
    readHosSegments(admin, orgId, fromIso, endIso),
    readIdleEvents(admin, orgId, fromIso, endIso),
  ]);
  const { byVehicle: segmentsByVehicle, byDriver: segmentsByDriver } = mapSegments(hosRows);
  const writes: ParkSessionEvidenceWrite[] = [];
  let sufficient = 0;
  let insufficient = 0;
  let ambiguous = 0;

  for (const session of sessions) {
    const evidence = buildEvidence(segmentsByVehicle, segmentsByDriver, events, session);
    if (evidence.status === "sufficient") sufficient += 1;
    else if (evidence.status === "ambiguous") ambiguous += 1;
    else insufficient += 1;
    writes.push({
      id: session.id,
      org_id: session.org_id,
      vehicle_id: session.vehicle_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      duration_sec: session.duration_sec,
      idle_sec: session.idle_sec,
      off_sec: session.off_sec,
      cycles: session.cycles,
      mode: session.mode,
      hos_evidence_status: evidence.status,
      hos_covered_sec: roundedSeconds(evidence.overlap.coveredSec),
      hos_rest_sec: roundedSeconds(evidence.overlap.restSec),
      hos_work_sec: roundedSeconds(evidence.overlap.workSec),
      hos_driving_sec: roundedSeconds(evidence.overlap.drivingSec),
      hos_excluded_sec: roundedSeconds(evidence.overlap.excludedSec),
      hos_unknown_sec: roundedSeconds(evidence.overlap.unknownSec),
      hos_ambiguous_sec: roundedSeconds(evidence.overlap.ambiguousSec),
      hos_evidence_version: EVIDENCE_VERSION,
    });
  }

  let rowsWritten = 0;
  for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
    const { error } = await admin
      .from("idle_park_sessions")
      .upsert(writes.slice(i, i + UPSERT_CHUNK), { onConflict: "id" });
    requireDatabaseSuccess(error, "session evidence upsert");
    rowsWritten += Math.min(UPSERT_CHUNK, writes.length - i);
  }
  return { sessions: sessions.length, sufficient, insufficient, ambiguous, rowsWritten };
}
