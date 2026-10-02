/**
 * Reading the engine's cumulative counters at any instant (IE2a, D-IE6). Pure.
 *
 * `fuelConsumedMilliliters` (total fuel, 500 mL steps, read every ~6–12 min while running) and
 * `obdEngineSeconds` (engine hours, 180 s steps, ~3 min) only move while the engine runs. So between
 * two readings the counter is interpolated along the engine's RUNNING time, not the clock: a reading
 * at 22:00, the engine off 22:10–06:00, and a reading at 06:05 put all of the burn into the twenty
 * running minutes, where a clock interpolation would spread it across the night and book fuel to
 * hours the engine was off. The same rule answers the edges for free: with the engine off from the
 * last reading to the instant, the value is that reading.
 *
 * Null when the instant is not bracketed by readings and the engine cannot be shown off across the
 * gap — never a guess, and never 0, which would read as "burned nothing".
 */

import type { Seg } from "./timeline.js";

export interface CounterReading {
  t: number;
  value: number;
}

/** Milliseconds the engine was KNOWN to run over [a, b). */
export function runningMs(engine: Seg<boolean | null>[], a: number, b: number): number {
  let ms = 0;
  for (const g of engine) {
    if (g.e <= a) continue;
    if (g.s >= b) break;
    if (g.v === true) ms += Math.min(g.e, b) - Math.max(g.s, a);
  }
  return ms;
}

/** True when the engine is known OFF for the whole of [a, b) (an empty span is trivially off). */
function knownOff(engine: Seg<boolean | null>[], a: number, b: number): boolean {
  if (b <= a) return true;
  let covered = 0;
  for (const g of engine) {
    if (g.e <= a) continue;
    if (g.s >= b) break;
    if (g.v !== false) return false;
    covered += Math.min(g.e, b) - Math.max(g.s, a);
  }
  return covered >= b - a;
}

export function counterAt(
  readings: CounterReading[],
  engine: Seg<boolean | null>[],
  t: number,
): number | null {
  let before: CounterReading | undefined;
  let after: CounterReading | undefined;
  for (const r of readings) {
    if (!Number.isFinite(r.t) || !Number.isFinite(r.value)) continue;
    if (r.t <= t && (!before || r.t >= before.t)) before = r;
    if (r.t >= t && (!after || r.t <= after.t)) after = r;
  }
  if (before && after) {
    if (after.t === before.t) return before.value;
    const run = runningMs(engine, before.t, after.t);
    if (run <= 0) {
      // No running time between them: the counter cannot have moved, unless the engine state is
      // unknown somewhere in between — then the share of the burn is unknowable.
      return knownOff(engine, before.t, after.t) || after.value === before.value ? before.value : null;
    }
    return before.value + ((after.value - before.value) * runningMs(engine, before.t, t)) / run;
  }
  if (before && knownOff(engine, before.t, t)) return before.value;
  if (after && knownOff(engine, t, after.t)) return after.value;
  return null;
}

/** The counter's increase over [a, b), rounded; null when either edge is unknown or it went backwards
 *  (a reset or a swapped gateway is not negative fuel). A span the engine was known OFF throughout is
 *  0 with or without readings: measured 2026-10-02, a truck shut down at 01:46 whose last reading was
 *  36 s before it left every later hour of the night null, because no reading brackets them until it
 *  restarts — but a counter cannot move with the engine off. */
export function counterDelta(
  readings: CounterReading[],
  engine: Seg<boolean | null>[],
  a: number,
  b: number,
): number | null {
  if (knownOff(engine, a, b)) return 0;
  const x = counterAt(readings, engine, a);
  const y = counterAt(readings, engine, b);
  if (x == null || y == null || y < x) return null;
  return Math.round(y - x);
}

/** Mean of the readings inside [a, b), rounded; null when there are none. */
export function meanIn(readings: CounterReading[], a: number, b: number): number | null {
  let n = 0;
  let sum = 0;
  for (const r of readings) {
    if (r.t >= a && r.t < b && Number.isFinite(r.value)) {
      n++;
      sum += r.value;
    }
  }
  return n ? Math.round(sum / n) : null;
}
