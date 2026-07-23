/**
 * Park-session detection + idle-MODE classification (pure, testable) — the precision layer of the idle
 * feature. Samsara's Idling Events only cover engine-ON idle; to tell WASTEFUL continuous idle apart from the
 * good behaviors (ECU optimized-idle cycling, or engine-off/APU) we look at the raw `engineStates` time
 * series across each park (stationary) session. This also lets us LEARN each truck's idle capability so a
 * driver on a non-APU truck isn't scored like one who could have shut the engine off.
 *
 * There is no APU field or engine-start counter in Samsara (verified), so the mode is derived from the
 * Off/On/Idle pattern: "On" = driving (splits parks), "Idle" = engine-on idle, "Off" = shut down / APU.
 */

import { dayInTz } from "./dashboard.js";
import { zonedWallTimeToUtcIso } from "./efsImport/index.js";

export type EngineState = "Off" | "On" | "Idle";

export interface EngineSample {
  /** epoch ms of the state change; the state holds until the next sample. */
  t: number;
  state: EngineState;
  /** mph at that instant (from the gps decoration), when available. */
  speedMph?: number;
}

/** Parse a Samsara `/fleet/vehicles/stats/history?types=engineStates&decorations=gps` response into per-asset
 *  engine-state series (with the decorated GPS speed). Defensive about the decoration nesting. */
export function parseEngineStates(response: { data?: unknown[] }): Map<string, EngineSample[]> {
  const out = new Map<string, EngineSample[]>();
  for (const raw of response.data ?? []) {
    const a = raw as { id?: string | number; engineStates?: unknown[] };
    if (a.id == null) continue;
    const series: EngineSample[] = [];
    for (const e of a.engineStates ?? []) {
      const p = e as { time?: string; value?: string; decorations?: { gps?: { speedMilesPerHour?: number } } };
      if (!p.time || (p.value !== "Off" && p.value !== "On" && p.value !== "Idle")) continue;
      const t = Date.parse(p.time);
      if (Number.isFinite(t)) series.push({ t, state: p.value, speedMph: p.decorations?.gps?.speedMilesPerHour });
    }
    out.set(String(a.id), series);
  }
  return out;
}

export type IdleMode = "continuous" | "optimized_cycling" | "apu_or_off";

export interface IdleSession {
  startMs: number;
  endMs: number;
  durationSec: number;
  /** seconds the engine spent idling (Idle, or On while stationary) during the session. */
  idleSec: number;
  /** seconds the engine was Off during the session (APU/hotel-load or shut down). */
  offSec: number;
  /** Off ↔ running transitions within the session — the ECU auto start/stop cycling signal. */
  cycles: number;
  mode: IdleMode;
}

export interface IdleSessionOpts {
  /** A park session must be at least this long (default 30 min). Shorter stops aren't rest/wait/load. */
  minSessionSec?: number;
  /** Above this speed the truck is DRIVING, which ends a park session (default 5 mph). */
  movingMph?: number;
  /** Off-time share above which the session is APU/off (default 0.6). */
  offDominantShare?: number;
  /** Off↔running transitions at/above which a session counts as ECU optimized cycling (default 4). */
  minCycles?: number;
}

const DEF: Required<IdleSessionOpts> = { minSessionSec: 1800, movingMph: 5, offDominantShare: 0.6, minCycles: 4 };

/**
 * Is this interval the truck DRIVING? Such intervals bound/split park sessions.
 *
 * Samsara's engineStates enum already separates driving from idling: "On" = engine running AND moving (a
 * drive), "Idle" = running but stationary, "Off" = shut down. So "On" is the RELIABLE drive signal. We must NOT
 * depend on the GPS speed decorated at a state-change instant — that sample fires the moment the state flips,
 * usually while the truck is still stationary (speed ≈ 0), which made almost no interval look like driving and
 * left long parks unsplit (so most trucks fell under the session floor and never got a learned capability —
 * audit A1.1). Speed is kept only as a secondary confirmation for the rare mislabeled "Idle" with real motion.
 */
function isDriving(s: EngineSample, movingMph: number): boolean {
  if (s.state === "On") return true;
  return s.state !== "Off" && s.speedMph != null && s.speedMph > movingMph;
}

/**
 * Build park (stationary) sessions from an engine-state time series and classify each one's idle mode.
 * Samples are state CHANGES: sample[i].state holds from sample[i].t until sample[i+1].t.
 */
export function buildIdleSessions(samples: EngineSample[], opts: IdleSessionOpts = {}): IdleSession[] {
  const o = { ...DEF, ...opts };
  const s = [...samples].filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (s.length < 2) return [];

  const sessions: IdleSession[] = [];
  let cur: { startMs: number; idleSec: number; offSec: number; cycles: number; lastRunning: boolean | null } | null = null;

  const close = (endMs: number) => {
    if (!cur) return;
    const durationSec = (endMs - cur.startMs) / 1000;
    if (durationSec >= o.minSessionSec && cur.idleSec + cur.offSec > 0) {
      const offShare = cur.offSec / (cur.idleSec + cur.offSec);
      let mode: IdleMode;
      if (offShare >= o.offDominantShare) mode = "apu_or_off";
      else if (cur.cycles >= o.minCycles && cur.offSec > 0) mode = "optimized_cycling";
      else mode = "continuous";
      sessions.push({ startMs: cur.startMs, endMs, durationSec: Math.round(durationSec), idleSec: Math.round(cur.idleSec), offSec: Math.round(cur.offSec), cycles: cur.cycles, mode });
    }
    cur = null;
  };

  for (let i = 0; i < s.length - 1; i++) {
    const seg = s[i]!;
    const durSec = (s[i + 1]!.t - seg.t) / 1000;
    if (durSec <= 0) continue;

    if (isDriving(seg, o.movingMph)) {
      close(seg.t); // driving ends any open park session
      continue;
    }
    // Parked interval (engine Off, or On/Idle while stationary).
    if (!cur) cur = { startMs: seg.t, idleSec: 0, offSec: 0, cycles: 0, lastRunning: null };
    const running = seg.state !== "Off";
    if (running) cur.idleSec += durSec;
    else cur.offSec += durSec;
    // Count an Off↔running transition (the auto start/stop cycle).
    if (cur.lastRunning != null && cur.lastRunning !== running) cur.cycles += 1;
    cur.lastRunning = running;
  }
  close(s[s.length - 1]!.t);
  return sessions;
}

export type IdleCapability = "apu" | "ecu_optimized" | "continuous_only" | "unknown";

export interface IdleCapabilityResult {
  capability: IdleCapability;
  /** Share (0–100) of parked (idle+off) time in sessions that used a good mode (cycling or APU/off). */
  optimizedPct: number;
  sessions: number;
}

/**
 * Learn a truck's idle capability from its park sessions. If it routinely sits Off through long parks it has
 * an APU (or drivers shut down); if it cycles it has ECU optimized idle; if long parks are always continuous
 * idle it has neither in use. `optimizedPct` is the share of parked time spent in a good mode — the number a
 * fair driver score rewards. Needs a few sessions, else `unknown`.
 */
export function learnIdleCapability(sessions: IdleSession[], opts: { minSessions?: number } = {}): IdleCapabilityResult {
  const minSessions = opts.minSessions ?? 4;
  if (sessions.length < minSessions) return { capability: "unknown", optimizedPct: 0, sessions: sessions.length };

  let apuTime = 0;
  let cycleTime = 0;
  let contTime = 0;
  for (const s of sessions) {
    const parked = s.idleSec + s.offSec;
    if (s.mode === "apu_or_off") apuTime += parked;
    else if (s.mode === "optimized_cycling") cycleTime += parked;
    else contTime += parked;
  }
  const total = apuTime + cycleTime + contTime;
  const optimizedPct = total > 0 ? Math.round(((apuTime + cycleTime) / total) * 1000) / 10 : 0;

  // Capability = the best mode the truck DEMONSTRABLY uses on a meaningful share of parked time.
  let capability: IdleCapability;
  if (apuTime / Math.max(total, 1) >= 0.25) capability = "apu";
  else if (cycleTime / Math.max(total, 1) >= 0.25) capability = "ecu_optimized";
  else capability = "continuous_only";
  return { capability, optimizedPct, sessions: sessions.length };
}

// ── per-day engine-time rollup (the "engine-on = drive + idle" foundation) ────────────────────────────

/** Per-day engine-time split for one truck, derived purely from its engineStates series (see aggregateEngineDays). */
export interface EngineDay {
  /** Calendar day (YYYY-MM-DD) in the chosen timezone (UTC unless tzOffsetMinutes is given). */
  day: string;
  /** Seconds the engine was running AND moving (Samsara state "On"). */
  driveSec: number;
  /** Seconds the engine was running but stationary (state "Idle"). */
  idleSec: number;
  /** Seconds the engine was shut down (state "Off"). */
  offSec: number;
  /** Seconds of the day actually accounted for by samples (= drive+idle+off). ÷86400 = data confidence. */
  coverageSec: number;
  /** The UTC offset (minutes) of the boundary this day was bucketed on — 0 for UTC, e.g. -360 for US Central,
   *  -300 the same fleet on Central DST. Records the exact clock the day was cut on for auditability. */
  tzOffsetMinutes: number;
}

/**
 * Roll a truck's engineStates series into per-day drive / idle / off / coverage seconds — the reliable
 * "engine-on = drive + idle" foundation for the idle module. Samsara samples are STATE CHANGES: sample[i]
 * holds from sample[i].t until sample[i+1].t, so each interval is attributed to exactly one state. Intervals
 * that cross a day boundary are split at midnight so no time is double-counted or lost, and a multi-day
 * interval (e.g. a truck left Off over a weekend) contributes to every day it spans. Time before the first
 * sample or after the last is NOT invented — coverage reflects only what the data actually shows.
 *
 * The day boundary matches the fleet's operating clock. Pass `tz` (an IANA zone, e.g. "America/Chicago") for
 * a DST-correct boundary — the preferred path; each day is cut on that zone's real local midnight, so a truck
 * left idling across local midnight is split on the right hour even across a DST change. `tzOffsetMinutes` is
 * the older fixed-offset boundary (e.g. -360 for US Central, no DST). Default (neither given) = UTC, which is
 * deterministic and tz-free. `tz` wins when both are supplied.
 */
export function aggregateEngineDays(
  samples: EngineSample[],
  opts: { tz?: string | null; tzOffsetMinutes?: number } = {},
): EngineDay[] {
  const s = [...samples].filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (s.length < 2) return [];

  const tz = opts.tz || null; // IANA zone → DST-correct path
  const fixedOffMin = opts.tzOffsetMinutes ?? 0;
  const fixedTzMs = fixedOffMin * 60_000;
  const utcMidnightMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
  const addOneDay = (day: string) => new Date(utcMidnightMs(day) + 86_400_000).toISOString().slice(0, 10);

  let dayKey: (ms: number) => string;
  let nextLocalMidnight: (ms: number) => number;
  let dayOffsetMin: (day: string) => number;

  if (tz) {
    // DST-correct: local calendar day + the real UTC instant of each local midnight for this zone.
    const localMidnightMs = (day: string) => Date.parse(zonedWallTimeToUtcIso(day, "00:00:00", tz));
    dayKey = (ms) => dayInTz(new Date(ms).toISOString(), tz);
    nextLocalMidnight = (ms) => localMidnightMs(addOneDay(dayKey(ms)));
    dayOffsetMin = (day) => Math.round((utcMidnightMs(day) - localMidnightMs(day)) / 60_000);
  } else {
    // Fixed-offset (or UTC): simple arithmetic, no DST awareness.
    dayKey = (ms) => new Date(ms + fixedTzMs).toISOString().slice(0, 10);
    nextLocalMidnight = (ms) => {
      const d = new Date(ms + fixedTzMs);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - fixedTzMs;
    };
    dayOffsetMin = () => fixedOffMin;
  }

  const days = new Map<string, { drive: number; idle: number; off: number }>();
  for (let i = 0; i < s.length - 1; i++) {
    const state = s[i]!.state;
    let from = s[i]!.t;
    const to = s[i + 1]!.t;
    if (to <= from) continue;
    while (from < to) {
      const boundary = Math.min(to, nextLocalMidnight(from));
      const sec = (boundary - from) / 1000;
      const key = dayKey(from);
      const b = days.get(key) ?? { drive: 0, idle: 0, off: 0 };
      if (state === "On") b.drive += sec;
      else if (state === "Idle") b.idle += sec;
      else b.off += sec;
      days.set(key, b);
      from = boundary;
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, b]) => ({
      day,
      driveSec: Math.round(b.drive),
      idleSec: Math.round(b.idle),
      offSec: Math.round(b.off),
      coverageSec: Math.round(b.drive + b.idle + b.off),
      tzOffsetMinutes: dayOffsetMin(day),
    }));
}
