/**
 * Corridor match (pure, §Phase 2): from a decoded route + candidate stations + the truck's current position,
 * pick the stations within the corridor buffer AND still AHEAD of the truck along the route. Detour is the
 * round-trip off the route (~2× cross-track) — folded into feasibility downstream, never just displayed (audit H1).
 * Access-side of a divided highway is NOT resolved here (needs road direction) — flagged as a Phase-2 limitation.
 */
import { nearestOnRoute, type TravelSide } from "./geo.js";
import type { LatLng } from "./flexPolyline.js";

export interface CorridorStation {
  station: LatLng & { id: string };
  crossTrackMiles: number;
  /** Miles along the route from start to this station's nearest point. */
  alongTrackMiles: number;
  /** Approx round-trip detour off the route to reach the pump (incl. any opposite-side access back-track). */
  detourMiles: number;
  /** Which side of travel the station sits on (left/right of the heading). */
  side: TravelSide;
  /** True when the station is on the OPPOSITE side of travel from the natural pull-off (US = right). */
  oppositeSide: boolean;
}

export interface CorridorOptions {
  corridorMiles: number;
  /** Small tolerance so a station right at the truck isn't dropped by GPS jitter. Default 0.5 mi. */
  behindToleranceMiles?: number;
  /** Extra detour miles charged to a station on the OPPOSITE side of travel (a divided-highway interchange
   *  back-track). 0 disables the heuristic. Interstate truck stops sit at interchanges, so opposite-side really
   *  does mean crossing over — but this is an average, not a per-road fact (road-class data would refine it). */
  oppositeSideAccessMiles?: number;
  /** The natural pull-off side for the region; US drives on the right. Default "right". */
  driveSide?: TravelSide;
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
  const accessMi = opts.oppositeSideAccessMiles ?? 0;
  const driveSide = opts.driveSide ?? "right";
  const out: CorridorStation[] = [];
  for (const s of stations) {
    const n = nearestOnRoute(s, poly);
    if (n.crossTrackMiles > opts.corridorMiles) continue; // not in the corridor
    if (n.alongTrackMiles < truckProgress - behindTol) continue; // already passed it
    const oppositeSide = n.side !== "on" && n.side !== driveSide;
    const detourMiles = 2 * n.crossTrackMiles + (oppositeSide ? accessMi : 0);
    out.push({ station: s, crossTrackMiles: n.crossTrackMiles, alongTrackMiles: n.alongTrackMiles, detourMiles, side: n.side, oppositeSide });
  }
  return out.sort((a, b) => a.alongTrackMiles - b.alongTrackMiles);
}
