/** Pure rollup aggregation used by both the Idling page and the live precision verifier. */
import {
  avoidableCostByDay,
  computeAvoidable,
  idleScore,
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

// ── the fleet verdict ───────────────────────────────────────────────────────────────────────────
/**
 * WHY THIS MOVED HERE. The per-truck avoidable verdict and its fleet roll-up lived in
 * `apps/web/src/composables/useIdleBreakdown.ts`, so only a browser could produce it. The fuel-spend
 * REPORT — the artifact that actually gets forwarded to somebody — could not, and its first version
 * filled the gap by multiplying idle seconds by a burn rate and printing the total as waste. That is
 * the every-truck-is-avoidable over-count `docs/plans/IDLE-AVOIDABLE-HOS.md` was written to kill.
 *
 * Pure and here, one implementation answers "whose idle was this" for the page and the document alike,
 * and — unlike the composable it came from — it can be tested.
 */
/** A truck's admin-confirmed equipment and its learned behaviour. Equipment is the source of truth. */
export interface IdleVehicle {
  id: string;
  unitNumber: string;
  hasApu: boolean | null;
  hasOptimizedIdle: boolean | null;
  learnedCapability: IdleCapability;
}

export interface IdleCostBasisInput {
  idleGalPerHour: number;
  fuelPricePerGal: number;
}

export interface TruckIdleVerdict {
  vehicleId: string;
  unit: string;
  engineOnH: number;
  driveH: number;
  idleH: number;
  offH: number;
  idlePct: number;
  managedH: number;
  continuousH: number;
  avoidableH: number;
  avoidableUsd: number;
  /** Rest idle an alternative WOULD carry — reported for every truck, equipped or not. The capex case. */
  reducibleH: number | null;
  reducibleUsd: number | null;
  blendedPricePerGal: number | null;
  unpricedDays: number;
  unavoidableH: number;
  justifiedH: number;
  uncertainH: number;
  operationalGraceH: number;
  score: number | null;
  alternative: string;
  capability: IdleCapability;
  coveragePct: number;
  confident: boolean;
  restIdleH: number | null;
  workIdleH: number | null;
}

export interface FleetIdleVerdict {
  engineOnH: number;
  driveH: number;
  idleH: number;
  offH: number;
  drivePct: number;
  idlePct: number;
  avoidableH: number;
  avoidableUsd: number;
  /** Across every COVERED truck, including ones the equipment flags exclude from `avoidable`. */
  reducibleH: number;
  reducibleUsd: number;
  reducibleTrucks: number;
  confidentTrucks: number;
  totalTrucks: number;
  rangeDays: number;
}

const hrs = (sec: number) => Math.round(sec / 360) / 10; // seconds → hours, 0.1h

function envelopeFor(s: VehicleRollupSums, hasOptimizedIdle: boolean | null) {
  if (hasOptimizedIdle !== true || s.continuous <= 0) return undefined;
  return {
    status: s.optimizedEnvelopeStatus === "not_applicable" ? ("unavailable" as const) : s.optimizedEnvelopeStatus,
    source: s.optimizedEnvelopeSource,
    insideSec: s.optimizedEnvelopeInside,
    outsideSec: s.optimizedEnvelopeOutside,
    unknownSec: s.optimizedEnvelopeUnknown,
    ambiguousSec: s.optimizedEnvelopeAmbiguous,
  };
}

function dutyEvidenceFor(s: VehicleRollupSums) {
  if (s.continuous <= 0) return undefined;
  return {
    status: s.hosEvidenceStatus === "not_applicable" ? ("unavailable" as const) : s.hosEvidenceStatus,
    restSec: s.hosRest,
    workSec: s.hosWork,
    unknownSec: s.hosUnknown,
    ambiguousSec: s.hosAmbiguous,
    graceSec: s.hosGrace,
  };
}

/**
 * The coverage denominator: days the rollup actually HAS data for, capped by the span asked about.
 *
 * FOUND IN PRODUCTION. Rollup history starts when the feature shipped, so spanning a 3-month range
 * diluted every truck's coverage below the confidence floor — the confident-only fleet card showed $0
 * while the 30-day default showed $13k. Counting DISTINCT data days also survives one stray old row
 * that would otherwise stretch the span and re-zero the card.
 */
export function idleRangeDays(rows: readonly IdleBreakdownRollupRow[], fromDate: string, toDate: string): number {
  const selected = Math.max(
    1,
    Math.round((Date.parse(`${toDate}T23:59:59.999Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000),
  );
  const withData = new Set(rows.map((r) => r.day)).size;
  return Math.max(1, Math.min(selected, withData));
}

/**
 * Per-truck verdicts and the fleet roll-up, from stored rollup rows plus each truck's equipment.
 *
 * `dayPrices` charges each day at the diesel price that day actually cost; days without one fall back
 * to `costBasis` and are counted in `unpricedDays` rather than hidden.
 */
export function computeIdleBreakdown(
  rows: readonly IdleBreakdownRollupRow[],
  vehicles: readonly IdleVehicle[],
  dayPrices: Map<string, number>,
  opts: { rangeDays: number; costBasis: IdleCostBasisInput },
): { trucks: TruckIdleVerdict[]; fleet: FleetIdleVerdict } {
  const sums = sumRollupByVehicle(rows);
  const rowsByVehicle = groupRollupByVehicle(rows);
  const periodSec = opts.rangeDays * 86_400;

  const trucks: TruckIdleVerdict[] = [];
  for (const v of vehicles) {
    const s = sums.get(v.id);
    if (!s) continue; // nothing observed for this truck in the range
    const r = computeAvoidable({
      driveSec: s.drive,
      idleSec: s.idle,
      offSec: s.off,
      coverageSec: s.cov,
      periodSec,
      // Mode SUMS are all computeAvoidable uses — two synthetic sessions reproduce it exactly.
      sessions: [
        { idleSec: s.continuous, mode: "continuous" },
        { idleSec: s.managed, mode: "apu_or_off" },
      ],
      hasApu: v.hasApu,
      hasOptimizedIdle: v.hasOptimizedIdle,
      learnedCapability: v.learnedCapability,
      optimizedEnvelope: envelopeFor(s, v.hasOptimizedIdle),
      dutyEvidence: dutyEvidenceFor(s),
    });
    const dayCost = avoidableCostByDay(
      avoidableDaySeconds(
        rowsByVehicle.get(v.id) ?? [],
        { hasApu: v.hasApu, hasOptimizedIdle: v.hasOptimizedIdle, learnedCapability: v.learnedCapability },
        { avoidableIdleSec: r.avoidableIdleSec, reducibleIdleSec: r.reducibleIdleSec },
      ),
      dayPrices,
      { idleGalPerHour: opts.costBasis.idleGalPerHour, fuelPricePerGal: opts.costBasis.fuelPricePerGal },
    );
    trucks.push({
      vehicleId: v.id,
      unit: v.unitNumber,
      engineOnH: hrs(r.engineOnSec),
      driveH: hrs(r.driveSec),
      idleH: hrs(r.idleSec),
      offH: hrs(r.offSec),
      idlePct: r.engineOnSec > 0 ? Math.round((r.idleSec / r.engineOnSec) * 1000) / 10 : 0,
      managedH: hrs(r.managedIdleSec),
      continuousH: hrs(r.continuousIdleSec),
      avoidableH: hrs(r.avoidableIdleSec),
      reducibleH: r.reducibleIdleSec == null ? null : hrs(r.reducibleIdleSec),
      reducibleUsd: r.reducibleIdleSec == null ? null : dayCost.reducible.usd,
      unavoidableH: hrs(r.unavoidableIdleSec),
      justifiedH: hrs(r.justifiedIdleSec),
      uncertainH: hrs(r.uncertainIdleSec),
      operationalGraceH: hrs(r.operationalGraceIdleSec),
      avoidableUsd: dayCost.avoidable.usd,
      blendedPricePerGal: dayCost.avoidable.blendedPricePerGal,
      unpricedDays: dayCost.avoidable.unpricedDays,
      score: idleScore(r.avoidableIdleSec, r.engineOnSec),
      alternative: r.alternative,
      capability: v.learnedCapability,
      coveragePct: Math.round(r.coverage * 1000) / 10,
      confident: r.confident,
      // No duty overlay at all (idled, but zero attributed seconds in any bucket) → "—", not fake 0.
      restIdleH: s.rest + s.work + s.other === 0 && s.idle > 0 ? null : hrs(s.rest),
      workIdleH: s.rest + s.work + s.other === 0 && s.idle > 0 ? null : hrs(s.work),
    });
  }
  trucks.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);

  let engineOn = 0, drive = 0, idle = 0, off = 0;
  let avoidH = 0, avoidUsd = 0, confidentTrucks = 0;
  let reduceH = 0, reduceUsd = 0, reducibleTrucks = 0;
  for (const t of trucks) {
    engineOn += t.engineOnH;
    drive += t.driveH;
    idle += t.idleH;
    off += t.offH;
    if (t.confident) {
      avoidH += t.avoidableH;
      avoidUsd += t.avoidableUsd;
      confidentTrucks += 1;
    }
    // Reducible deliberately does NOT gate on `confident`: confidence is about whether we can BLAME the
    // truck, and the equipment flag it turns on is exactly what the opportunity measure works without.
    // It gates on coverage only — enough of the range observed to trust the hours.
    if (t.reducibleH != null && t.reducibleH > 0 && t.coveragePct >= 50) {
      reduceH += t.reducibleH;
      reduceUsd += t.reducibleUsd ?? 0;
      reducibleTrucks += 1;
    }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    trucks,
    fleet: {
      engineOnH: r1(engineOn),
      driveH: r1(drive),
      idleH: r1(idle),
      offH: r1(off),
      drivePct: engineOn > 0 ? Math.round((drive / engineOn) * 1000) / 10 : 0,
      idlePct: engineOn > 0 ? Math.round((idle / engineOn) * 1000) / 10 : 0,
      avoidableH: r1(avoidH),
      avoidableUsd: Math.round(avoidUsd * 100) / 100,
      reducibleH: r1(reduceH),
      reducibleUsd: Math.round(reduceUsd * 100) / 100,
      reducibleTrucks,
      confidentTrucks,
      totalTrucks: trucks.length,
      rangeDays: opts.rangeDays,
    },
  };
}
