/**
 * What Samsara saw at a placed plaza when a toll was printed (TOLLS-PER-TRUCK-PLAN D-TL14, D-TL21). Pure.
 *
 * ── AN OBSERVATION, NEVER A VERDICT ────────────────────────────────────────────────────────────
 * Which truck a toll belongs to is derived at read time from the tag and plate histories (D-TL3), and
 * those change when the office fixes them. So what is stored is what GPS saw, for EVERY company vehicle:
 * the ones within `OBSERVE_RADIUS_M` with how close they came and when, and the ids of every vehicle that
 * reported at all in the window. The verdict (TL8b) is read off that against whatever truck the history
 * names that day, without asking Samsara again, and after Samsara's retention has dropped the day.
 * "Reported, and not within 10 km" is how `absent` is told apart from "no Samsara data".
 *
 * ── THE WINDOW IS THE PLAZA'S MEASURED CLOCK, NOT THE AGENCY'S ─────────────────────────────────
 * Each placed plaza records how far its printed times sit from the moment the known trucks passed its
 * point, and how far they strayed from that. D-TL14 planned one offset per agency. Measured
 * 2026-11-19, the Illinois Tollway's plazas run from −150 s to +299 s, because a plaza's point and its
 * offset are a pair: the point is found along the road, and a point further along is passed later.
 * So each plaza's own pair is used: the window is printed instant + its offset, ± its spread, bounded
 * to 1.5–5 minutes: never narrower than a printed minute's truncation plus a fix interval, never so
 * wide that a truck an exit away counts as "there".
 */
import { closestApproach, type Fix, type Point } from "./geo.js";

export const OBSERVE_RADIUS_M = 10_000;
export const OBSERVE_MIN_HALF_MS = 90_000;
export const OBSERVE_MAX_HALF_MS = 5 * 60_000;
/** Checkpoints close in time share one Samsara fetch, up to this long. */
export const OBSERVE_WINDOW_MAX_MS = 15 * 60_000;

/** The window around one printed instant at a placed plaza: its offset, ± its spread within bounds. */
export function plazaWindow(printedMs: number, plaza: { offsetS: number; offsetSpreadS: number }): Due {
  return {
    atMs: printedMs + plaza.offsetS * 1000,
    halfMs: Math.min(OBSERVE_MAX_HALF_MS, Math.max(OBSERVE_MIN_HALF_MS, plaza.offsetSpreadS * 1000)),
  };
}

export interface Due {
  /** Middle of the window: the printed instant in the plaza's zone, plus the agency's offset. */
  atMs: number;
  halfMs: number;
}

export interface FetchWindow<T extends Due> {
  startMs: number;
  endMs: number;
  members: T[];
}

/** Group checkpoints into fetch windows no longer than `maxMs`, in time order (oldest first). */
export function planWindows<T extends Due>(due: readonly T[], maxMs = OBSERVE_WINDOW_MAX_MS): FetchWindow<T>[] {
  const sorted = [...due].sort((a, b) => a.atMs - b.atMs);
  const out: FetchWindow<T>[] = [];
  for (const d of sorted) {
    const start = d.atMs - d.halfMs;
    const end = d.atMs + d.halfMs;
    const cur = out[out.length - 1];
    if (cur && Math.max(cur.endMs, end) - cur.startMs <= maxMs) {
      cur.endMs = Math.max(cur.endMs, end);
      cur.members.push(d);
    } else out.push({ startMs: start, endMs: end, members: [d] });
  }
  return out;
}

export type AssetKind = "vehicle" | "trailer";

export interface AssetTrack {
  samsaraId: string;
  kind: AssetKind;
  /** Sorted by time. */
  fixes: Fix[];
}

export interface NearbyAsset {
  samsaraId: string;
  kind: AssetKind;
  distanceM: number;
  /** Seconds from the window's middle to the moment it came closest. */
  offsetS: number;
}

export interface Observation {
  nearby: NearbyAsset[];
  /** Every asset with at least one fix inside the window, sorted. */
  reporting: string[];
}

/** What the fleet's tracks say about one checkpoint. */
export function observe(plaza: Point, due: Due, tracks: readonly AssetTrack[]): Observation {
  const from = due.atMs - due.halfMs;
  const until = due.atMs + due.halfMs;
  const nearby: NearbyAsset[] = [];
  const reporting: string[] = [];
  for (const t of tracks) {
    if (t.fixes.some((f) => f.ms >= from && f.ms <= until)) reporting.push(t.samsaraId);
    const a = closestApproach(t.fixes, plaza, from, until);
    if (a && a.distanceM <= OBSERVE_RADIUS_M) {
      nearby.push({ samsaraId: t.samsaraId, kind: t.kind, distanceM: Math.round(a.distanceM), offsetS: Math.round((a.ms - due.atMs) / 1000) });
    }
  }
  nearby.sort((a, b) => a.distanceM - b.distanceM || a.samsaraId.localeCompare(b.samsaraId));
  reporting.sort();
  return { nearby, reporting };
}

/** Samsara's `stats/history?types=gps` record → fixes in time order. */
export function fixesOfGps(record: { gps?: unknown } | undefined): Fix[] {
  const raw = Array.isArray(record?.gps) ? (record!.gps as Record<string, unknown>[]) : [];
  return raw
    .map((p) => ({ ms: Date.parse(String(p.time)), lat: Number(p.latitude), lon: Number(p.longitude) }))
    .filter((f) => Number.isFinite(f.ms) && Number.isFinite(f.lat) && Number.isFinite(f.lon) && !(f.lat === 0 && f.lon === 0))
    .sort((a, b) => a.ms - b.ms);
}
