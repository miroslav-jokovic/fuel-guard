import type { SupabaseClient } from "@supabase/supabase-js";
import { readIdleRollupInputs } from "./idleRollupInputs.js";
import { persistIdleRollup } from "./idleRollupPersistence.js";
import { buildEvidence } from "./idleDutyEvidenceSync.js";
import { deriveAssignedVehicleSegments, type AssignmentRow } from "./idleDutyEvidenceSync.js";
import { IDLE_SOURCE_WINDOW_DAYS, idleCalendarStartIso } from "./idleWindow.js";
import { organizationTimezone } from "./idleCapabilitySync.js";
import { syncFuelPriceDays } from "./fuelPriceDaySync.js";
import {
  ON_DUTY_GRACE_SEC,
  buildHosVehicleTimelines,
  buildIdleRollupDays,
  normalizeHosStatus,
  type IdleEquipmentEvidenceStatus,
  type HosSegment,
  type HosVehicleTimeline,
  type RollupAssignment,
  type RollupDutyEvidence,
  type RollupEnvelopeEvidence,
} from "@silvicom/shared";

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
  /** Envelope evidence persisted by syncIdleEquipmentEvidence — read here, never recomputed. */
  envelope_inside_sec?: number | string | null;
  envelope_outside_sec?: number | string | null;
  envelope_ambiguous_sec?: number | string | null;
  ambient_known_idle_sec?: number | string | null;
  ambient_unknown_idle_sec?: number | string | null;
  equipment_evidence_status?: string | null;
  equipment_evidence_version?: string | null;
}
interface RawEvent {
  vehicle_id: string | null;
  driver_id: string | null;
  started_at: string;
  duration_sec: number;
  air_temp_f: number | string | null;
}
interface RawVehicleEvidence {
  id: string;
  samsara_vehicle_id: string;
  has_optimized_idle?: boolean | null;
  idle_learned_envelope_status?: string | null;
  idle_learned_envelope_low_f?: number | string | null;
  idle_learned_envelope_high_f?: number | string | null;
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

/**
 * The park's envelope evidence, READ from the columns `syncIdleEquipmentEvidence` persisted — not
 * recomputed here (audit 2026-08-13).
 *
 * This used to rebuild the evidence from its own `idle_events` read, with its own copy of the band
 * resolution. Two code paths deriving the same verdict from two reads is a drift bug waiting to happen,
 * and it was the last thing tying the avoidable verdict to Samsara's idling feed. The equipment sync now
 * resolves each park's temperature from the park's OWN location (migration 0188) and always runs before
 * the rollup in both the idle and HOS jobs, so these columns are the single source of truth.
 */
function sessionEnvelope(
  session: RawSession,
  vehicle: RawVehicleEvidence | undefined,
): RollupEnvelopeEvidence | undefined {
  if (session.mode !== "continuous" || vehicle?.has_optimized_idle !== true) return undefined;
  const idleSec = Math.max(0, finiteNumber(session.idle_sec) ?? 0);
  const insideSec = Math.max(0, finiteNumber(session.envelope_inside_sec) ?? 0);
  const outsideSec = Math.max(0, finiteNumber(session.envelope_outside_sec) ?? 0);
  const ambiguousSec = Math.max(0, finiteNumber(session.envelope_ambiguous_sec) ?? 0);
  const knownSec = Math.max(0, finiteNumber(session.ambient_known_idle_sec) ?? 0);
  const unknownSec = Math.max(0, finiteNumber(session.ambient_unknown_idle_sec) ?? 0);
  // The equipment sync has not reached this park yet (a session written since the last foundation run).
  // Report it as unevidenced rather than as a zero-temperature park: the seconds-weighted envelope will
  // hold it as uncertain, which is the honest answer until the next sync fills it in.
  if (session.equipment_evidence_version == null)
    return { status: "unavailable", source: "none", insideSec: 0, outsideSec: 0, unknownSec: idleSec, ambiguousSec: 0 };
  const learned = vehicle.idle_learned_envelope_status === "sufficient";
  return {
    status: envelopeStatus({
      status: (session.equipment_evidence_status ?? "unknown") as IdleEquipmentEvidenceStatus,
      ambientKnownIdleSec: knownSec,
      ambientUnknownIdleSec: unknownSec,
      envelopeAmbiguousSec: ambiguousSec,
    }),
    source: learned ? "learned_behavioral" : "documented_default",
    insideSec,
    outsideSec,
    unknownSec,
    ambiguousSec,
  };
}

function sessionDutyEvidence(
  session: RawSession,
  events: RawEvent[],
  segmentsByDriver: Map<string, HosSegment[]>,
  segmentsByVehicle: Map<string, HosSegment[]>,
  vehicleTimelines: Map<string, HosVehicleTimeline>,
): RollupDutyEvidence | undefined {
  // Built for EVERY mode now. The rest/on-duty/other split shown on the truck row covers all parked idle,
  // while the hos_* verdict buckets still take continuous parks only — that filter lives in the rollup
  // builder, so one overlay feeds both instead of the row carrying two disagreeing HOS splits.
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
    graceSec: Math.min(evidence.overlap.workSec, ON_DUTY_GRACE_SEC),
  };
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

  // The rollup must be cut on the SAME clock aggregateEngineDays bucketed vehicle_engine_days on, or a
  // session and the engine time it is reconciled against land on different days and the per-day fit in
  // buildIdleRollupDays clips real idle away.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  const orgTz = organizationTimezone(orgRow?.operating_hours);

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
        endedAtMs: s.ended_at == null ? undefined : Date.parse(s.ended_at),
        idleSec: Number(s.idle_sec),
        mode: s.mode,
        optimizedEnvelope: sessionEnvelope(s, vehicleById.get(s.vehicle_id)),
        dutyEvidence: sessionDutyEvidence(
          s,
          events,
          segmentsByDriver,
          segmentsByVehicle,
          vehicleTimelines,
        ),
      })),
    assignments,
    windowStartMs: inputStartMs,
    windowEndMs: endMs,
    tz: orgTz,
  });

  const { written, deleted } = await persistIdleRollup(admin, orgId, rows, fromDate, toDate);
  // The daily diesel price history the cost model charges against. Kept in step with the rollup window so
  // every rollup day the page can render has a price row to price it with. Best-effort: a pricing failure
  // must not fail the idle sync — the cost model falls back to the flat rate and says so.
  await syncFuelPriceDays(admin, orgId, { sinceDays: Math.max(windowDays, 1) }).catch((error) => {
    console.error(`[idle] fuel price day sync failed for org ${orgId}:`, error);
  });
  return { windowDays, rows: rows.length, written, deleted };
}
