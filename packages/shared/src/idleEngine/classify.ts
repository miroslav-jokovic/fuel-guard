/**
 * The idle engine's classifier: one truck's engine flips, GPS fixes and counters in, hour rows and stop
 * rows out (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md D-IE1, D-IE2, D-IE3; stored by migration 0404). Pure —
 * no clocks, no IO — so the hourly run, the nightly run and a test are the same call.
 *
 * FIVE BUCKETS (D-IE2), per instant:
 *   engine unknown                         → no_data   (never counted as off)
 *   engine off                             → engine_off
 *   running, moving                        → driving
 *   running, stopped, in a brief stop      → brief_stop
 *   running, stopped                       → stopped_running
 *   running, motion unknown                → no_data
 * A stop is BRIEF when it lasts less than `minIdleSec` (Q-IE9: per stop, not per engine run — a battery
 * APU truck cycling on for three minutes at a time through a rest is not in traffic).
 *
 * STOPS (D-IE3) are the debounced stopped stretches, one per park, stop → move. Two stretches either
 * side of a motion gap are one park when the truck is where it was (`bridgeMeters`); the gap's seconds
 * stay `no_data` inside it. A stop still stopped when the data ends is open (`endedAtMs` null). A stop
 * in progress at the window's start is continued from the stored row (`parked`): motion before the
 * window is taken as stopped since `parked.sinceMs`, because the run that stored it saw that far, and
 * the collector re-fetched the engine and counters from there. With no stored row, a stop already in
 * progress when the GPS begins starts at the first fix, `startObserved: false` (Q-IE10).
 *
 * Seconds are rounded so an hour's buckets add up to exactly 3,600 and a stop's parts to its duration
 * — the two CHECKs in 0404 — by the largest-remainder method, never by nudging the biggest bucket.
 */

import { counterDelta, meanIn, type CounterReading } from "./counters.js";
import {
  debouncedMotion,
  engineSegments,
  IDLE_ENGINE_MOTION,
  metersBetween,
  mergeSegs,
  pieces,
  rawMotionSegments,
  type EngineFlip,
  type MotionFix,
  type Motion,
  type Seg,
} from "./timeline.js";

/** Stored on every row; bump it when a rule here changes what a row would say. */
export const IDLE_ENGINE_VERSION = "ie2-v1";

const HOUR = 3_600_000;

export interface IdleEngineInput {
  /** Hour-aligned window of hour rows to emit, [fromMs, toMs). */
  fromMs: number;
  toMs: number;
  /** Where the data ends (the fetch's end, at or after toMs). A stop still stopped here is open. */
  dataEndMs: number;
  /** Where the engine and counter histories begin (the collector's lookback). */
  spanStartMs: number;
  engine: EngineFlip[];
  /** The engine state holding before the first flip; null when unknown. */
  engineSeed: boolean | null;
  gps: MotionFix[];
  /** The stored stop in progress at `fromMs`, if any. */
  parked: { sinceMs: number; startObserved: boolean } | null;
  fuelMl: CounterReading[];
  engineSec: CounterReading[];
  ambientMilliC: CounterReading[];
  /** `idle_settings.min_idle_minutes` × 60. */
  minIdleSec: number;
  motion?: Partial<typeof IDLE_ENGINE_MOTION>;
}

export interface IdleEngineHour {
  hourStartMs: number;
  drivingSec: number;
  stoppedRunningSec: number;
  briefStopSec: number;
  engineOffSec: number;
  noDataSec: number;
  fuelMl: number | null;
  engineSec: number | null;
  engineStarts: number;
  ambientMilliC: number | null;
}

export interface IdleEngineStop {
  startedAtMs: number;
  endedAtMs: number | null;
  startObserved: boolean;
  durationSec: number;
  runningSec: number;
  offSec: number;
  noDataSec: number;
  engineStarts: number;
  longestRunSec: number;
  fuelMl: number | null;
  lat: number | null;
  lng: number | null;
  place: string | null;
  state: string | null;
  ambientMilliC: number | null;
}

type Bucket = "driving" | "stopped_running" | "brief_stop" | "engine_off" | "no_data";

/** Round millisecond parts to whole seconds that add up to exactly `totalSec`. */
export function roundParts(ms: number[], totalSec: number): number[] {
  const exact = ms.map((m) => m / 1000);
  const out = exact.map(Math.floor);
  let rest = totalSec - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length, rest--) out[order[k]!.i]! += 1;
  for (let k = 0; rest < 0 && order.length; k = (k + 1) % order.length) {
    const idx = order[order.length - 1 - k]!.i;
    if (out[idx]! > 0) {
      out[idx]! -= 1;
      rest++;
    }
  }
  return out;
}

/** "Florida's Turnpike, Indian River County, FL" → "FL". */
export function stateOfPlace(place: string | null | undefined): string | null {
  const m = /,\s*([A-Z]{2})\s*$/.exec(place ?? "");
  return m ? m[1]! : null;
}

interface StopSpan {
  s: number;
  e: number;
  startObserved: boolean;
}

/** Debounced stopped stretches, bridged across motion gaps where the truck did not move. */
function stopSpans(motion: Seg<Motion | null>[], gps: MotionFix[], bridgeMeters: number, observedFrom: number, parked: IdleEngineInput["parked"]): StopSpan[] {
  const fixAt = (t: number, dir: -1 | 1) => {
    const c = gps.filter((g) => g.lat != null && g.lng != null && (dir < 0 ? g.t <= t : g.t >= t));
    return dir < 0 ? c[c.length - 1] : c[0];
  };
  const spans: StopSpan[] = [];
  for (let i = 0; i < motion.length; i++) {
    const m = motion[i]!;
    if (m.v !== "stopped") continue;
    const prev = spans[spans.length - 1];
    const between = motion[i - 1];
    if (prev && between && between.v === null && between.s === prev.e) {
      const a = fixAt(prev.e, -1);
      const b = fixAt(m.s, 1);
      if (a && b && metersBetween(a as { lat: number; lng: number }, b as { lat: number; lng: number }) <= bridgeMeters) {
        prev.e = m.e;
        continue;
      }
    }
    // A stretch opening the timeline began before anything we hold, unless the stored row says when.
    const opensTimeline = i === 0 || motion.slice(0, i).every((x) => x.v === null);
    const startObserved = parked && m.s <= parked.sinceMs ? parked.startObserved : !(opensTimeline && m.s <= observedFrom);
    spans.push({ s: m.s, e: m.e, startObserved });
  }
  return spans;
}

export function classifyIdleEngine(input: IdleEngineInput): { hours: IdleEngineHour[]; stops: IdleEngineStop[] } {
  const o = { ...IDLE_ENGINE_MOTION, ...input.motion };
  const parked = input.parked && input.parked.sinceMs < input.fromMs ? input.parked : null;
  const start = Math.min(input.spanStartMs, parked?.sinceMs ?? input.spanStartMs, input.fromMs);
  const end = Math.max(input.dataEndMs, input.toMs);
  const engine = engineSegments(input.engine, input.engineSeed, start, end);

  // Motion: the stored park stands for everything before the window; GPS decides from there on.
  const gps = input.gps;
  let raw = rawMotionSegments(gps, start, end, o);
  if (parked) {
    raw = mergeSegs([
      ...(parked.sinceMs > start ? [{ s: start, e: parked.sinceMs, v: null }] : []),
      { s: parked.sinceMs, e: input.fromMs, v: "stopped" as const },
      ...raw.flatMap((g) => (g.e <= input.fromMs ? [] : [{ ...g, s: Math.max(g.s, input.fromMs) }])),
    ]);
  }
  const motion = debouncedMotion(engine, raw, o.debounceSec);
  const firstFix = gps.reduce((m, g) => Math.min(m, g.t), Infinity);
  const spans = stopSpans(motion, gps, o.bridgeMeters, Math.max(start, firstFix), parked);
  const dataEnd = input.dataEndMs;

  const briefAt = (t: number) => {
    const sp = spans.find((x) => x.s <= t && t < x.e);
    return sp ? sp.e - sp.s < input.minIdleSec * 1000 : false;
  };
  const bucketOf = (eng: boolean | null, mot: Motion | null, t: number): Bucket => {
    if (t >= dataEnd || eng === null) return "no_data";
    if (eng === false) return "engine_off";
    if (mot === "moving") return "driving";
    if (mot === "stopped") return briefAt(t) ? "brief_stop" : "stopped_running";
    return "no_data";
  };

  const startsIn = (a: number, b: number) => {
    let n = 0;
    for (let i = 1; i < engine.length; i++) {
      const g = engine[i]!;
      if (g.s >= a && g.s < b && g.v === true && engine[i - 1]!.v === false) n++;
    }
    return n;
  };

  const KEYS: Bucket[] = ["driving", "stopped_running", "brief_stop", "engine_off", "no_data"];
  const hours: IdleEngineHour[] = [];
  for (let h = input.fromMs; h < input.toMs; h += HOUR) {
    const ms: Record<Bucket, number> = { driving: 0, stopped_running: 0, brief_stop: 0, engine_off: 0, no_data: 0 };
    for (const p of pieces(engine, motion)) {
      const s = Math.max(p.s, h);
      const e = Math.min(p.e, h + HOUR);
      if (e <= s) continue;
      // A piece crossing the data's end is split there: after it, nothing is known.
      if (s < dataEnd && e > dataEnd) {
        ms[bucketOf(p.a, p.b, s)] += dataEnd - s;
        ms.no_data += e - dataEnd;
      } else ms[bucketOf(p.a, p.b, s)] += e - s;
    }
    const [driving, stoppedRunning, brief, off, noData] = roundParts(KEYS.map((k) => ms[k]), 3600);
    hours.push({
      hourStartMs: h,
      drivingSec: driving!,
      stoppedRunningSec: stoppedRunning!,
      briefStopSec: brief!,
      engineOffSec: off!,
      noDataSec: noData!,
      fuelMl: counterDelta(input.fuelMl, engine, h, h + HOUR),
      engineSec: counterDelta(input.engineSec, engine, h, h + HOUR),
      engineStarts: startsIn(h, h + HOUR),
      ambientMilliC: meanIn(input.ambientMilliC, h, h + HOUR),
    });
  }

  const stops: IdleEngineStop[] = [];
  for (const sp of spans) {
    const open = sp.e >= dataEnd;
    const e = open ? dataEnd : sp.e;
    if (e - sp.s < input.minIdleSec * 1000) continue; // brief: hour rows only (Q-IE9)
    if (!open && e <= input.fromMs) continue; // closed before the window: not this run's to write
    if (sp.s >= input.toMs) continue; // begins after it: the next run's (0404 refuses it here)
    let run = 0;
    let off = 0;
    let longest = 0;
    let streak = 0;
    for (const p of pieces(engine, motion)) {
      const a = Math.max(p.s, sp.s);
      const b = Math.min(p.e, e);
      if (b <= a) continue;
      if (p.a === true && p.b === "stopped") {
        run += b - a;
        streak += b - a;
        longest = Math.max(longest, streak);
      } else {
        streak = 0;
        if (p.a === false) off += b - a;
      }
    }
    const durationSec = Math.round((e - sp.s) / 1000);
    const [runningSec, offSec, noDataSec] = roundParts([run, off, e - sp.s - run - off], durationSec);
    const fix = gps.find((g) => g.t >= sp.s && g.t < e && g.lat != null && g.lng != null) ?? null;
    // A stop still open has no reading after its end yet: read the fuel up to the last one inside it.
    const lastFuel = input.fuelMl.filter((r) => r.t >= sp.s && r.t <= e).reduce((m, r) => Math.max(m, r.t), -Infinity);
    stops.push({
      startedAtMs: sp.s,
      endedAtMs: open ? null : sp.e,
      startObserved: sp.startObserved,
      durationSec,
      runningSec: runningSec!,
      offSec: offSec!,
      noDataSec: noDataSec!,
      engineStarts: startsIn(sp.s + 1, e),
      longestRunSec: Math.min(Math.round(longest / 1000), runningSec!),
      fuelMl: counterDelta(input.fuelMl, engine, sp.s, open && Number.isFinite(lastFuel) ? Math.max(lastFuel, sp.s) : e),
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      place: fix?.place ?? null,
      state: stateOfPlace(fix?.place),
      ambientMilliC: meanIn(input.ambientMilliC, sp.s, e),
    });
  }
  return { hours, stops };
}
