/**
 * Corridor match (pure, §Phase 2): from a decoded route + candidate stations + the truck's current position,
 * pick the stations within the corridor buffer AND still AHEAD of the truck along the route. Detour is the
 * round-trip off the route (~2× cross-track) — folded into feasibility downstream, never just displayed (audit H1).
 * Access-side of a divided highway is NOT resolved here (needs road direction) — flagged as a Phase-2 limitation.
 */
import { nearestOnRoute } from "./geo.js";
import type { LatLng } from "./flexPolyline.js";

export interface CorridorStation {
  station: LatLng & { id: string };
  crossTrackMiles: number;
  /** Miles along the route from start to this station's nearest point. */
  alongTrackMiles: number;
  /** Approx round-trip detour off the route to reach the pump. */
  detourMiles: number;
}

export interface CorridorOptions {
  corridorMiles: number;
  /** Small tolerance so a station right at the truck isn't dropped by GPS jitter. Default 0.5 mi. */
  behindToleranceMiles?: number;
}

/**
 * Stations within `corridorMiles` of the route and ahead of the truck, ordered by along-route position.
 * `truck` may be null (pre-departure) → measure ahead from the route start (progress 0).
 */
export function stationsAlongRoute<S extends LatLng & { id: string }>(
  poly: LatLng[],
  stations: S[],
  truck: LatLng | null,
  opts: CorridorOptions,
): CorridorStation[] {
  if (poly.length < 2) return [];
  const truckProgress = truck ? nearestOnRoute(truck, poly).alongTrackMiles : 0;
  const behindTol = opts.behindToleranceMiles ?? 0.5;
  const out: CorridorStation[] = [];
  for (const s of stations) {
    const n = nearestOnRoute(s, poly);
    if (n.crossTrackMiles > opts.corridorMiles) continue; // not in the corridor
    if (n.alongTrackMiles < truckProgress - behindTol) continue; // already passed it
    out.push({ station: s, crossTrackMiles: n.crossTrackMiles, alongTrackMiles: n.alongTrackMiles, detourMiles: 2 * n.crossTrackMiles });
  }
  return out.sort((a, b) => a.alongTrackMiles - b.alongTrackMiles);
}
