import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildIdleRollupDays,
  type IdleRollupDay,
  type HosSegment,
  type HosStatus,
  type RollupAssignment,
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

const READ_PAGE = 1000;
const UPSERT_CHUNK = 500;
/** Rolling maintenance window — must cover idleSync's 30-day re-pull so late events still land. */
const ROLLING_DAYS = 35;
/** First run on an empty table: backfill as far as the raw tables reach. */
const BACKFILL_DAYS = 400;
/** Segments are fetched this far before the window so already-open ones still cover early events. */
const SEGMENT_PAD_MS = 72 * 3_600_000;

export interface IdleRollupResult {
  windowDays: number;
  rows: number; // rollup rows computed for the window
  written: number; // rows actually upserted (new or changed)
}

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Generic paged reader — PostgREST caps a select at 1000 rows, so every window read must page. */
async function readAll<T>(table: string, page: (a: number, b: number) => PageResult): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const { data, error } = await page(offset, offset + READ_PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < READ_PAGE) break;
  }
  return out;
}

interface RawEngineDay { vehicle_id: string; day: string; drive_sec: number; idle_sec: number; off_sec: number; coverage_sec: number }
interface RawSession { vehicle_id: string; started_at: string; idle_sec: number; mode: string }
interface RawEvent { vehicle_id: string | null; driver_id: string | null; started_at: string; duration_sec: number }
interface RawSegment { driver_id: string; status: string; started_at: string; ended_at: string | null }
interface RawAssignment { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }
interface RawRollupRow {
  vehicle_id: string; day: string; drive_sec: number; idle_sec: number; off_sec: number; coverage_sec: number;
  managed_idle_sec: number; continuous_idle_sec: number; rest_idle_sec: number; work_idle_sec: number;
  other_idle_sec: number; attributed_driver_id: string | null;
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

/** Read every raw input for the window (org-filtered — service role bypasses RLS). */
async function readInputs(admin: SupabaseClient, orgId: string, w: {
  fromDate: string; fromIso: string; toIso: string; segFromIso: string;
}) {
  const engineDays = await readAll<RawEngineDay>("vehicle_engine_days", (a, b) =>
    admin.from("vehicle_engine_days")
      .select("vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec")
      .eq("org_id", orgId).gte("day", w.fromDate)
      .order("day", { ascending: true }).order("vehicle_id", { ascending: true }).range(a, b));
  const sessions = await readAll<RawSession>("idle_park_sessions", (a, b) =>
    admin.from("idle_park_sessions")
      .select("vehicle_id, started_at, idle_sec, mode")
      .eq("org_id", orgId).gte("started_at", w.fromIso).lte("started_at", w.toIso)
      .order("started_at", { ascending: true }).order("vehicle_id", { ascending: true }).range(a, b));
  const events = await readAll<RawEvent>("idle_events", (a, b) =>
    admin.from("idle_events")
      .select("vehicle_id, driver_id, started_at, duration_sec")
      .eq("org_id", orgId).gte("started_at", w.fromIso).lte("started_at", w.toIso)
      .order("started_at", { ascending: true }).order("id", { ascending: true }).range(a, b));
  const segments = await readAll<RawSegment>("hos_duty_segments", (a, b) =>
    admin.from("hos_duty_segments")
      .select("driver_id, status, started_at, ended_at")
      .eq("org_id", orgId).not("driver_id", "is", null)
      .gte("started_at", w.segFromIso).lte("started_at", w.toIso)
      .order("started_at", { ascending: true }).order("id", { ascending: true }).range(a, b));
  const rawAssignments = await readAll<RawAssignment>("driver_vehicle_assignments", (a, b) =>
    admin.from("driver_vehicle_assignments")
      .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
      .eq("org_id", orgId).lte("start_at", w.toIso).or(`end_at.is.null,end_at.gte.${w.fromIso}`)
      .order("start_at", { ascending: true }).order("vehicle_samsara_id", { ascending: true }).range(a, b));
  return { engineDays, sessions, events, segments, rawAssignments };
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
  const { engineDays, sessions, events, segments, rawAssignments } = await readInputs(admin, orgId, {
    fromDate,
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(endMs).toISOString(),
    segFromIso: new Date(startMs - SEGMENT_PAD_MS).toISOString(),
  });

  // Samsara ids → our ids, to resolve the assignment feed.
  const [{ data: vs }, { data: ds }] = await Promise.all([
    admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null),
    admin.from("drivers").select("id, samsara_driver_id").eq("org_id", orgId).not("samsara_driver_id", "is", null),
  ]);
  const vehBySamsara = new Map(((vs ?? []) as { id: string; samsara_vehicle_id: string }[]).map((v) => [v.samsara_vehicle_id, v.id]));
  const drvBySamsara = new Map(((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [d.samsara_driver_id, d.id]));
  const assignments: RollupAssignment[] = [];
  for (const a of rawAssignments) {
    const vehicleId = vehBySamsara.get(a.vehicle_samsara_id);
    const driverId = drvBySamsara.get(a.driver_samsara_id);
    if (!vehicleId || !driverId) continue;
    assignments.push({ vehicleId, driverId, startMs: Date.parse(a.start_at), endMs: a.end_at ? Date.parse(a.end_at) : null });
  }

  const segmentsByDriver = new Map<string, HosSegment[]>();
  for (const s of segments) {
    const arr = segmentsByDriver.get(s.driver_id) ?? [];
    arr.push({
      driverId: s.driver_id,
      status: s.status as HosStatus,
      startMs: Date.parse(s.started_at),
      endMs: s.ended_at ? Date.parse(s.ended_at) : null,
    });
    segmentsByDriver.set(s.driver_id, arr);
  }

  const rows = buildIdleRollupDays({
    engineDays: engineDays.filter((d) => d.vehicle_id).map((d) => ({
      vehicleId: d.vehicle_id, day: d.day,
      driveSec: Number(d.drive_sec), idleSec: Number(d.idle_sec),
      offSec: Number(d.off_sec), coverageSec: Number(d.coverage_sec),
    })),
    sessions: sessions.filter((s) => s.vehicle_id).map((s) => ({
      vehicleId: s.vehicle_id, startedAtMs: Date.parse(s.started_at),
      idleSec: Number(s.idle_sec), mode: s.mode,
    })),
    events: events.filter((e) => e.vehicle_id).map((e) => ({
      vehicleId: e.vehicle_id!, driverId: e.driver_id,
      startMs: Date.parse(e.started_at), durationSec: Number(e.duration_sec),
    })),
    segmentsByDriver,
    assignments,
    windowStartMs: startMs,
    windowEndMs: endMs,
  });

  // Diff against stored rollup rows → write only new/changed days.
  const existing = await readAll<RawRollupRow>("idle_rollup_days", (a, b) =>
    admin.from("idle_rollup_days")
      .select("vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, attributed_driver_id")
      .eq("org_id", orgId).gte("day", fromDate)
      .order("day", { ascending: true }).order("vehicle_id", { ascending: true }).range(a, b));
  const byKey = new Map(existing.map((r) => [`${r.vehicle_id}|${r.day}`, r]));

  const now = new Date().toISOString();
  const writes: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (rollupUnchanged(byKey.get(`${r.vehicleId}|${r.day}`), r)) continue;
    writes.push({
      org_id: orgId, vehicle_id: r.vehicleId, day: r.day,
      drive_sec: r.driveSec, idle_sec: r.idleSec, off_sec: r.offSec, coverage_sec: r.coverageSec,
      managed_idle_sec: r.managedIdleSec, continuous_idle_sec: r.continuousIdleSec,
      rest_idle_sec: r.restIdleSec, work_idle_sec: r.workIdleSec, other_idle_sec: r.otherIdleSec,
      attributed_driver_id: r.attributedDriverId, updated_at: now,
    });
  }
  for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
    const { error } = await admin
      .from("idle_rollup_days")
      .upsert(writes.slice(i, i + UPSERT_CHUNK), { onConflict: "org_id,vehicle_id,day" });
    if (error) throw new Error(error.message);
  }
  return { windowDays, rows: rows.length, written: writes.length };
}
