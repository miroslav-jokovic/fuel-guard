/**
 * Where a vehicle was, read from its GPS fixes (TOLLS-PER-TRUCK-PLAN D-TL14, D-TL21). Pure.
 *
 * ── WHY INTERPOLATE, AND WHY NOT ACROSS A LONG SILENCE ─────────────────────────────────────────
 * A moving truck reports about every ten seconds (measured 2026-11-19: ~6 fixes a minute in the day),
 * so at 65 mph two fixes are ~300 m apart and a gantry usually falls between them. The closest the
 * truck came is therefore read off the segment between two fixes, not only off the fixes. Across a gap
 * longer than `MAX_GAP_MS` the truck could have gone anywhere, so a segment that long is not drawn: the
 * reading stays on the fixes either side of it, and says nothing about the time in between.
 */

export interface Fix {
  ms: number;
  lat: number;
  lon: number;
}

export interface Point {
  lat: number;
  lon: number;
}

/** A segment longer than this in time is not interpolated (see header). */
export const MAX_GAP_MS = 3 * 60_000;

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Component-wise median: robust to the one fix a gateway puts in the wrong county. */
export function medianPoint(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  return { lat: median(points.map((p) => p.lat)), lon: median(points.map((p) => p.lon)) };
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const lerp = (a: Fix, b: Fix, t: number): Fix => ({
  ms: a.ms + (b.ms - a.ms) * t,
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
});

/**
 * Where the vehicle was at `ms`: between the two fixes either side when they are no more than
 * `MAX_GAP_MS` apart, else the nearest fix if it is within half that. Null when no fix speaks for it.
 * `fixes` must be sorted by time.
 */
export function positionAt(fixes: readonly Fix[], ms: number): Fix | null {
  let after = fixes.findIndex((f) => f.ms >= ms);
  if (after === -1) after = fixes.length;
  const prev = fixes[after - 1];
  const next = fixes[after];
  if (next && next.ms === ms) return next;
  if (prev && next && next.ms - prev.ms <= MAX_GAP_MS) return lerp(prev, next, (ms - prev.ms) / (next.ms - prev.ms));
  const near = [prev, next].filter((f): f is Fix => !!f && Math.abs(f.ms - ms) <= MAX_GAP_MS / 2);
  near.sort((a, b) => Math.abs(a.ms - ms) - Math.abs(b.ms - ms));
  return near[0] ?? null;
}

export interface Approach extends Fix {
  distanceM: number;
}

/**
 * The closest the vehicle came to `to` between `fromMs` and `untilMs`, over its fixes and the segments
 * between fixes no more than `MAX_GAP_MS` apart (clipped to the window). Null when it has no fix in the
 * window and no segment crossing it. `fixes` must be sorted by time.
 */
export function closestApproach(fixes: readonly Fix[], to: Point, fromMs: number, untilMs: number): Approach | null {
  let best: Approach | null = null;
  const consider = (f: Fix) => {
    const d = distanceM(f, to);
    if (!best || d < best.distanceM) best = { ...f, distanceM: d };
  };
  for (let i = 0; i < fixes.length; i++) {
    const a = fixes[i]!;
    if (a.ms >= fromMs && a.ms <= untilMs) consider(a);
    const b = fixes[i + 1];
    if (!b || b.ms - a.ms > MAX_GAP_MS || b.ms < fromMs || a.ms > untilMs) continue;
    // The segment, clipped to the window, then the point on it nearest `to` in a local flat frame
    // (exact enough over a few hundred metres).
    const t0 = Math.max(0, (fromMs - a.ms) / (b.ms - a.ms || 1));
    const t1 = Math.min(1, (untilMs - a.ms) / (b.ms - a.ms || 1));
    const p = lerp(a, b, t0);
    const q = lerp(a, b, t1);
    const k = Math.cos(rad(to.lat));
    const dx = (q.lon - p.lon) * k;
    const dy = q.lat - p.lat;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (((to.lon - p.lon) * k) * dx + (to.lat - p.lat) * dy) / len2));
    consider(lerp(p, q, t));
  }
  return best;
}
