import { haversineMiles } from "../ai.js";

/**
 * Learn a fuel station's TRUE coordinate from the truck GPS positions observed at fills there. A station is
 * visited by many trucks that all stop at the same pumps, so the observed stop positions cluster tightly at
 * the real site — a far better "site" coordinate than a city-centroid geocode, and drawn purely from our own
 * telematics (no external geocoder). Returns the cluster centroid when a strong majority of visits agree, else
 * null (don't upgrade a station we can't pin). Pure.
 */
export interface LearnedStationCoord {
  lat: number;
  lng: number;
  /** How many fills' stop positions backed the estimate. */
  samples: number;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function learnStationCoord(
  positions: { lat: number; lng: number }[],
  opts: { minFills?: number; maxSpreadMiles?: number; minShare?: number } = {},
): LearnedStationCoord | null {
  const minFills = opts.minFills ?? 4;
  const maxSpread = opts.maxSpreadMiles ?? 0.3; // within the station lot
  const minShare = opts.minShare ?? 0.7;

  const pts = positions.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < minFills) return null;

  // Median position is a robust center; keep the points that cluster around it, require a strong majority.
  const medLat = median(pts.map((p) => p.lat));
  const medLng = median(pts.map((p) => p.lng));
  const cluster = pts.filter((p) => haversineMiles(p.lat, p.lng, medLat, medLng) <= maxSpread);
  if (cluster.length / pts.length < minShare || cluster.length < minFills) return null;

  // Centroid of the clustered visits — a stable pump-lot coordinate.
  const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
  const lng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, samples: cluster.length };
}
