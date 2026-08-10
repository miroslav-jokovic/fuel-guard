import type { SupabaseClient } from "@supabase/supabase-js";
import {
  learnIdleTemperatureEnvelope,
  type IdleEnvelopeObservation,
  type IdleLearnedEnvelopeStatus,
} from "@fuelguard/shared";

export interface IdleLearnedEnvelopeSyncResult {
  vehicles: number;
  sufficient: number;
  insufficient: number;
  notApplicable: number;
  rowsWritten: number;
}

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;
const DEFAULT_LEARNING_DAYS = 400;
const EVIDENCE_VERSION = "optimized-envelope-v1" as const;

interface VehicleRow {
  id: string;
  has_optimized_idle: boolean | null;
}

interface ParkSessionRow {
  vehicle_id: string;
  mode: string;
  equipment_evidence_status: string;
  ambient_avg_f: number | string | null;
  ambient_known_idle_sec: number | string;
  ambient_unknown_idle_sec: number | string;
}

interface LearnedEnvelopeWrite {
  id: string;
  org_id: string;
  idle_learned_envelope_status: IdleLearnedEnvelopeStatus;
  idle_learned_envelope_low_f: number | null;
  idle_learned_envelope_high_f: number | null;
  idle_learned_envelope_sessions: number;
  idle_learned_envelope_known_idle_sec: number;
  idle_learned_envelope_cycling_sec: number;
  idle_learned_envelope_continuous_sec: number;
  idle_learned_envelope_temperature_bins: number;
  idle_learned_envelope_version: typeof EVIDENCE_VERSION;
  idle_learned_envelope_at: string;
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle learned envelope ${operation} failed: ${error.message}`);
}

function parseFinite(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyResult(): IdleLearnedEnvelopeSyncResult {
  return { vehicles: 0, sufficient: 0, insufficient: 0, notApplicable: 0, rowsWritten: 0 };
}

function isObservationMode(value: string): value is IdleEnvelopeObservation["mode"] {
  return value === "optimized_cycling" || value === "continuous";
}

async function readVehicles(admin: SupabaseClient, orgId: string): Promise<VehicleRow[]> {
  const { data, error } = await admin
    .from("vehicles")
    .select("id, has_optimized_idle")
    .eq("org_id", orgId)
    .neq("status", "retired");
  requireDatabaseSuccess(error, "vehicle read");
  return (data ?? []) as VehicleRow[];
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
        "vehicle_id, mode, equipment_evidence_status, ambient_avg_f, ambient_known_idle_sec, ambient_unknown_idle_sec",
      )
      .eq("org_id", orgId)
      .gte("started_at", fromIso)
      .lt("started_at", endIso)
      .order("started_at", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, "park-session read");
    const batch = (data ?? []) as ParkSessionRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

function observationsByVehicle(rows: ParkSessionRow[]): Map<string, IdleEnvelopeObservation[]> {
  const byVehicle = new Map<string, IdleEnvelopeObservation[]>();
  for (const row of rows) {
    if (
      row.equipment_evidence_status !== "inside_documented_default" &&
      row.equipment_evidence_status !== "outside_documented_default"
    )
      continue;
    if (!isObservationMode(row.mode)) continue;
    const temperatureF = parseFinite(row.ambient_avg_f);
    const knownIdleSec = parseFinite(row.ambient_known_idle_sec);
    const unknownIdleSec = parseFinite(row.ambient_unknown_idle_sec);
    if (temperatureF == null || knownIdleSec == null || knownIdleSec <= 0 || unknownIdleSec !== 0)
      continue;
    const observation: IdleEnvelopeObservation = {
      temperatureF,
      mode: row.mode,
      idleSec: knownIdleSec,
    };
    const list = byVehicle.get(row.vehicle_id) ?? [];
    list.push(observation);
    byVehicle.set(row.vehicle_id, list);
  }
  return byVehicle;
}

export async function syncIdleLearnedEnvelopes(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number; endIso?: string } = {},
): Promise<IdleLearnedEnvelopeSyncResult> {
  const days = opts.sinceDays ?? DEFAULT_LEARNING_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new RangeError("Idle learned envelope sinceDays must be an integer from 1 to 400");
  }
  const endIso = opts.endIso ?? new Date().toISOString();
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs))
    throw new RangeError("Idle learned envelope endIso must be a valid ISO timestamp");
  const fromIso = new Date(endMs - days * 86_400_000).toISOString();
  const [vehicles, sessions] = await Promise.all([
    readVehicles(admin, orgId),
    readSessions(admin, orgId, fromIso, endIso),
  ]);
  if (vehicles.length === 0) return emptyResult();

  const result = emptyResult();
  result.vehicles = vehicles.length;
  const byVehicle = observationsByVehicle(sessions);
  const nowIso = new Date().toISOString();
  const writes: LearnedEnvelopeWrite[] = [];

  for (const vehicle of vehicles) {
    const learned =
      vehicle.has_optimized_idle === true
        ? learnIdleTemperatureEnvelope(byVehicle.get(vehicle.id) ?? [])
        : {
            status: "not_applicable" as const,
            lowF: null,
            highF: null,
            sessions: 0,
            knownIdleSec: 0,
            cyclingIdleSec: 0,
            continuousIdleSec: 0,
            temperatureBins: 0,
            evidenceVersion: EVIDENCE_VERSION,
          };
    if (learned.status === "sufficient") result.sufficient += 1;
    else if (learned.status === "insufficient") result.insufficient += 1;
    else result.notApplicable += 1;
    writes.push({
      id: vehicle.id,
      org_id: orgId,
      idle_learned_envelope_status: learned.status,
      idle_learned_envelope_low_f: learned.lowF,
      idle_learned_envelope_high_f: learned.highF,
      idle_learned_envelope_sessions: learned.sessions,
      idle_learned_envelope_known_idle_sec: learned.knownIdleSec,
      idle_learned_envelope_cycling_sec: learned.cyclingIdleSec,
      idle_learned_envelope_continuous_sec: learned.continuousIdleSec,
      idle_learned_envelope_temperature_bins: learned.temperatureBins,
      idle_learned_envelope_version: EVIDENCE_VERSION,
      idle_learned_envelope_at: nowIso,
    });
  }

  for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
    const chunk = writes.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from("vehicles").upsert(chunk, { onConflict: "id" });
    requireDatabaseSuccess(error, "learned-envelope upsert");
    result.rowsWritten += chunk.length;
  }
  return result;
}
