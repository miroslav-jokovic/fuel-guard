import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseIdleEquipmentType,
  resolveIdleEquipmentProfile,
  summarizeIdleEquipmentEvidence,
  type IdleEquipmentEvidenceStatus,
  type IdleEquipmentProfile,
  type IdleThermalInterval,
} from "@silvicom/shared";
import { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";
import { resolveSessionThermalIntervals } from "./idleSessionWeather.js";
import type { OpenMeteoFetcher } from "../../lib/openMeteo.js";

export interface IdleEquipmentEvidenceSyncResult {
  sessions: number;
  inside: number;
  outside: number;
  mixed: number;
  insufficient: number;
  ambiguous: number;
  notApplicable: number;
  unknown: number;
  rowsWritten: number;
}

const PAGE_SIZE = 1000;
/** Rows per apply_idle_equipment_evidence call — one round trip per chunk, not per row. */
const WRITE_CHUNK = 500;

interface ParkSessionRow {
  id: string;
  org_id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string;
  idle_sec: number;
  lat: number | string | null;
  lng: number | string | null;
}

interface IdleEventRow {
  vehicle_id: string | null;
  started_at: string;
  duration_sec: number;
  air_temp_f: number | string | null;
}

interface VehicleEquipmentRow {
  id: string;
  has_apu: boolean | null;
  apu_type: string | null;
  has_optimized_idle: boolean | null;
  idle_learned_envelope_status: string | null;
  idle_learned_envelope_low_f: number | string | null;
  idle_learned_envelope_high_f: number | string | null;
}

/**
 * Equipment evidence owns only these columns. Written with `apply_idle_equipment_evidence` (migration
 * 0174) rather than a partial upsert: a PostgREST upsert compiles to `INSERT … ON CONFLICT DO UPDATE`
 * and Postgres checks NOT NULL on the proposed tuple before conflict arbitration, so omitting the base
 * park-session columns fails with a not-null violation on rows that already exist (incident 2026-08-10).
 */
interface SessionEvidenceWrite {
  id: string;
  equipment_profile: IdleEquipmentProfile;
  equipment_evidence_status: IdleEquipmentEvidenceStatus;
  ambient_sample_count: number;
  ambient_known_idle_sec: number;
  ambient_unknown_idle_sec: number;
  ambient_min_f: number | null;
  ambient_max_f: number | null;
  ambient_avg_f: number | null;
  envelope_inside_sec: number;
  envelope_outside_sec: number;
  envelope_ambiguous_sec: number;
  equipment_evidence_version: "equipment-temp-v1";
  equipment_evidence_at: string;
  ambient_source: "session_weather" | "idle_events" | "none";
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle equipment evidence ${operation} failed: ${error.message}`);
}

function finiteOrNull(value: number | string | null): number | null {
  const parsed = typeof value === "number" ? value : value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTemperature(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The truck's learned temperature band, when it has one; undefined falls back to the documented default. */
function learnedBand(
  vehicle: VehicleEquipmentRow | undefined,
): { lowF: number; highF: number } | undefined {
  if (vehicle?.idle_learned_envelope_status !== "sufficient") return undefined;
  const lowF = finiteOrNull(vehicle.idle_learned_envelope_low_f);
  const highF = finiteOrNull(vehicle.idle_learned_envelope_high_f);
  return lowF != null && highF != null && lowF < highF ? { lowF, highF } : undefined;
}

function emptyResult(): IdleEquipmentEvidenceSyncResult {
  return {
    sessions: 0,
    inside: 0,
    outside: 0,
    mixed: 0,
    insufficient: 0,
    ambiguous: 0,
    notApplicable: 0,
    unknown: 0,
    rowsWritten: 0,
  };
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
      .select("id, org_id, vehicle_id, started_at, ended_at, idle_sec, lat, lng")
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
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("idle_events")
      .select("vehicle_id, started_at, duration_sec, air_temp_f")
      .eq("org_id", orgId)
      .not("vehicle_id", "is", null)
      .gte("started_at", fromIso)
      .lt("started_at", endIso)
      .order("started_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "idle-event read");
    const batch = (data ?? []) as IdleEventRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

async function readVehicleEquipment(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, VehicleEquipmentRow>> {
  const { data, error } = await admin
    .from("vehicles")
    .select(
      "id, has_apu, apu_type, has_optimized_idle, idle_learned_envelope_status, idle_learned_envelope_low_f, idle_learned_envelope_high_f",
    )
    .eq("org_id", orgId);
  requireDatabaseSuccess(error, "vehicle equipment read");
  return new Map(((data ?? []) as VehicleEquipmentRow[]).map((row) => [row.id, row]));
}

function mapThermalIntervals(rows: IdleEventRow[]): Map<string, IdleThermalInterval[]> {
  const byVehicle = new Map<string, IdleThermalInterval[]>();
  for (const row of rows) {
    if (row.vehicle_id == null) continue;
    const startMs = Date.parse(row.started_at);
    const durationSec = Number(row.duration_sec);
    if (!Number.isFinite(startMs) || !Number.isFinite(durationSec) || durationSec <= 0) continue;
    const interval: IdleThermalInterval = {
      startMs,
      endMs: startMs + durationSec * 1000,
      tempF: parseTemperature(row.air_temp_f),
    };
    const list = byVehicle.get(row.vehicle_id) ?? [];
    list.push(interval);
    byVehicle.set(row.vehicle_id, list);
  }
  return byVehicle;
}

function addStatus(
  result: IdleEquipmentEvidenceSyncResult,
  status: IdleEquipmentEvidenceStatus,
): void {
  if (status === "inside_documented_default") result.inside += 1;
  else if (status === "outside_documented_default") result.outside += 1;
  else if (status === "mixed_documented_default") result.mixed += 1;
  else if (status === "insufficient") result.insufficient += 1;
  else if (status === "ambiguous") result.ambiguous += 1;
  else if (status === "not_applicable") result.notApplicable += 1;
  else result.unknown += 1;
}

export async function syncIdleEquipmentEvidence(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number; endIso?: string; weatherFetcher?: OpenMeteoFetcher } = {},
): Promise<IdleEquipmentEvidenceSyncResult> {
  const days = opts.sinceDays ?? IDLE_SOURCE_WINDOW_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new RangeError("Idle equipment evidence sinceDays must be an integer from 1 to 400");
  }
  const endIso = opts.endIso ?? new Date().toISOString();
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs))
    throw new RangeError("Idle equipment evidence endIso must be a valid ISO timestamp");
  const fromIso = new Date(endMs - days * 86_400_000).toISOString();
  const sessions = await readSessions(admin, orgId, fromIso, endIso);
  if (sessions.length === 0) return emptyResult();
  const [idleEvents, vehicleEquipment] = await Promise.all([
    readIdleEvents(admin, orgId, fromIso, endIso),
    readVehicleEquipment(admin, orgId),
  ]);
  const intervalsByVehicle = mapThermalIntervals(idleEvents);
  // The session's OWN weather, from the GPS fix it now carries (migration 0188). This is the primary
  // source; the idle-event overlap below is only a fallback for sessions recorded before locations were
  // captured. Best-effort — a weather failure must never take the idle sync down.
  const sessionIntervals = opts.weatherFetcher
    ? await resolveSessionThermalIntervals(
        admin,
        sessions.map((session) => ({
          id: session.id,
          lat: finiteOrNull(session.lat),
          lng: finiteOrNull(session.lng),
          startedAtMs: Date.parse(session.started_at),
          endedAtMs: Date.parse(session.ended_at),
        })),
        opts.weatherFetcher,
      ).catch(() => new Map())
    : new Map();
  const result = emptyResult();
  result.sessions = sessions.length;
  const nowIso = new Date().toISOString();
  const writes: SessionEvidenceWrite[] = [];

  for (const session of sessions) {
    const vehicle = vehicleEquipment.get(session.vehicle_id);
    const profile = resolveIdleEquipmentProfile({
      hasApu: vehicle?.has_apu,
      apuType: parseIdleEquipmentType(vehicle?.apu_type),
      hasOptimizedIdle: vehicle?.has_optimized_idle,
    });
    const ownIntervals = sessionIntervals.get(session.id);
    const ambientSource = ownIntervals?.length
      ? "session_weather"
      : (intervalsByVehicle.get(session.vehicle_id)?.length ?? 0) > 0
        ? "idle_events"
        : "none";
    // The active band is resolved HERE and nowhere else. The rollup used to recompute this evidence from
    // its own idle-event read with its own band, which meant two code paths could disagree about the same
    // park; it now reads the columns this sync writes (audit 2026-08-13).
    const band = learnedBand(vehicle);
    const evidence = summarizeIdleEquipmentEvidence({
      profile,
      sessionStartMs: Date.parse(session.started_at),
      sessionEndMs: Date.parse(session.ended_at),
      totalIdleSec: Number(session.idle_sec),
      envelopeLowF: band?.lowF,
      envelopeHighF: band?.highF,
      intervals: ownIntervals?.length ? ownIntervals : (intervalsByVehicle.get(session.vehicle_id) ?? []),
    });
    addStatus(result, evidence.status);
    writes.push({
      id: session.id,
      equipment_profile: evidence.profile,
      equipment_evidence_status: evidence.status,
      ambient_sample_count: evidence.ambientSampleCount,
      ambient_known_idle_sec: evidence.ambientKnownIdleSec,
      ambient_unknown_idle_sec: evidence.ambientUnknownIdleSec,
      ambient_min_f: evidence.ambientMinF,
      ambient_max_f: evidence.ambientMaxF,
      ambient_avg_f: evidence.ambientAvgF,
      envelope_inside_sec: evidence.envelopeInsideSec,
      envelope_outside_sec: evidence.envelopeOutsideSec,
      envelope_ambiguous_sec: evidence.envelopeAmbiguousSec,
      equipment_evidence_version: evidence.evidenceVersion,
      equipment_evidence_at: nowIso,
      ambient_source: ambientSource,
    });
  }

  for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
    const { data, error } = await admin.rpc("apply_idle_equipment_evidence", {
      p_org: orgId,
      p_rows: writes.slice(i, i + WRITE_CHUNK),
    });
    requireDatabaseSuccess(error, "session evidence update");
    result.rowsWritten += typeof data === "number" ? data : 0;
  }
  return result;
}
