import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll, readIdleRollupInputs } from "./idleRollupInputs.js";
import { buildEvidence } from "./idleDutyEvidenceSync.js";
import { deriveAssignedVehicleSegments, type AssignmentRow } from "./idleDutyEvidenceSync.js";
import { IDLE_SOURCE_WINDOW_DAYS, idleCalendarStartIso } from "./idleWindow.js";
import {
  buildHosVehicleTimelines,
  buildIdleRollupDays,
  normalizeHosStatus,
  summarizeIdleEquipmentEvidence,
  type IdleEquipmentEvidenceStatus,
  type IdleRollupDay,
  type HosSegment,
  type HosVehicleTimeline,
  type RollupAssignment,
  type RollupDutyEvidence,
  type RollupEnvelopeEvidence,
} from "@fuelguard/shared";

/**
 * Maintains `idle_rollup_days` — one pre-aggregated row per (vehicle, day) — from the raw foundation
 * tables (vehicle_engine_days, idle_park_sessions, idle_events, hos_duty_segments,
 * driver_vehicle_assignments). The Idling page reads THIS table (~trucks×days rows) instead of paging
 * the raw event tables into the browser and re-aggregating on every 2-minute refresh — the pattern that
 * hit Postgres' statement timeout as the tables grew.
 *
 * Runs after the idle and HOS syncs (its two data feeds). Writes are DIFFED against stored rows, so a
 * steady-state run writes only the days whose inputs actually changed. The first run on an empty table
 * self-backfills a deep window; every later run maintains a rolling window that covers the idle sync's
 * own 30-day re-pull.
 */

const UPSERT_CHUNK = 500;
/** One aligned window for the source feeds and derived rollup; see idleWindow.ts (precision incident 2026-08-12). */
const ROLLING_DAYS = IDLE_SOURCE_WINDOW_DAYS;
/** First run on an empty table: backfill as far as the raw tables reach. */
const BACKFILL_DAYS = 400;

export interface IdleRollupResult {
  windowDays: number;
  rows: number; // rollup rows computed for the window
  written: number; // rows actually upserted (new or changed)
  deleted: number; // stale derived keys removed from this org's window
}

interface RawSession {
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  idle_sec: number;
  mode: string;
  hos_evidence_status?: string | null;
  hos_rest_sec?: number | string | null;
  hos_work_sec?: number | string | null;
  hos_unknown_sec?: number | string | null;
  hos_ambiguous_sec?: number | string | null;
}
interface RawEvent {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
  air_temp_f: number | string | null;
}
interface RawRollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec?: number;
  optimized_envelope_outside_sec?: number;
  optimized_envelope_unknown_sec?: number;
  optimized_envelope_ambiguous_sec?: number;
  optimized_envelope_status?: string;
  optimized_envelope_source?: string;
  hos_rest_sec?: number;
  hos_work_sec?: number;
  hos_unknown_sec?: number;
  hos_ambiguous_sec?: number;
  hos_grace_sec?: number;
  hos_evidence_status?: string;
  attributed_driver_id: string | null;
}

interface RawVehicleEvidence {
  id: string;
  samsara_vehicle_id: string;
  has_optimized_idle?: boolean | null;
  idle_learned_envelope_status?: string | null;
  idle_learned_envelope_low_f?: number | string | null;
  idle_learned_envelope_high_f?: number | string | null;
}

interface RawRollupWrite {
  org_id: string;
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec: number;
  optimized_envelope_outside_sec: number;
  optimized_envelope_unknown_sec: number;
  optimized_envelope_ambiguous_sec: number;
  optimized_envelope_status: string;
  optimized_envelope_source: string;
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_grace_sec: number;
  hos_evidence_status: string;
  attributed_driver_id: string | null;
  updated_at: string;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function envelopeStatus(evidence: {
  status: IdleEquipmentEvidenceStatus;
  ambientKnownIdleSec: number;
  ambientUnknownIdleSec: number;
  envelopeAmbiguousSec: number;
}): RollupEnvelopeEvidence["status"] {
  if (evidence.envelopeAmbiguousSec > 0 || evidence.status === "ambiguous") return "ambiguous";
  if (evidence.ambientUnknownIdleSec > 0 || evidence.ambientKnownIdleSec <= 0)
    return "insufficient";
  return "sufficient";
}

function sessionEnvelope(
  session: RawSession,
  vehicle: RawVehicleEvidence | undefined,
  events: RawEvent[],
): RollupEnvelopeEvidence | undefined {
  if (session.mode !== "continuous" || vehicle?.has_optimized_idle !== true) return undefined;
  const startMs = Date.parse(session.started_at);
  const idleSec = Math.max(0, finiteNumber(session.idle_sec) ?? 0);
  if (!Number.isFinite(startMs) || idleSec <= 0) {
    return {
      status: "unavailable",
      source: "none",
      insideSec: 0,
      outsideSec: 0,
      unknownSec: idleSec,
      ambiguousSec: 0,
    };
  }
  const endedMs =
    session.ended_at == null ? startMs + idleSec * 1000 : Date.parse(session.ended_at);
  if (!(endedMs > startMs)) {
    return {
      status: "unavailable",
      source: "none",
      insideSec: 0,
      outsideSec: 0,
      unknownSec: idleSec,
      ambiguousSec: 0,
    };
  }
  const learnedLow = finiteNumber(vehicle.idle_learned_envelope_low_f);
  const learnedHigh = finiteNumber(vehicle.idle_learned_envelope_high_f);
  const learned =
    vehicle.idle_learned_envelope_status === "sufficient" &&
    learnedLow != null &&
    learnedHigh != null &&
    learnedLow < learnedHigh;
  const evidence = summarizeIdleEquipmentEvidence({
    profile: "optimized_idle_documented_default",
    sessionStartMs: startMs,
    sessionEndMs: endedMs,
    totalIdleSec: idleSec,
    envelopeLowF: learned ? learnedLow! : undefined,
    envelopeHighF: learned ? learnedHigh! : undefined,
    intervals: events
      .filter((event) => event.vehicle_id === session.vehicle_id)
      .map((event) => {
        const eventStartMs = Date.parse(event.started_at);
        const durationSec = Math.max(0, finiteNumber(event.duration_sec) ?? 0);
        return {
          startMs: eventStartMs,
          endMs: eventStartMs + durationSec * 1000,
          tempF: finiteNumber(event.air_temp_f),
        };
      }),
  });
  return {
    status: envelopeStatus(evidence),
    source: learned ? "learned_behavioral" : "documented_default",
    insideSec: evidence.envelopeInsideSec,
    outsideSec: evidence.envelopeOutsideSec,
    unknownSec: evidence.ambientUnknownIdleSec,
    ambiguousSec: evidence.envelopeAmbiguousSec,
  };
}

function sessionDutyEvidence(
  session: RawSession,
  events: RawEvent[],
  segmentsByDriver: Map<string, HosSegment[]>,
  segmentsByVehicle: Map<string, HosSegment[]>,
  vehicleTimelines: Map<string, HosVehicleTimeline>,
): RollupDutyEvidence | undefined {
  if (session.mode !== "continuous") return undefined;
  const evidence = buildEvidence(
    segmentsByVehicle,
    segmentsByDriver,
    events,
    session,
    vehicleTimelines,
  );
  return {
    status: evidence.status,
    restSec: evidence.overlap.restSec,
    workSec: evidence.overlap.workSec,
    unknownSec: evidence.overlap.unknownSec,
    ambiguousSec: evidence.overlap.ambiguousSec,
    graceSec: Math.min(evidence.overlap.workSec, 15 * 60),
  };
}

/** True when the stored rollup row already equals the computed one — nothing to write. */
function rollupUnchanged(ex: RawRollupRow | undefined, r: IdleRollupDay): boolean {
  if (!ex) return false;
  return (
    Number(ex.drive_sec) === r.driveSec &&
    Number(ex.idle_sec) === r.idleSec &&
    Number(ex.off_sec) === r.offSec &&
    Number(ex.coverage_sec) === r.coverageSec &&
    Number(ex.managed_idle_sec) === r.managedIdleSec &&
    Number(ex.continuous_idle_sec) === r.continuousIdleSec &&
    Number(ex.rest_idle_sec) === r.restIdleSec &&
    Number(ex.work_idle_sec) === r.workIdleSec &&
    Number(ex.other_idle_sec) === r.otherIdleSec &&
    Number(ex.optimized_envelope_inside_sec ?? 0) === r.optimizedEnvelopeInsideSec &&
    Number(ex.optimized_envelope_outside_sec ?? 0) === r.optimizedEnvelopeOutsideSec &&
    Number(ex.optimized_envelope_unknown_sec ?? 0) === r.optimizedEnvelopeUnknownSec &&
    Number(ex.optimized_envelope_ambiguous_sec ?? 0) === r.optimizedEnvelopeAmbiguousSec &&
    (ex.optimized_envelope_status ?? "not_applicable") === r.optimizedEnvelopeStatus &&
    (ex.optimized_envelope_source ?? "none") === r.optimizedEnvelopeSource &&
    Number(ex.hos_rest_sec ?? 0) === r.hosRestSec &&
    Number(ex.hos_work_sec ?? 0) === r.hosWorkSec &&
    Number(ex.hos_unknown_sec ?? 0) === r.hosUnknownSec &&
    Number(ex.hos_ambiguous_sec ?? 0) === r.hosAmbiguousSec &&
    Number(ex.hos_grace_sec ?? 0) === r.hosGraceSec &&
    (ex.hos_evidence_status ?? "not_applicable") === r.hosEvidenceStatus &&
    (ex.attributed_driver_id ?? null) === r.attributedDriverId
  );
}

/** Window length: explicit override → clamped; empty table (first run) → deep self-backfill. */
async function resolveWindowDays(
  admin: SupabaseClient,
  orgId: string,
  sinceDays: number | undefined,
): Promise<number> {
  if (sinceDays != null) return Math.min(BACKFILL_DAYS, Math.max(1, Math.round(sinceDays)));
  const { data } = await admin.from("idle_rollup_days").select("id").eq("org_id", orgId).limit(1);
  return (data ?? []).length === 0 ? BACKFILL_DAYS : ROLLING_DAYS;
}

export async function syncIdleRollup(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number } = {},
): Promise<IdleRollupResult> {
  const windowDays = await resolveWindowDays(admin, orgId, opts.sinceDays);
  const endMs = Date.now();
  const startMs = endMs - windowDays * 86_400_000;
  const fromDate = new Date(startMs).toISOString().slice(0, 10);
  const toDate = new Date(endMs).toISOString().slice(0, 10);
  const inputFromIso = idleCalendarStartIso(new Date(endMs).toISOString(), windowDays);
  const inputStartMs = Date.parse(inputFromIso);
  const { engineDays, sessions, events, segments, rawAssignments } = await readIdleRollupInputs(
    admin,
    orgId,
    {
      fromDate,
      fromIso: inputFromIso,
      toIso: new Date(endMs).toISOString(),
    },
  );

  // Samsara ids → our ids, to resolve the assignment feed.
  const [{ data: vs }, { data: ds }] = await Promise.all([
    admin
      .from("vehicles")
      .select(
        "id, samsara_vehicle_id, has_optimized_idle, idle_learned_envelope_status, idle_learned_envelope_low_f, idle_learned_envelope_high_f",
      )
      .eq("org_id", orgId)
      .not("samsara_vehicle_id", "is", null),
    admin
      .from("drivers")
      .select("id, samsara_driver_id")
      .eq("org_id", orgId)
      .not("samsara_driver_id", "is", null),
  ]);
  const vehicleEvidence = (vs ?? []) as RawVehicleEvidence[];
  const vehBySamsara = new Map(vehicleEvidence.map((v) => [v.samsara_vehicle_id, v.id]));
  const vehicleById = new Map(vehicleEvidence.map((v) => [v.id, v]));
  const drvBySamsara = new Map(
    ((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [
      d.samsara_driver_id,
      d.id,
    ]),
  );
  const assignments: RollupAssignment[] = [];
  for (const a of rawAssignments) {
    const vehicleId = vehBySamsara.get(a.vehicle_samsara_id);
    const driverId = drvBySamsara.get(a.driver_samsara_id);
    if (!vehicleId || !driverId) continue;
    assignments.push({
      vehicleId,
      driverId,
      startMs: Date.parse(a.start_at),
      endMs: a.end_at ? Date.parse(a.end_at) : null,
    });
  }

  const segmentsByDriver = new Map<string, HosSegment[]>();
  const segmentsByVehicle = new Map<string, HosSegment[]>();
  const segmentsBySamsaraDriver = new Map<string, HosSegment[]>();
  for (const s of segments) {
    const normalized: HosSegment = {
      driverId: s.driver_id ?? "unresolved",
      vehicleId: s.vehicle_id,
      status: normalizeHosStatus(s.status),
      startMs: Date.parse(s.started_at),
      endMs: s.ended_at ? Date.parse(s.ended_at) : null,
    };
    if (s.driver_id != null) {
      const driverSegments = segmentsByDriver.get(s.driver_id) ?? [];
      driverSegments.push(normalized);
      segmentsByDriver.set(s.driver_id, driverSegments);
    }
    if (s.vehicle_id != null) {
      const vehicleSegments = segmentsByVehicle.get(s.vehicle_id) ?? [];
      vehicleSegments.push(normalized);
      segmentsByVehicle.set(s.vehicle_id, vehicleSegments);
    }
    if (s.samsara_driver_id != null) {
      const samsaraSegments = segmentsBySamsaraDriver.get(s.samsara_driver_id) ?? [];
      samsaraSegments.push(normalized);
      segmentsBySamsaraDriver.set(s.samsara_driver_id, samsaraSegments);
    }
  }

  // WHY (idle precision incident 2026-08-12): sync_hos writes assignment-attributed HOS evidence onto
  // sessions, but the rollup previously rebuilt only logbook vehicle-linked segments. Reuse the exact v2
  // assignment attribution before building timelines so a completed HOS sync and its rollup converge.
  const assignedSegments = deriveAssignedVehicleSegments(
    rawAssignments as AssignmentRow[],
    vehBySamsara,
    segmentsBySamsaraDriver,
    endMs,
  );
  for (const [vehicleId, assigned] of assignedSegments) {
    const vehicleSegments = segmentsByVehicle.get(vehicleId) ?? [];
    for (const segment of assigned) vehicleSegments.push(segment);
    segmentsByVehicle.set(vehicleId, vehicleSegments);
  }

  const vehicleTimelines: Map<string, HosVehicleTimeline> = buildHosVehicleTimelines(
    segmentsByVehicle,
    inputStartMs,
    endMs,
  );

  const rows = buildIdleRollupDays({
    engineDays: engineDays
      .filter((d) => d.vehicle_id)
      .map((d) => ({
        vehicleId: d.vehicle_id,
        day: d.day,
        driveSec: Number(d.drive_sec),
        idleSec: Number(d.idle_sec),
        offSec: Number(d.off_sec),
        coverageSec: Number(d.coverage_sec),
      })),
    sessions: sessions
      .filter((s) => s.vehicle_id)
      .map((s) => ({
        vehicleId: s.vehicle_id,
        startedAtMs: Date.parse(s.started_at),
        idleSec: Number(s.idle_sec),
        mode: s.mode,
        optimizedEnvelope: sessionEnvelope(s, vehicleById.get(s.vehicle_id), events),
        dutyEvidence: sessionDutyEvidence(
          s,
          events,
          segmentsByDriver,
          segmentsByVehicle,
          vehicleTimelines,
        ),
      })),
    events: events
      .filter((e) => e.vehicle_id)
      .map((e) => ({
        vehicleId: e.vehicle_id!,
        driverId: e.driver_id,
        startMs: Date.parse(e.started_at),
        durationSec: Number(e.duration_sec),
      })),
    segmentsByDriver,
    segmentsByVehicle,
    vehicleTimelines,
    assignments,
    windowStartMs: inputStartMs,
    windowEndMs: endMs,
  });

  // Diff against stored rollup rows → write only new/changed days.
  const existing = await readAll<RawRollupRow>("idle_rollup_days", (a, b) =>
    admin
      .from("idle_rollup_days")
      .select(
        "vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, optimized_envelope_inside_sec, optimized_envelope_outside_sec, optimized_envelope_unknown_sec, optimized_envelope_ambiguous_sec, optimized_envelope_status, optimized_envelope_source, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec, hos_grace_sec, hos_evidence_status, attributed_driver_id",
      )
      .eq("org_id", orgId)
      .gte("day", fromDate)
      .lte("day", toDate)
      .order("day", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(a, b),
  );
  const byKey = new Map(existing.map((r) => [`${r.vehicle_id}|${r.day}`, r]));

  const now = new Date().toISOString();
  const writes: RawRollupWrite[] = [];
  for (const r of rows) {
    if (rollupUnchanged(byKey.get(`${r.vehicleId}|${r.day}`), r)) continue;
    writes.push({
      org_id: orgId,
      vehicle_id: r.vehicleId,
      day: r.day,
      drive_sec: r.driveSec,
      idle_sec: r.idleSec,
      off_sec: r.offSec,
      coverage_sec: r.coverageSec,
      managed_idle_sec: r.managedIdleSec,
      continuous_idle_sec: r.continuousIdleSec,
      rest_idle_sec: r.restIdleSec,
      work_idle_sec: r.workIdleSec,
      other_idle_sec: r.otherIdleSec,
      optimized_envelope_inside_sec: r.optimizedEnvelopeInsideSec,
      optimized_envelope_outside_sec: r.optimizedEnvelopeOutsideSec,
      optimized_envelope_unknown_sec: r.optimizedEnvelopeUnknownSec,
      optimized_envelope_ambiguous_sec: r.optimizedEnvelopeAmbiguousSec,
      optimized_envelope_status: r.optimizedEnvelopeStatus,
      optimized_envelope_source: r.optimizedEnvelopeSource,
      hos_rest_sec: r.hosRestSec,
      hos_work_sec: r.hosWorkSec,
      hos_unknown_sec: r.hosUnknownSec,
      hos_ambiguous_sec: r.hosAmbiguousSec,
      hos_grace_sec: r.hosGraceSec,
      hos_evidence_status: r.hosEvidenceStatus,
      attributed_driver_id: r.attributedDriverId,
      updated_at: now,
    });
  }
  for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
    const { error } = await admin
      .from("idle_rollup_days")
      .upsert(writes.slice(i, i + UPSERT_CHUNK), { onConflict: "org_id,vehicle_id,day" });
    if (error) throw new Error(error.message);
  }

  // WHY (idle precision incident 2026-08-12): source reconciliation can remove a truck-day after a
  // previous rollup wrote it. Delete only keys absent from this fresh, org-scoped derivation; the RPC
  // keeps this set-based and prevents a service-role cleanup from crossing tenants.
  const freshKeys = new Set(rows.map((row) => `${row.vehicleId}|${row.day}`));
  const staleKeys = existing
    .filter((row) => !freshKeys.has(`${row.vehicle_id}|${row.day}`))
    .map((row) => ({ vehicle_id: row.vehicle_id, day: row.day }));
  let deleted = 0;
  for (let i = 0; i < staleKeys.length; i += UPSERT_CHUNK) {
    const { data, error } = await admin.rpc("delete_idle_rollup_rows", {
      p_org: orgId,
      p_rows: staleKeys.slice(i, i + UPSERT_CHUNK),
    });
    if (error) throw new Error(`idle rollup stale-row delete failed: ${error.message}`);
    deleted += typeof data === "number" ? data : 0;
  }
  return { windowDays, rows: rows.length, written: writes.length, deleted };
}
