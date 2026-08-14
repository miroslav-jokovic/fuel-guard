/** Pure rollup aggregation used by both the Idling page and the live precision verifier. */
import {
  computeAvoidable,
  type AvoidableDaySeconds,
  type AvoidableInput,
} from "./idleAvoidable.js";
import type { IdleCapability } from "./idleSessions.js";
export type IdleBreakdownEnvelopeStatus =
  "sufficient" | "insufficient" | "ambiguous" | "not_applicable" | "unavailable";
export type IdleBreakdownEnvelopeSource = "documented_default" | "learned_behavioral" | "none";

export interface IdleBreakdownRollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec: number;
  optimized_envelope_outside_sec: number;
  optimized_envelope_unknown_sec: number;
  optimized_envelope_ambiguous_sec: number;
  optimized_envelope_status: IdleBreakdownEnvelopeStatus;
  optimized_envelope_source: IdleBreakdownEnvelopeSource;
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_grace_sec: number;
  hos_evidence_status: IdleBreakdownEnvelopeStatus;
  attributed_driver_id?: string | null;
}

export interface VehicleRollupSums {
  drive: number;
  idle: number;
  off: number;
  cov: number;
  managed: number;
  continuous: number;
  rest: number;
  work: number;
  other: number;
  optimizedEnvelopeInside: number;
  optimizedEnvelopeOutside: number;
  optimizedEnvelopeUnknown: number;
  optimizedEnvelopeAmbiguous: number;
  optimizedEnvelopeStatus: IdleBreakdownEnvelopeStatus;
  optimizedEnvelopeSource: IdleBreakdownEnvelopeSource;
  hosRest: number;
  hosWork: number;
  hosUnknown: number;
  hosAmbiguous: number;
  hosGrace: number;
  hosEvidenceStatus: IdleBreakdownEnvelopeStatus;
}

const STATUS_RANK: Record<IdleBreakdownEnvelopeStatus, number> = {
  not_applicable: 0,
  sufficient: 1,
  insufficient: 2,
  ambiguous: 3,
  unavailable: 4,
};

export function sumRollupByVehicle(rows: readonly IdleBreakdownRollupRow[]): Map<string, VehicleRollupSums> {
  const out = new Map<string, VehicleRollupSums>();
  for (const r of rows) {
    const s = out.get(r.vehicle_id) ?? {
      drive: 0,
      idle: 0,
      off: 0,
      cov: 0,
      managed: 0,
      continuous: 0,
      rest: 0,
      work: 0,
      other: 0,
      optimizedEnvelopeInside: 0,
      optimizedEnvelopeOutside: 0,
      optimizedEnvelopeUnknown: 0,
      optimizedEnvelopeAmbiguous: 0,
      optimizedEnvelopeStatus: "not_applicable",
      optimizedEnvelopeSource: "none",
      hosRest: 0,
      hosWork: 0,
      hosUnknown: 0,
      hosAmbiguous: 0,
      hosGrace: 0,
      hosEvidenceStatus: "not_applicable",
    };
    s.drive += Number(r.drive_sec);
    s.idle += Number(r.idle_sec);
    s.off += Number(r.off_sec);
    s.cov += Number(r.coverage_sec);
    s.managed += Number(r.managed_idle_sec);
    s.continuous += Number(r.continuous_idle_sec);
    s.rest += Number(r.rest_idle_sec);
    s.work += Number(r.work_idle_sec);
    s.other += Number(r.other_idle_sec);
    s.optimizedEnvelopeInside += Number(r.optimized_envelope_inside_sec);
    s.optimizedEnvelopeOutside += Number(r.optimized_envelope_outside_sec);
    s.optimizedEnvelopeUnknown += Number(r.optimized_envelope_unknown_sec);
    s.optimizedEnvelopeAmbiguous += Number(r.optimized_envelope_ambiguous_sec);
    if (STATUS_RANK[r.optimized_envelope_status] > STATUS_RANK[s.optimizedEnvelopeStatus])
      s.optimizedEnvelopeStatus = r.optimized_envelope_status;
    if (r.optimized_envelope_source === "learned_behavioral") s.optimizedEnvelopeSource = "learned_behavioral";
    else if (s.optimizedEnvelopeSource === "none") s.optimizedEnvelopeSource = r.optimized_envelope_source;
    s.hosRest += Number(r.hos_rest_sec);
    s.hosWork += Number(r.hos_work_sec);
    s.hosUnknown += Number(r.hos_unknown_sec);
    s.hosAmbiguous += Number(r.hos_ambiguous_sec);
    s.hosGrace += Number(r.hos_grace_sec);
    if (STATUS_RANK[r.hos_evidence_status] > STATUS_RANK[s.hosEvidenceStatus])
      s.hosEvidenceStatus = r.hos_evidence_status;
    out.set(r.vehicle_id, s);
  }
  return out;
}

/** Rollup rows grouped per vehicle, order preserved — the per-day detail `sumRollupByVehicle` collapses. */
export function groupRollupByVehicle(
  rows: readonly IdleBreakdownRollupRow[],
): Map<string, IdleBreakdownRollupRow[]> {
  const out = new Map<string, IdleBreakdownRollupRow[]>();
  for (const r of rows) {
    const list = out.get(r.vehicle_id) ?? [];
    list.push(r);
    out.set(r.vehicle_id, list);
  }
  return out;
}

/** One rollup row expressed as a single-day `computeAvoidable` input. */
function dayInput(
  r: IdleBreakdownRollupRow,
  truck: { hasApu: boolean | null; hasOptimizedIdle: boolean | null; learnedCapability: IdleCapability },
): AvoidableInput {
  const continuous = Number(r.continuous_idle_sec);
  return {
    driveSec: Number(r.drive_sec),
    idleSec: Number(r.idle_sec),
    offSec: Number(r.off_sec),
    coverageSec: Number(r.coverage_sec),
    periodSec: 86_400,
    sessions: [
      { idleSec: continuous, mode: "continuous" },
      { idleSec: Number(r.managed_idle_sec), mode: "apu_or_off" },
    ],
    hasApu: truck.hasApu,
    hasOptimizedIdle: truck.hasOptimizedIdle,
    learnedCapability: truck.learnedCapability,
    optimizedEnvelope:
      truck.hasOptimizedIdle === true && continuous > 0
        ? {
            status:
              r.optimized_envelope_status === "not_applicable"
                ? "unavailable"
                : r.optimized_envelope_status,
            source: r.optimized_envelope_source,
            insideSec: Number(r.optimized_envelope_inside_sec),
            outsideSec: Number(r.optimized_envelope_outside_sec),
            unknownSec: Number(r.optimized_envelope_unknown_sec),
            ambiguousSec: Number(r.optimized_envelope_ambiguous_sec),
          }
        : undefined,
    dutyEvidence:
      continuous > 0
        ? {
            status: r.hos_evidence_status === "not_applicable" ? "unavailable" : r.hos_evidence_status,
            restSec: Number(r.hos_rest_sec),
            workSec: Number(r.hos_work_sec),
            unknownSec: Number(r.hos_unknown_sec),
            ambiguousSec: Number(r.hos_ambiguous_sec),
            graceSec: Number(r.hos_grace_sec),
          }
        : undefined,
  };
}

/**
 * Split a truck's range verdict into per-day avoidable / reducible seconds, so each day can be charged at
 * the diesel price that day actually cost.
 *
 * The shares are computed by evaluating the SAME bucket logic against each day's own rollup row — its own
 * temperature evidence, its own duty overlay, its own grace — not by smearing a range total across days in
 * proportion to idle. A cold day where the envelope says "justified" contributes nothing to the avoidable
 * share even if it idled heavily, which is exactly the distinction a proportional split would lose.
 *
 * The gates stay where they belong: whether a truck is scoreable at all is a RANGE judgement (coverage over
 * the range, evidenced share over the range, equipment on the vehicle), so the per-day pass runs with the
 * coverage floor lifted and the range verdict supplies the totals. The day shares are then normalized onto
 * those totals, so the priced result and the audited verdict can never disagree about how many hours there
 * were — only about what each hour cost.
 */
export function avoidableDaySeconds(
  dayRows: readonly IdleBreakdownRollupRow[],
  truck: { hasApu: boolean | null; hasOptimizedIdle: boolean | null; learnedCapability: IdleCapability },
  rangeTotals: { avoidableIdleSec: number; reducibleIdleSec: number | null },
): AvoidableDaySeconds[] {
  const perDay = dayRows.map((r) => {
    const v = computeAvoidable(dayInput(r, truck), { minCoverage: 0 });
    return {
      day: r.day,
      avoidableIdleSec: Math.max(0, v.avoidableIdleSec),
      reducibleIdleSec: Math.max(0, v.reducibleIdleSec ?? 0),
    };
  });

  const scaleTo = (key: "avoidableIdleSec" | "reducibleIdleSec", target: number): void => {
    const sum = perDay.reduce((t, d) => t + d[key], 0);
    if (target <= 0) {
      for (const d of perDay) d[key] = 0;
      return;
    }
    if (sum <= 0) {
      // The per-day pass found no eligible day (e.g. every day individually fails an evidence gate the
      // range clears). Spread the range total over the days that actually held continuous idle, so the
      // cost still lands on real days rather than on the first one.
      const weights = dayRows.map((r) => Math.max(0, Number(r.continuous_idle_sec)));
      const weightSum = weights.reduce((t, w) => t + w, 0);
      if (weightSum <= 0) return;
      perDay.forEach((d, i) => (d[key] = (target * weights[i]!) / weightSum));
      return;
    }
    const scale = target / sum;
    for (const d of perDay) d[key] *= scale;
  };

  scaleTo("avoidableIdleSec", Math.max(0, rangeTotals.avoidableIdleSec));
  scaleTo("reducibleIdleSec", Math.max(0, rangeTotals.reducibleIdleSec ?? 0));
  return perDay;
}
