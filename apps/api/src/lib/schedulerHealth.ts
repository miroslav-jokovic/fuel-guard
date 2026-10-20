import type { Env } from "../env.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { SCHEDULER_LANES, type SchedulerLane } from "../schedulerLanes.js";

/**
 * Is anybody running the background work? One state per scheduler lane, from the lane's lease row
 * (0506). PLATFORM-RELIABILITY-PLAN D-RLY3.
 *
 * Before this, "the schedulers stopped" was invisible from outside: the API answered, `/api/version`
 * said ok, and the feeds simply went quiet until an office noticed stale numbers (fuelSweepFreshness.ts
 * says so of itself: it cannot report a scheduler that is not running). A lease that nobody renews is
 * that failure, measured in seconds.
 *
 *  · `held`      — a process renewed the lease and it has not expired.
 *  · `handover`  — expired, but less than HANDOVER_GRACE_S ago: a deploy's SIGTERM releases the lease and
 *                  the standby takes it within one 15 s tick; a crashed holder's lane is taken within
 *                  ~75 s. Healthy — a monitor that paged on every deploy would be muted within a week.
 *  · `stale`     — expired longer ago than that. Nobody is running the lane.
 *  · `missing`   — no process has EVER held it: a lane added to schedulerLanes.ts with nothing deployed
 *                  to run it, or a SCHEDULER_LANES list that left it out everywhere.
 *  · `unknown`   — the read failed (database unreachable, or the table not there yet on staging).
 *
 * Every lane is listed, from SCHEDULER_LANES — derived, so a new lane is monitored the day it exists.
 * Public on `/api/version`: lane names and seconds only. The holder (service, replica, pid) is not
 * published; it is in the row for whoever reads the database after an alarm.
 */
export type LaneState = "held" | "handover" | "stale" | "missing" | "unknown";

export interface LaneHealth {
  lane: SchedulerLane;
  state: LaneState;
  /** Seconds since the holder last renewed; null when there is no row or the read failed. */
  secondsSinceRenewal: number | null;
}

/** Longer than the worst unplanned take-over (TTL 60 s + a 15 s standby tick) with room to spare. */
export const HANDOVER_GRACE_S = 120;

export function laneHealthy(state: LaneState): boolean {
  return state === "held" || state === "handover";
}

interface LeaseRow {
  lane: string;
  renewed_at: string;
  expires_at: string;
}

/** Pure: rows (or a failed read) → one entry per known lane. Exported for its test. */
export function toLaneHealth(rows: readonly LeaseRow[] | null, nowMs: number): LaneHealth[] {
  return SCHEDULER_LANES.map((lane) => {
    if (rows === null) return { lane, state: "unknown" as const, secondsSinceRenewal: null };
    const row = rows.find((r) => r.lane === lane);
    if (!row) return { lane, state: "missing" as const, secondsSinceRenewal: null };
    const renewed = Date.parse(row.renewed_at);
    const expires = Date.parse(row.expires_at);
    if (!Number.isFinite(renewed) || !Number.isFinite(expires)) return { lane, state: "unknown" as const, secondsSinceRenewal: null };
    const secondsSinceRenewal = Math.max(0, Math.round((nowMs - renewed) / 1000));
    const state: LaneState =
      expires > nowMs ? "held" : nowMs - expires < HANDOVER_GRACE_S * 1000 ? "handover" : "stale";
    return { lane, state, secondsSinceRenewal };
  });
}

/** Same 30-second cache as the schema and maintenance reads behind the same public endpoint. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: LaneHealth[] } | null = null;

export function resetSchedulerHealthCache(): void {
  cache = null;
}

export async function getSchedulerHealth(env: Env, now = Date.now()): Promise<LaneHealth[]> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let rows: LeaseRow[] | null;
  try {
    const { data, error } = await getSupabaseAdmin(env)
      .from("platform_scheduler_leases")
      .select("lane, renewed_at, expires_at");
    rows = error ? null : ((data ?? []) as LeaseRow[]);
  } catch {
    rows = null; // Supabase unconfigured (local/test) — unknown, never thrown
  }
  const value = toLaneHealth(rows, now);
  cache = { at: now, value };
  return value;
}
