import type { SupabaseClient } from "@supabase/supabase-js";
import { IDLE_SOURCE_WINDOW_DAYS, idleCalendarStartIso } from "./idleWindow.js";
import {
  buildEvidence,
  boundedCoveredSeconds,
  roundedSeconds,
  type IdleDutyEvidenceStatus,
  type IdleEventRow,
  type ParkSessionRow,
} from "./idleDutyEvidence.js";

export { buildEvidence, type IdleDutyEvidenceStatus } from "./idleDutyEvidence.js";
import { readVehicleDutyTimelines, SEGMENT_PAD_MS } from "./vehicleDutyTimelines.js";

// Moved to `vehicleDutyTimelines.ts` (IE3); re-exported so existing importers are untouched.
export { deriveAssignedVehicleSegments, type AssignmentRow } from "./vehicleDutyTimelines.js";

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
/** v2: duty segments reach a truck through the driver↔vehicle assignment timeline, not only the logbook. */
const EVIDENCE_VERSION = "vehicle-hos-v2" as const;

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

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle duty evidence ${operation} failed: ${error.message}`);
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
  const [{ segmentsByVehicle, segmentsByDriver, timelines: vehicleTimelines }, events] = await Promise.all([
    readVehicleDutyTimelines(admin, orgId, fromIso, endIso),
    readIdleEvents(admin, orgId, fromIso, endIso),
  ]);
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
