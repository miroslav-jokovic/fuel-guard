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

/** Which side of the direction of travel a point lies on (relative to the heading a→b). */
export type TravelSide = "left" | "right" | "on";

/** Perpendicular miles from p to segment a→b, the clamped projection param t (0=a, 1=b), and which side of
 *  travel p sits on (left/right of the a→b heading; "on" when essentially on the line). */
export function pointToSegmentMiles(p: LatLng, a: LatLng, b: LatLng): { miles: number; t: number; side: TravelSide } {
  const cosLat = Math.cos(rad(a.lat));
  const proj = (q: LatLng) => ({ x: rad(q.lng - a.lng) * R_MI * cosLat, y: rad(q.lat - a.lat) * R_MI });
  const P = proj(p);
  const B = proj(b);
  const len2 = B.x * B.x + B.y * B.y;
  let t = len2 > 0 ? (P.x * B.x + P.y * B.y) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = t * B.x;
  const cy = t * B.y;
  // Signed cross product of the heading (B) and the offset (P): >0 = left of travel, <0 = right (US pull-offs
  // are on the right, so a left-side station on a divided highway implies a real interchange back-track).
  const cross = B.x * P.y - B.y * P.x;
  const SIDE_EPS = 1e-9;
  const side: TravelSide = cross > SIDE_EPS ? "left" : cross < -SIDE_EPS ? "right" : "on";
  return { miles: Math.hypot(P.x - cx, P.y - cy), t, side };
}

export interface NearestOnRoute {
  /** Perpendicular miles from the point to the route. */
  crossTrackMiles: number;
  /** Miles ALONG the route from its start to the nearest point (progress). */
  alongTrackMiles: number;
  segIndex: number;
  /** Where on segment `segIndex` the nearest point lies: 0 = its start, 1 = its end. */
  t: number;
  /** Which side of travel the point sits on at the nearest segment (left/right of the heading). */
  side: TravelSide;
}

/** Nearest point on a polyline to p: cross-track distance + how far along the route it is. */
export function nearestOnRoute(p: LatLng, poly: LatLng[]): NearestOnRoute {
  if (poly.length === 0) return { crossTrackMiles: Infinity, alongTrackMiles: 0, segIndex: 0, t: 0, side: "on" };
  if (poly.length === 1) return { crossTrackMiles: haversineMiles(p.lat, p.lng, poly[0]!.lat, poly[0]!.lng), alongTrackMiles: 0, segIndex: 0, t: 0, side: "on" };
  let best: NearestOnRoute = { crossTrackMiles: Infinity, alongTrackMiles: 0, segIndex: 0, t: 0, side: "on" };
  let cum = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const segLen = haversineMiles(a.lat, a.lng, b.lat, b.lng);
    const { miles, t, side } = pointToSegmentMiles(p, a, b);
    if (miles < best.crossTrackMiles) best = { crossTrackMiles: miles, alongTrackMiles: cum + t * segLen, segIndex: i, t, side };
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

/**
 * How far from its route a truck may be and still be "on" it (TRUCK-CARD-ROUTE-PLAN Q-TC3, ruled
 * 2026-10-09). Past this, a split would be guessed from a far point, so the route is not split at all.
 * A constant, not a setting; revisited after a week of real trucks.
 */
export const OFF_ROUTE_MILES = 1;

export interface RouteSplit {
  /** The part already driven, start → the truck's point on the line. Empty when the truck is off the route. */
  covered: LatLng[];
  /** The part still ahead, the truck's point → the end. The whole line when the truck is off the route. */
  ahead: LatLng[];
  coveredMiles: number;
  /** Miles from the truck to the line. */
  offRouteMiles: number;
  onRoute: boolean;
}

/**
 * Split a route where a truck stands on it, the way a navigation app greys the road behind you
 * (D-TC3). The split point is the truck's NEAREST point on the line — a segment projection, not the
 * nearest vertex, so a U-shaped route does not put the truck on the arm it is not driving — and both
 * halves share it, so the two lines meet without a gap.
 */
export function splitRouteAt(poly: LatLng[], truck: LatLng, offRouteMiles = OFF_ROUTE_MILES): RouteSplit {
  const near = nearestOnRoute(truck, poly);
  if (poly.length < 2 || !(near.crossTrackMiles <= offRouteMiles)) {
    return { covered: [], ahead: poly, coveredMiles: 0, offRouteMiles: near.crossTrackMiles, onRoute: false };
  }
  const a = poly[near.segIndex]!;
  const b = poly[near.segIndex + 1]!;
  const at = { lat: a.lat + near.t * (b.lat - a.lat), lng: a.lng + near.t * (b.lng - a.lng) };
  return {
    covered: [...poly.slice(0, near.segIndex + 1), at],
    ahead: [at, ...poly.slice(near.segIndex + 1)],
    coveredMiles: near.alongTrackMiles,
    offRouteMiles: near.crossTrackMiles,
    onRoute: true,
  };
}
