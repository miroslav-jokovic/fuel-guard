/**
 * Which driver's duty status covered a truck at each instant — read once, attributed one way.
 *
 * Moved out of `idleDutyEvidenceSync.ts` (2026-10-02, IE3) when the idle engine's collector needed the
 * same per-truck duty timeline to split a park's running time by duty (migration 0407). Two readers of
 * the same logs attributing them two ways is how the 2026-08-11 incident happened (a duty overlay on 4
 * of 190 trucks, because only one path knew about the assignment link), so the reads, the mapping and
 * the assignment attribution live here once and both callers take them from here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildHosVehicleTimelines,
  normalizeHosStatus,
  type HosSegment,
  type HosStatus,
  type HosVehicleTimeline,
} from "@silvicom/shared";

const PAGE_SIZE = 1000;
/** Segments starting this long before a window can still cover it (a 34-hour reset, a long sleeper). */
export const SEGMENT_PAD_MS = 72 * 3_600_000;

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

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Duty timeline ${operation} failed: ${error.message}`);
}

export async function readHosSegments(
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
export async function readVehicleIdBySamsara(
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
export async function readAssignments(
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

export function mapSegments(rows: HosSegmentRow[]): {
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

export interface VehicleDutyTimelines {
  /** Per truck: its own logbook segments plus the assignment-attributed ones. */
  segmentsByVehicle: Map<string, HosSegment[]>;
  segmentsByDriver: Map<string, HosSegment[]>;
  /** Built over `[fromMs, endMs)`; a truck absent from the map has no duty evidence at all. */
  timelines: Map<string, HosVehicleTimeline>;
  /**
   * The latest instant any segment read reaches — how far the logbook sync has brought the logs. The
   * sync closes a segment still in progress at the instant it ran (production 2026-10-02: 0 of 5,046
   * rows open, the latest end = the last sync to the second), so the latest end IS the last sync; an
   * open row, which the timeline runs to the window's end, reaches that end. Null when nothing was read. The idle engine treats running past
   * it as not yet measured (`dutyKnownUntilMs`).
   */
  knownUntilMs: number | null;
}

/**
 * Every truck's duty timeline over `[fromIso, endIso)`: logbook segments that name the truck, plus each
 * assigned driver's segments clipped to the assignment (`deriveAssignedVehicleSegments`), merged BEFORE
 * the timeline is built so its conflict handling applies to both alike.
 */
export async function readVehicleDutyTimelines(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  endIso: string,
): Promise<VehicleDutyTimelines> {
  const endMs = Date.parse(endIso);
  const [hosRows, vehicleIdBySamsara, assignments] = await Promise.all([
    readHosSegments(admin, orgId, fromIso, endIso),
    readVehicleIdBySamsara(admin, orgId),
    readAssignments(admin, orgId, fromIso, endIso),
  ]);
  const { byVehicle: segmentsByVehicle, byDriver: segmentsByDriver, bySamsaraDriver } = mapSegments(hosRows);
  const assigned = deriveAssignedVehicleSegments(assignments, vehicleIdBySamsara, bySamsaraDriver, endMs);
  for (const [vehicleId, segments] of assigned) {
    const list = segmentsByVehicle.get(vehicleId) ?? [];
    for (const segment of segments) list.push(segment);
    segmentsByVehicle.set(vehicleId, list);
  }
  let knownUntilMs: number | null = null;
  for (const r of hosRows) {
    const t = r.ended_at == null ? endMs : Date.parse(r.ended_at);
    if (Number.isFinite(t) && (knownUntilMs == null || t > knownUntilMs)) knownUntilMs = t;
  }
  return {
    segmentsByVehicle,
    segmentsByDriver,
    knownUntilMs,
    timelines: buildHosVehicleTimelines(segmentsByVehicle, Date.parse(fromIso), endMs),
  };
}
