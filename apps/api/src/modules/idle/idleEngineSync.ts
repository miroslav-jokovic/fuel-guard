/**
 * The idle engine's collector (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE2, D-IE8): Samsara is the
 * buffer, so nothing raw is stored — each run fetches a window, classifies it in memory with the pure
 * `classifyIdleEngine` (`packages/shared/src/idleEngine/`), and replaces that window's rows through
 * `idle_engine_write` (0404). It runs IN PARALLEL with today's idle numbers and switches nothing
 * (D-IE9 is IE5).
 *
 * ── TWO WINDOWS, ONE JOB ───────────────────────────────────────────────────────────────────────
 *   hourly   the trailing three whole hours. Consecutive runs overlap by two, so a gateway that
 *            uploads late is re-read twice before its hour leaves the window.
 *   nightly  the previous two local days up to the current hour, once a night (D-IE8: a day is final
 *            at 72 h). Chosen INSIDE the hourly run — when the org's local hour is 02–05 and no
 *            nightly run has finished in 20 h — rather than by a second timer, for two reasons: a
 *            24-hour `setInterval` restarts on every deploy and this service deploys several times a
 *            day, so it would rarely fire; and one job kind is one (org, kind) slot, so the two
 *            windows can never be written concurrently (two replaces of the same primary keys racing
 *            in two transactions end in a unique violation, not a merge).
 *
 * ── WHAT EACH TRUCK'S FETCH COVERS, AND WHY ──────────────────────────────────────────────────────
 *   engine flips + counters  from 24 h before the window (`stats/history` has no carry-in — 662's
 *            18:00Z window opened on its 18:51 flip, measured 2026-10-02), or from the start of the
 *            truck's stored park in progress when that is earlier, so the park is recomputed whole.
 *            Both series are sparse while parked; 75 h of the fleet's flips is 18 pages.
 *   GPS      from 15 minutes before the window (enough for the 60 s debounce to know the motion at
 *            its start). An hour of the fleet's GPS is ~40k fixes, 7 pages — the expensive series,
 *            so it is never fetched for a park's past: the stored row already says it was parked.
 *   seed     when a truck has no flip in its fetch, the engine state holding all along is its LATEST
 *            flip from `/fleet/vehicles/stats`, if that flip is older than the fetch — a truck shut
 *            down for a week is off, not unknown. Otherwise unknown, and `no_data` is never off.
 *
 * Trucks long parked fetch alone (their window reaches back days); the rest in batches of 20.
 * Only in-service trucks (`IN_SERVICE_VEHICLE_STATUSES`): not one on order, not one gone. A batch whose fetch stopped at the page cap is NOT written: a replace
 * of a window it did not fully read would delete good rows, so it is counted and left for the next
 * run.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyIdleEngine,
  dayInTz,
  IDLE_ENGINE_VERSION,
  IN_SERVICE_VEHICLE_STATUSES,
  organizationTimezone,
  parseCounter,
  parseEngineFlips,
  parseMotionFixes,
  type IdleEngineHour,
  type IdleEngineStop,
  zonedWallTimeToUtcIso,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "../samsara/lib/samsaraToken.js";
import {
  makeSamsaraStatsHistoryFetcher,
  makeSamsaraStatsSnapshotFetcher,
  type StatsHistoryFetcher,
  type StatsSnapshotFetcher,
} from "../samsara/lib/samsaraStatsHistory.js";
import { NoSamsaraTokenError } from "../samsara/index.js";

const HOUR = 3_600_000;
const BATCH = 20;
const HOURLY_WINDOW_H = 3;
const NIGHTLY_DAYS = 2;
const ENGINE_LOOKBACK_MS = 24 * HOUR;
const GPS_LOOKBACK_MS = 15 * 60_000;
/** A park reaching further back than the engine lookback makes its truck fetch alone. */
const LONG_PARK_MS = ENGINE_LOOKBACK_MS;
const NIGHTLY_LOCAL_HOURS = [2, 3, 4, 5];
const NIGHTLY_EVERY_MS = 20 * HOUR;
const DEFAULT_MIN_IDLE_MINUTES = 5;

export type IdleEngineMode = "hourly" | "nightly";

export interface IdleEngineSyncResult {
  mode: IdleEngineMode;
  from: string;
  to: string;
  vehicles: number;
  batches: number;
  incompleteBatches: number;
  hours: number;
  stops: number;
  days: number;
  /** Trucks whose whole window was `no_data` — no engine state at all. */
  vehiclesNoEngine: number;
  pages: number;
}

interface VehicleRow {
  id: string;
  samsara_vehicle_id: string;
}

/** Local midnight `days` days before the local day containing `nowMs`, as an instant. */
function localMidnightBefore(nowMs: number, tz: string, days: number): number {
  const today = dayInTz(new Date(nowMs).toISOString(), tz);
  const d = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  return Date.parse(zonedWallTimeToUtcIso(d, "00:00:00", tz));
}

function localHour(nowMs: number, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(nowMs));
}

/** Is the nightly recompute due on this run? (No nightly run finished in the last 20 h, local 02–05.) */
async function nightlyDue(admin: SupabaseClient, orgId: string, nowMs: number, tz: string): Promise<boolean> {
  if (!NIGHTLY_LOCAL_HOURS.includes(localHour(nowMs, tz))) return false;
  const { data, error } = await admin
    .from("jobs")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "idle_engine")
    .eq("status", "done")
    .eq("stats->>mode", "nightly")
    .gte("finished_at", new Date(nowMs - NIGHTLY_EVERY_MS).toISOString())
    .limit(1);
  if (error) throw new Error(`idle engine: nightly check: ${error.message}`);
  return (data ?? []).length === 0;
}

export async function syncIdleEngine(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: {
    nowMs?: number;
    mode?: IdleEngineMode;
    historyFetcher?: StatsHistoryFetcher;
    snapshotFetcher?: StatsSnapshotFetcher;
  } = {},
): Promise<IdleEngineSyncResult> {
  const injected = opts.historyFetcher && opts.snapshotFetcher;
  const token = injected ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const history = opts.historyFetcher ?? makeSamsaraStatsHistoryFetcher(env, token);
  const snapshot = opts.snapshotFetcher ?? makeSamsaraStatsSnapshotFetcher(env, token);

  const nowMs = opts.nowMs ?? Date.now();
  const { data: orgRow } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const tz = organizationTimezone(orgRow?.operating_hours);
  const { data: settings } = await admin.from("idle_settings").select("min_idle_minutes").eq("org_id", orgId).maybeSingle();
  const minIdleSec = Number(settings?.min_idle_minutes ?? DEFAULT_MIN_IDLE_MINUTES) * 60;

  const mode = opts.mode ?? ((await nightlyDue(admin, orgId, nowMs, tz)) ? "nightly" : "hourly");
  const toMs = Math.floor(nowMs / HOUR) * HOUR;
  const fromMs = mode === "nightly" ? localMidnightBefore(nowMs, tz, NIGHTLY_DAYS) : toMs - HOURLY_WINDOW_H * HOUR;
  const result: IdleEngineSyncResult = {
    mode,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    vehicles: 0,
    batches: 0,
    incompleteBatches: 0,
    hours: 0,
    stops: 0,
    days: 0,
    vehiclesNoEngine: 0,
    pages: 0,
  };

  const { data: vs, error: verr } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .in("status", [...IN_SERVICE_VEHICLE_STATUSES])
    .not("samsara_vehicle_id", "is", null);
  if (verr) throw new Error(`idle engine: vehicles: ${verr.message}`);
  const vehicles = ((vs ?? []) as VehicleRow[]).filter((v) => v.samsara_vehicle_id);
  result.vehicles = vehicles.length;
  if (vehicles.length === 0) return result;

  // The park each truck is in at the window's start, if one is stored (at most one per truck).
  const { data: openRows, error: oerr } = await admin
    .from("idle_engine_stops")
    .select("vehicle_id, started_at, start_observed")
    .eq("org_id", orgId)
    .lt("started_at", new Date(fromMs).toISOString())
    .or(`ended_at.is.null,ended_at.gt.${new Date(fromMs).toISOString()}`);
  if (oerr) throw new Error(`idle engine: parks in progress: ${oerr.message}`);
  const parked = new Map<string, { sinceMs: number; startObserved: boolean }>();
  for (const r of (openRows ?? []) as { vehicle_id: string; started_at: string; start_observed: boolean }[]) {
    parked.set(r.vehicle_id, { sinceMs: Date.parse(r.started_at), startObserved: r.start_observed });
  }

  const seeds = new Map<string, { t: number; on: boolean }>();
  for (const v of await snapshot(["engineStates"])) {
    const s = v.engineState as { time?: string; value?: string } | undefined;
    const t = s?.time ? Date.parse(s.time) : NaN;
    if (v.id != null && Number.isFinite(t) && s?.value) seeds.set(String(v.id), { t, on: s.value !== "Off" });
  }

  const spanStartOf = (v: VehicleRow) => Math.min(fromMs - ENGINE_LOOKBACK_MS, parked.get(v.id)?.sinceMs ?? Infinity);
  const longParked = vehicles.filter((v) => spanStartOf(v) < fromMs - LONG_PARK_MS);
  const rest = vehicles.filter((v) => !longParked.includes(v));
  const groups: VehicleRow[][] = [...longParked.map((v) => [v])];
  for (let i = 0; i < rest.length; i += BATCH) groups.push(rest.slice(i, i + BATCH));

  for (const group of groups) {
    result.batches += 1;
    const ids = group.map((v) => v.samsara_vehicle_id);
    const spanStartMs = Math.min(...group.map(spanStartOf));
    const span = new Date(spanStartMs).toISOString();
    const end = new Date(nowMs).toISOString();
    const engineAndFuel = await history(ids, ["engineStates", "fuelConsumedMilliliters", "obdEngineSeconds"], span, end);
    const ambient = await history(ids, ["ambientAirTemperatureMilliC"], span, end);
    const gps = await history(ids, ["gps"], new Date(fromMs - GPS_LOOKBACK_MS).toISOString(), end);
    result.pages += engineAndFuel.pages + ambient.pages + gps.pages;
    if (!engineAndFuel.complete || !ambient.complete || !gps.complete) {
      result.incompleteBatches += 1;
      continue;
    }
    const flips = parseEngineFlips(engineAndFuel.data);
    const fuel = parseCounter(engineAndFuel.data, "fuelConsumedMilliliters");
    const engineSec = parseCounter(engineAndFuel.data, "obdEngineSeconds");
    const amb = parseCounter(ambient.data, "ambientAirTemperatureMilliC");
    const fixes = parseMotionFixes(gps.data);

    const hours: (IdleEngineHour & { vehicleId: string })[] = [];
    const stops: (IdleEngineStop & { vehicleId: string })[] = [];
    for (const v of group) {
      const sid = v.samsara_vehicle_id;
      const engine = flips.get(sid) ?? [];
      const seed = seeds.get(sid);
      const out = classifyIdleEngine({
        fromMs,
        toMs,
        dataEndMs: nowMs,
        spanStartMs,
        engine,
        engineSeed: engine.length === 0 && seed && seed.t <= spanStartMs ? seed.on : null,
        gps: fixes.get(sid) ?? [],
        parked: parked.get(v.id) ?? null,
        fuelMl: fuel.get(sid) ?? [],
        engineSec: engineSec.get(sid) ?? [],
        ambientMilliC: amb.get(sid) ?? [],
        minIdleSec,
      });
      if (out.hours.every((h) => h.noDataSec === 3600)) result.vehiclesNoEngine += 1;
      hours.push(...out.hours.map((h) => ({ ...h, vehicleId: v.id })));
      stops.push(...out.stops.map((s) => ({ ...s, vehicleId: v.id })));
    }

    const { data: written, error } = await admin.rpc("idle_engine_write", {
      p_org: orgId,
      p_vehicles: group.map((v) => v.id),
      p_from: new Date(fromMs).toISOString(),
      p_to: new Date(toMs).toISOString(),
      p_tz: tz,
      p_hours: hours.map(hourRow),
      p_stops: stops.map(stopRow),
    });
    if (error) throw new Error(`idle engine: write: ${error.message}`);
    const w = (written ?? {}) as { hours?: number; stops?: number; days?: number };
    result.hours += w.hours ?? 0;
    result.stops += w.stops ?? 0;
    result.days += w.days ?? 0;
  }
  return result;
}

function hourRow(h: IdleEngineHour & { vehicleId: string }) {
  return {
    vehicle_id: h.vehicleId,
    hour_start: new Date(h.hourStartMs).toISOString(),
    driving_sec: h.drivingSec,
    stopped_running_sec: h.stoppedRunningSec,
    brief_stop_sec: h.briefStopSec,
    engine_off_sec: h.engineOffSec,
    no_data_sec: h.noDataSec,
    fuel_ml: h.fuelMl,
    engine_sec: h.engineSec,
    engine_starts: h.engineStarts,
    ambient_milli_c: h.ambientMilliC,
    classifier_version: IDLE_ENGINE_VERSION,
  };
}

function stopRow(s: IdleEngineStop & { vehicleId: string }) {
  return {
    vehicle_id: s.vehicleId,
    started_at: new Date(s.startedAtMs).toISOString(),
    ended_at: s.endedAtMs == null ? null : new Date(s.endedAtMs).toISOString(),
    start_observed: s.startObserved,
    duration_sec: s.durationSec,
    running_sec: s.runningSec,
    off_sec: s.offSec,
    no_data_sec: s.noDataSec,
    engine_starts: s.engineStarts,
    longest_run_sec: s.longestRunSec,
    fuel_ml: s.fuelMl,
    lat: s.lat,
    lng: s.lng,
    place: s.place,
    state: s.state,
    ambient_milli_c: s.ambientMilliC,
    classifier_version: IDLE_ENGINE_VERSION,
  };
}
