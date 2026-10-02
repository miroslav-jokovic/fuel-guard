/**
 * The idle engine's two input timelines — engine on/off and motion — as piecewise-constant segments
 * (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md D-IE1). Pure: no clocks, no IO.
 *
 * ENGINE is the ECU's (Samsara `engineStates`), trusted: `Off` is off; `On` and `Idle` are both running,
 * because Samsara's On/Idle split is ITS motion decision, which R3 retires. A flip holds until the next
 * one. What held before the first flip is `seed` — the collector's carry-in, null when nobody knows —
 * because `stats/history` does not return the state holding at a window's start (measured 2026-10-02:
 * 662's 18:00Z window opened on a flip at 18:51).
 *
 * MOTION is OURS (D-IE1): GPS speed against `movingMph`, never Samsara's Idle label, and never the GPS
 * decoration on an engine flip, which is stale at the instant of the flip (`idleSessions.ts`'s
 * `isDriving` warning). A fix describes the truck until the next fix, but for at most `gpsGapSec`;
 * past that the motion is unknown. An engine that is OFF is a truck that is not driving, so engine-off
 * time is stopped whatever the GPS says or does not say — a parked gateway that goes quiet does not
 * break a park. A change of motion counts only once it has held `debounceSec`, and is then dated from
 * where it began; a shorter excursion (a lot shuffle, a light) is absorbed. Unknown is never debounced:
 * it applies at once, and the first known motion after it is adopted at once.
 */

export interface Seg<T> {
  s: number;
  e: number;
  v: T;
}

export type Motion = "moving" | "stopped";

export interface EngineFlip {
  t: number;
  on: boolean;
}

export interface MotionFix {
  t: number;
  mph: number;
  lat?: number;
  lng?: number;
  /** Samsara's reverse-geocoded line, e.g. "Joliet, Will County, IL". */
  place?: string | null;
}

export const IDLE_ENGINE_MOTION = {
  /** At or above this GPS speed the truck is moving (D-IE1). */
  movingMph: 3,
  /** A change of motion must hold this long to count (D-IE1). */
  debounceSec: 60,
  /** A GPS fix describes the truck for at most this long. Parked gateways report about every 30 s
   *  (662, 2026-10-01: 2,772 fixes in 24 h), so ten minutes of silence is not a sampling gap. */
  gpsGapSec: 600,
  /** Two stopped stretches either side of a motion gap are ONE park if the truck is within this
   *  distance of where it was — it did not go anywhere. */
  bridgeMeters: 400,
} as const;

/** Merge adjacent segments carrying the same value; drop empty ones. */
export function mergeSegs<T>(segs: Seg<T>[]): Seg<T>[] {
  const out: Seg<T>[] = [];
  for (const g of segs) {
    if (g.e <= g.s) continue;
    const last = out[out.length - 1];
    if (last && last.v === g.v && last.e === g.s) last.e = g.e;
    else out.push({ ...g });
  }
  return out;
}

/** Engine running over [startMs, endMs): `seed` before the first flip, each flip until the next. */
export function engineSegments(
  flips: EngineFlip[],
  seed: boolean | null,
  startMs: number,
  endMs: number,
): Seg<boolean | null>[] {
  const f = flips.filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const segs: Seg<boolean | null>[] = [];
  let cur: boolean | null = seed;
  let at = startMs;
  for (const x of f) {
    if (x.t <= at) {
      cur = x.on; // a flip at or before the span start sets the state the span opens in
      continue;
    }
    if (x.t >= endMs) break;
    segs.push({ s: at, e: x.t, v: cur });
    cur = x.on;
    at = x.t;
  }
  segs.push({ s: at, e: endMs, v: cur });
  return mergeSegs(segs);
}

/** Raw GPS motion over [startMs, endMs), before the engine and the debounce are applied. */
export function rawMotionSegments(
  fixes: MotionFix[],
  startMs: number,
  endMs: number,
  o: { movingMph: number; gpsGapSec: number } = IDLE_ENGINE_MOTION,
): Seg<Motion | null>[] {
  const f = fixes
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.mph) && x.t < endMs)
    .sort((a, b) => a.t - b.t);
  const segs: Seg<Motion | null>[] = [];
  let at = startMs;
  for (let i = 0; i < f.length; i++) {
    const x = f[i]!;
    const next = f[i + 1]?.t ?? endMs;
    const s = Math.max(x.t, startMs);
    const e = Math.min(next, x.t + o.gpsGapSec * 1000, endMs);
    if (e <= s) continue;
    if (s > at) segs.push({ s: at, e: s, v: null });
    segs.push({ s, e, v: x.mph >= o.movingMph ? "moving" : "stopped" });
    at = e;
  }
  if (at < endMs) segs.push({ s: at, e: endMs, v: null });
  return mergeSegs(segs);
}

/** Visit every maximal piece over which each of the given segment lists holds one value. All lists
 *  must cover the same [s, e). */
export function* pieces<A, B>(a: Seg<A>[], b: Seg<B>[]): Generator<{ s: number; e: number; a: A; b: B }> {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    const s = Math.max(x.s, y.s);
    const e = Math.min(x.e, y.e);
    if (e > s) yield { s, e, a: x.v, b: y.v };
    if (x.e <= y.e) i++;
    else j++;
  }
}

/** Motion once the engine is applied (off ⇒ stopped) and the debounce has run. */
export function debouncedMotion(
  engine: Seg<boolean | null>[],
  raw: Seg<Motion | null>[],
  debounceSec: number = IDLE_ENGINE_MOTION.debounceSec,
): Seg<Motion | null>[] {
  const eff: Seg<Motion | null>[] = [];
  for (const p of pieces(engine, raw)) eff.push({ s: p.s, e: p.e, v: p.a === false ? "stopped" : p.b });
  const runs = mergeSegs(eff);
  const out: Seg<Motion | null>[] = [];
  let cur: Motion | null | undefined;
  for (const r of runs) {
    let v: Motion | null;
    if (cur === undefined || r.v === null || cur === null || r.v === cur) v = r.v;
    else v = r.e - r.s >= debounceSec * 1000 ? r.v : cur; // a short excursion is absorbed
    out.push({ s: r.s, e: r.e, v });
    cur = v;
  }
  return mergeSegs(out);
}

const R = 6_371_000;
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
