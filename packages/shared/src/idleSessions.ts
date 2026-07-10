/**
 * Park-session detection + idle-MODE classification (pure, testable) — the precision layer of the idle
 * feature. Samsara's Idling Events only cover engine-ON idle; to tell WASTEFUL continuous idle apart from the
 * good behaviors (ECU optimized-idle cycling, or engine-off/APU) we look at the raw `engineStates` time
 * series across each park (stationary) session. This also lets us LEARN each truck's idle capability so a
 * driver on a non-APU truck isn't scored like one who could have shut the engine off.
 *
 * There is no APU field or engine-start counter in Samsara (verified), so the mode is derived from the
 * Off/On/Idle pattern + GPS speed.
 */

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

/** Is this interval the truck DRIVING (engine on + moving)? Such intervals bound/split park sessions. */
function isDriving(s: EngineSample, movingMph: number): boolean {
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
