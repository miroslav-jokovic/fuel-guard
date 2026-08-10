/**
 * Vehicle-attributed HOS timelines.
 *
 * Split out of hos.ts on 2026-08-10: that file crossed the 500-line budget when vehicle timelines were
 * added, and this is a self-contained unit — a one-pass sweep that turns a vehicle's overlapping,
 * driver-keyed HOS segments into a sorted disjoint interval list, plus the range query over it. Building
 * it once per vehicle and reusing it is what keeps the idle rollup off an O(sessions x segments) scan.
 *
 * Re-exported from the package root, so consumers keep importing these from "@fuelguard/shared".
 */
import { hosDutyKind, type HosDutyKind, type HosSegment, type HosVehicleOverlap } from "./hos.js";

export interface HosVehicleTimelineInterval {
  startMs: number;
  endMs: number;
  kind: HosDutyKind;
  ambiguous: boolean;
}

export interface HosVehicleTimeline {
  vehicleId: string;
  intervals: HosVehicleTimelineInterval[];
  sourceSegmentCount: number;
}

/**
 * Build a sorted, disjoint duty timeline for one vehicle. The sweep is performed once per vehicle and can
 * then be reused for every idle event and parked session in the same rollup window. Intervals with no active
 * HOS segment are intentionally omitted: callers must treat those gaps as uncovered, never as rest.
 */
export function buildHosVehicleTimeline(
  vehicleId: string,
  segments: HosSegment[],
  windowStartMs: number,
  windowEndMs: number,
): HosVehicleTimeline {
  const timeline: HosVehicleTimeline = {
    vehicleId,
    intervals: [],
    sourceSegmentCount: 0,
  };
  if (!(windowEndMs > windowStartMs)) return timeline;

  const boundaries = new Map<number, Map<HosDutyKind, number>>();
  const addDelta = (timeMs: number, kind: HosDutyKind, delta: number): void => {
    const byKind = boundaries.get(timeMs) ?? new Map<HosDutyKind, number>();
    byKind.set(kind, (byKind.get(kind) ?? 0) + delta);
    boundaries.set(timeMs, byKind);
  };

  for (const segment of segments) {
    if (segment.vehicleId !== vehicleId) continue;
    const startMs = Math.max(windowStartMs, segment.startMs);
    const rawEndMs = segment.endMs ?? windowEndMs;
    const endMs = Math.min(windowEndMs, rawEndMs);
    if (!(endMs > startMs)) continue;
    const kind = hosDutyKind(segment.status);
    timeline.sourceSegmentCount += 1;
    addDelta(startMs, kind, 1);
    addDelta(endMs, kind, -1);
  }

  const ordered = [...boundaries.keys()].sort((a, b) => a - b);
  const active = new Map<HosDutyKind, number>();
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const boundary = ordered[i]!;
    for (const [kind, delta] of boundaries.get(boundary)!) {
      const next = (active.get(kind) ?? 0) + delta;
      if (next > 0) active.set(kind, next);
      else active.delete(kind);
    }
    const endMs = ordered[i + 1]!;
    if (!(endMs > boundary) || active.size === 0) continue;
    const kinds = [...active.keys()];
    const interval: HosVehicleTimelineInterval = {
      startMs: boundary,
      endMs,
      kind: kinds[0]!,
      ambiguous: kinds.length > 1,
    };
    const previous = timeline.intervals[timeline.intervals.length - 1];
    if (
      previous != null &&
      previous.endMs === interval.startMs &&
      previous.kind === interval.kind &&
      previous.ambiguous === interval.ambiguous
    ) {
      previous.endMs = interval.endMs;
    } else {
      timeline.intervals.push(interval);
    }
  }
  return timeline;
}

/** Build reusable timelines for all explicitly vehicle-linked HOS segments. */
export function buildHosVehicleTimelines(
  segmentsByVehicle: Map<string, HosSegment[]>,
  windowStartMs: number,
  windowEndMs: number,
): Map<string, HosVehicleTimeline> {
  const timelines = new Map<string, HosVehicleTimeline>();
  for (const [vehicleId, segments] of segmentsByVehicle) {
    const timeline = buildHosVehicleTimeline(vehicleId, segments, windowStartMs, windowEndMs);
    // Keep an empty timeline for a vehicle that has linked HOS rows outside this window. Its presence is
    // still authoritative: callers must not switch to a driver-only fallback for that vehicle.
    timelines.set(vehicleId, timeline);
  }
  return timelines;
}

/** Split a query range using a precomputed vehicle timeline. */
export function hosVehicleTimelineOverlapSeconds(
  timeline: HosVehicleTimeline,
  startMs: number,
  endMs: number,
): HosVehicleOverlap {
  const result: HosVehicleOverlap = {
    restSec: 0,
    workSec: 0,
    drivingSec: 0,
    excludedSec: 0,
    unknownSec: 0,
    coveredSec: 0,
    ambiguousSec: 0,
    segmentCount: 0,
  };
  if (!(endMs > startMs)) return result;

  let first = 0;
  let last = timeline.intervals.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (timeline.intervals[middle]!.endMs <= startMs) first = middle + 1;
    else last = middle;
  }
  for (let i = first; i < timeline.intervals.length; i += 1) {
    const interval = timeline.intervals[i]!;
    if (interval.startMs >= endMs) break;
    const lo = Math.max(startMs, interval.startMs);
    const hi = Math.min(endMs, interval.endMs);
    if (!(hi > lo)) continue;
    result.segmentCount += 1;
    const seconds = (hi - lo) / 1000;
    result.coveredSec += seconds;
    if (interval.ambiguous) {
      result.ambiguousSec += seconds;
      continue;
    }
    switch (interval.kind) {
      case "rest":
        result.restSec += seconds;
        break;
      case "work":
        result.workSec += seconds;
        break;
      case "driving":
        result.drivingSec += seconds;
        break;
      case "excluded":
        result.excludedSec += seconds;
        break;
      default:
        result.unknownSec += seconds;
        break;
    }
  }
  return result;
}
