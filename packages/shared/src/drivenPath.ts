/**
 * The road a truck actually drove on its load, pure (DISPATCH-BOARD-V2-PLAN §5.3, DBV6).
 *
 * The owner, 2026-10-16: "the route does not take into consideration the route the truck has taken".
 * DBV5 routed the road AHEAD from the truck; this is the road BEHIND it — Samsara's GPS history since
 * the truck left the pickup, drawn as its own line where the map used to draw the plan up to the
 * truck's projected point ("covered"), which was where we said it would go, not where it went.
 *
 * ── THE WINDOW: FROM PICKUP DEPARTURE, AT MOST 72 HOURS ───────────────────────────────────────────
 * McLeod records the pickup's departure on 107 of 108 loads in transit (2026-10-16). Those trips were
 * 25 h old at the median and 70 h at p90, and one was 18 days. Samsara answers a point every ~6 s
 * (measured: 6,088 points for 21 h, 1.7 s), so the window is capped at `DRIVEN_PATH_MAX_HOURS` — the
 * p90 trip whole, a stale load's last three days — and the answer says when it was cut (`capped`).
 *
 * ── THINNED BEFORE IT LEAVES THE SERVER ───────────────────────────────────────────────────────────
 * Thousands of points on a near-straight interstate draw the same line as a few hundred. `thinPath`
 * is Douglas–Peucker at `DRIVEN_PATH_TOLERANCE_MILES` (≈30 m, under a lane-change at the map's widest
 * zoom), on `pointToSegmentMiles`, the route geometry's own measure. Measured on a real 21 h trail
 * (2026-10-16): 6,114 points became 629, 524.2 mi became 523.4, in 13 ms and 22 KB; at 0.05 mi it
 * was 383 points but corners started to cut. Iterative, not recursive, so window length is never a
 * stack depth. Its cost is quadratic only on a line that is ALL corners, which a road is not.
 */
import { pointToSegmentMiles } from "./smartFueling/geo.js";
import type { LatLng } from "./smartFueling/flexPolyline.js";

export const DRIVEN_PATH_MAX_HOURS = 72;
export const DRIVEN_PATH_TOLERANCE_MILES = 0.02;

/** Where the driven line starts: the pickup's departure, or the cap when that is further back. */
export function drivenPathWindow(departedAt: string | null, now: Date): { startIso: string; capped: boolean } | null {
  const left = departedAt ? Date.parse(departedAt) : NaN;
  if (!Number.isFinite(left) || left >= now.getTime()) return null;
  const earliest = now.getTime() - DRIVEN_PATH_MAX_HOURS * 3_600_000;
  return left < earliest ? { startIso: new Date(earliest).toISOString(), capped: true } : { startIso: new Date(left).toISOString(), capped: false };
}

/** Douglas–Peucker: the fewest points within `toleranceMiles` of the line through all of them. Ends kept. */
export function thinPath(points: readonly LatLng[], toleranceMiles = DRIVEN_PATH_TOLERANCE_MILES): LatLng[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstMiles = toleranceMiles;
    for (let i = a + 1; i < b; i++) {
      const miles = pointToSegmentMiles(points[i]!, points[a]!, points[b]!).miles;
      if (miles > worstMiles) {
        worst = i;
        worstMiles = miles;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return points.filter((_, i) => keep[i] === 1);
}
