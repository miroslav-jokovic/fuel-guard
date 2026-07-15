/**
 * Route geometry helpers (pure). Perpendicular distance from a point to a route polyline and how far ALONG the
 * route the nearest point sits — the basis for corridor matching (§Phase 2) and deviation detection (§Phase 6).
 * Reuses `haversineMiles` (ai.ts) for along-route distance; cross-track uses a local equirectangular frame,
 * accurate at corridor scale (a few miles).
 */
import { haversineMiles } from "../ai.js";
import type { LatLng } from "./flexPolyline.js";

const R_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Perpendicular miles from p to segment a→b, and the clamped projection param t (0=a, 1=b). */
export function pointToSegmentMiles(p: LatLng, a: LatLng, b: LatLng): { miles: number; t: number } {
  const cosLat = Math.cos(rad(a.lat));
  const proj = (q: LatLng) => ({ x: rad(q.lng - a.lng) * R_MI * cosLat, y: rad(q.lat - a.lat) * R_MI });
  const P = proj(p);
  const B = proj(b);
  const len2 = B.x * B.x + B.y * B.y;
  let t = len2 > 0 ? (P.x * B.x + P.y * B.y) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = t * B.x;
  const cy = t * B.y;
  return { miles: Math.hypot(P.x - cx, P.y - cy), t };
}

export interface NearestOnRoute {
  /** Perpendicular miles from the point to the route. */
  crossTrackMiles: number;
  /** Miles ALONG the route from its start to the nearest point (progress). */
  alongTrackMiles: number;
  segIndex: number;
}

/** Nearest point on a polyline to p: cross-track distance + how far along the route it is. */
export function nearestOnRoute(p: LatLng, poly: LatLng[]): NearestOnRoute {
  if (poly.length === 0) return { crossTrackMiles: Infinity, alongTrackMiles: 0, segIndex: 0 };
  if (poly.length === 1) return { crossTrackMiles: haversineMiles(p.lat, p.lng, poly[0]!.lat, poly[0]!.lng), alongTrackMiles: 0, segIndex: 0 };
  let best: NearestOnRoute = { crossTrackMiles: Infinity, alongTrackMiles: 0, segIndex: 0 };
  let cum = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const segLen = haversineMiles(a.lat, a.lng, b.lat, b.lng);
    const { miles, t } = pointToSegmentMiles(p, a, b);
    if (miles < best.crossTrackMiles) best = { crossTrackMiles: miles, alongTrackMiles: cum + t * segLen, segIndex: i };
    cum += segLen;
  }
  return best;
}

/** Total route length in miles. */
export function routeLengthMiles(poly: LatLng[]): number {
  let m = 0;
  for (let i = 0; i < poly.length - 1; i++) m += haversineMiles(poly[i]!.lat, poly[i]!.lng, poly[i + 1]!.lat, poly[i + 1]!.lng);
  return m;
}
