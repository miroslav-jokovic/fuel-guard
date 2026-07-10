import { haversineMiles } from "../ai.js";

/**
 * Reefer trailer ↔ tractor pairing by GPS CO-LOCATION. When drivers don't select the trailer in the Samsara
 * app, Samsara produces no assignment — but a reefer with an Asset Gateway still reports its own GPS. This
 * module replicates Samsara's own auto-pairing logic: over a window, the trailer is paired to the truck it is
 * consistently co-located with (same place, same time, moving together). Pure + deterministic.
 */

export interface GpsSample {
  /** epoch ms */
  t: number;
  lat: number;
  lng: number;
  /** mph, when available — used to prefer "moving together" (hauling) over parked-in-the-same-yard. */
  speedMph?: number;
}
export interface TruckTrack {
  vehicleId: string;
  gps: GpsSample[];
}
export interface TrailerPairing {
  vehicleId: string;
  /** Share of the trailer's GPS samples co-located with the winning truck (0–1). */
  confidence: number;
  coSamples: number;
  totalSamples: number;
}

/** Parse a Samsara stats/history response (vehicles OR trailers — same gps point shape) into GPS tracks
 *  keyed by the asset's Samsara id. Defensive about the exact numeric/string shapes. */
export function parseAssetGps(response: { data?: { id?: string | number; gps?: unknown[] }[] }): Map<string, GpsSample[]> {
  const out = new Map<string, GpsSample[]>();
  for (const a of response.data ?? []) {
    if (a.id == null) continue;
    const pts: GpsSample[] = [];
    for (const raw of a.gps ?? []) {
      const p = raw as { time?: string; latitude?: number; longitude?: number; speedMilesPerHour?: number };
      if (!p.time || p.latitude == null || p.longitude == null) continue;
      const t = Date.parse(p.time);
      if (Number.isFinite(t)) pts.push({ t, lat: Number(p.latitude), lng: Number(p.longitude), speedMph: p.speedMilesPerHour ?? undefined });
    }
    out.set(String(a.id), pts);
  }
  return out;
}

const clean = (g: GpsSample[]): GpsSample[] =>
  g.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.lat) && Number.isFinite(s.lng)).sort((a, b) => a.t - b.t);

/** Nearest sample in a TIME-SORTED track to instant `t`, within `tolMs`. Binary search. */
function nearestAt(sorted: GpsSample[], t: number, tolMs: number): GpsSample | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  let best: GpsSample | null = null;
  let bestDelta = Infinity;
  for (const c of [sorted[lo], sorted[lo - 1]]) {
    if (c) {
      const d = Math.abs(c.t - t);
      if (d < bestDelta) {
        bestDelta = d;
        best = c;
      }
    }
  }
  return best && bestDelta <= tolMs ? best : null;
}

/**
 * Infer the truck a reefer trailer is paired to. For each trailer GPS sample, find the CLOSEST truck at that
 * instant (within `maxMatchMiles` and `timeTolMin`); the truck co-located on the most samples wins, provided
 * it clears an absolute floor (`minCoSamples`) AND a dominant share (`minShare`) — so a trailer parked in a
 * shared yard, or split evenly between two tractors, yields NO confident pairing rather than a wrong one.
 */
export function inferTrailerPairing(
  trailerGps: GpsSample[],
  trucks: TruckTrack[],
  opts: { maxMatchMiles?: number; timeTolMin?: number; minCoSamples?: number; minShare?: number; movingMph?: number } = {},
): TrailerPairing | null {
  const maxMiles = opts.maxMatchMiles ?? 0.25; // ~400 m — Samsara's "moving together" radius
  const tolMs = (opts.timeTolMin ?? 10) * 60_000;
  const minCo = opts.minCoSamples ?? 8;
  const minShare = opts.minShare ?? 0.6;
  const movingMph = opts.movingMph ?? 5;

  const all = clean(trailerGps);
  if (all.length === 0) return null;
  const tracks = trucks.map((tr) => ({ vehicleId: tr.vehicleId, gps: clean(tr.gps) })).filter((tr) => tr.gps.length > 0);
  if (tracks.length === 0) return null;

  // Prefer MOVING trailer samples (driving together = hauling, not parked in a shared yard). Fall back to all
  // samples only when speed is absent or the trailer never moved in the window (e.g., synthetic data).
  const moving = all.filter((s) => s.speedMph != null && s.speedMph > movingMph);
  const samples = moving.length >= minCo ? moving : all;

  const hits = new Map<string, number>();
  let totalHits = 0; // trailer samples where SOME truck was co-located (excludes parked-alone time)
  for (const s of samples) {
    let bestVeh: string | null = null;
    let bestD = maxMiles;
    for (const tr of tracks) {
      const p = nearestAt(tr.gps, s.t, tolMs);
      if (!p) continue;
      const d = haversineMiles(s.lat, s.lng, p.lat, p.lng);
      if (d <= bestD) {
        bestD = d;
        bestVeh = tr.vehicleId;
      }
    }
    if (bestVeh) {
      hits.set(bestVeh, (hits.get(bestVeh) ?? 0) + 1);
      totalHits += 1;
    }
  }
  if (totalHits === 0) return null;

  let winner: string | null = null;
  let winCo = 0;
  for (const [v, c] of hits) {
    if (c > winCo) {
      winCo = c;
      winner = v;
    }
  }
  // Dominance among CO-LOCATED samples (not all trailer samples), so parked-alone / sparse reporting doesn't
  // dilute a real hauler, but a reefer split between two tractors still fails the share test.
  const share = winCo / totalHits;
  if (winner == null || winCo < minCo || share < minShare) return null;
  return { vehicleId: winner, confidence: Math.round(share * 100) / 100, coSamples: winCo, totalSamples: samples.length };
}
