/**
 * Data-confidence metrics for the idle feature: how COMPLETE and trustworthy the inputs are, computed from data
 * we already store. Turns "how confident are we?" into visible coverage numbers instead of a judgment call.
 * Pure + testable. Each metric is a share 0-100; the overall is a weighted blend across metrics that have data.
 */

export interface IdleConfidenceEvent {
  /** productive | justified | discretionary | brief | undetermined. 'brief' stops are excluded (never scored). */
  classification: string;
  driverId: string | null;
  /** Measured fuel for the event when Samsara reported it (null = estimated by burn rate). */
  fuelGal: number | null;
  /** Ambient temperature reading (native or backfilled) when present. */
  airTempF: number | null;
}

export interface IdleConfidenceVehicle {
  hasApu: boolean | null;
  apuType: string | null;
  hasOptimizedIdle: boolean | null;
  /** Learned capability; 'unknown' or null means not yet learned. */
  idleCapability: string | null;
}

export type ConfidenceKey =
  | "attribution"
  | "measured_fuel"
  | "temperature"
  | "equipment"
  | "learned"
  | "agreement";

export interface ConfidenceMetric {
  key: ConfidenceKey;
  label: string;
  /** Coverage share 0-100 (0 when total is 0 — see `total`). */
  pct: number;
  covered: number;
  total: number;
  weight: number;
  note: string;
}

export interface IdleConfidenceResult {
  metrics: ConfidenceMetric[];
  /** Weighted 0-100 across metrics that HAVE data (zero-total metrics are excluded and weights renormalized),
   *  so an empty category never distorts the score. null when there is nothing to score at all. */
  overall: number | null;
}

const WEIGHTS: Record<ConfidenceKey, number> = {
  attribution: 0.3,
  measured_fuel: 0.2,
  temperature: 0.2,
  equipment: 0.2,
  learned: 0.1,
  agreement: 0.15,
};

/**
 * Cross-validate the two INDEPENDENT idle signals per truck: Samsara's idle-events total (eventsSec) vs the raw
 * engine-state idle total (statesSec, learned by the capability sync). Only trucks with meaningful idle on both
 * sides are comparable; a truck "agrees" when the ratio is within a broad band (the two sources measure slightly
 * different things, so this is corroboration, not exact equality).
 */
export function computeIdleAgreement(
  trucks: { statesSec: number | null; eventsSec: number }[],
  opts: { minSec?: number; lowRatio?: number; highRatio?: number } = {},
): { comparable: number; agreeing: number } {
  const minSec = opts.minSec ?? 3600; // need >= 1h on both sides to compare fairly
  const lo = opts.lowRatio ?? 0.5;
  const hi = opts.highRatio ?? 2.0;
  let comparable = 0;
  let agreeing = 0;
  for (const t of trucks) {
    if (t.statesSec == null || t.statesSec < minSec || t.eventsSec < minSec) continue;
    comparable += 1;
    const ratio = t.eventsSec / t.statesSec;
    if (ratio >= lo && ratio <= hi) agreeing += 1;
  }
  return { comparable, agreeing };
}

const share = (c: number, t: number) => (t > 0 ? Math.round((c / t) * 1000) / 10 : 0);

export function computeIdleConfidence(input: {
  events: IdleConfidenceEvent[];
  vehicles: IdleConfidenceVehicle[];
  /** Optional cross-validation of Samsara idle events vs raw engine-state idle (see computeIdleAgreement). */
  agreement?: { agreeing: number; comparable: number } | null;
}): IdleConfidenceResult {
  // Only SCORED idle drives the feature; brief sub-threshold stops are ignored everywhere else too.
  const scored = input.events.filter((e) => e.classification !== "brief");
  const vehicles = input.vehicles;

  const attrCov = scored.filter((e) => e.driverId != null).length;
  const fuelCov = scored.filter((e) => e.fuelGal != null).length;
  const tempCov = scored.filter((e) => e.airTempF != null).length;
  const equipCov = vehicles.filter(
    (v) =>
      v.hasApu != null || v.hasOptimizedIdle != null || (v.apuType != null && v.apuType !== ""),
  ).length;
  const learnedCov = vehicles.filter(
    (v) => v.idleCapability != null && v.idleCapability !== "unknown",
  ).length;

  const metrics: ConfidenceMetric[] = [
    {
      key: "attribution",
      label: "Idle events tied to a driver",
      pct: share(attrCov, scored.length),
      covered: attrCov,
      total: scored.length,
      weight: WEIGHTS.attribution,
      note: "Needs a driver assigned in Samsara (or matched by vehicle assignment).",
    },
    {
      key: "measured_fuel",
      label: "Cost from measured fuel",
      pct: share(fuelCov, scored.length),
      covered: fuelCov,
      total: scored.length,
      weight: WEIGHTS.measured_fuel,
      note: "Measured fuel is exact; the rest is estimated by a burn rate.",
    },
    {
      key: "temperature",
      label: "Events with a temperature reading",
      pct: share(tempCov, scored.length),
      covered: tempCov,
      total: scored.length,
      weight: WEIGHTS.temperature,
      note: "Needed to fairly excuse extreme-weather cab idle.",
    },
    {
      key: "equipment",
      label: "Trucks with equipment recorded",
      pct: share(equipCov, vehicles.length),
      covered: equipCov,
      total: vehicles.length,
      weight: WEIGHTS.equipment,
      note: "APU / optimized idle set on the Vehicles page.",
    },
    {
      key: "learned",
      label: "Trucks with a learned capability",
      pct: share(learnedCov, vehicles.length),
      covered: learnedCov,
      total: vehicles.length,
      weight: WEIGHTS.learned,
      note: "Telematics cross-check from engine-state history (needs a Samsara sync).",
    },
  ];

  // CP6: corroboration — do Samsara idle events and the raw engine-state idle broadly agree per truck?
  if (input.agreement && input.agreement.comparable > 0) {
    metrics.push({
      key: "agreement",
      label: "Idle events match engine-state data",
      pct: share(input.agreement.agreeing, input.agreement.comparable),
      covered: input.agreement.agreeing,
      total: input.agreement.comparable,
      weight: WEIGHTS.agreement,
      note: "Two independent idle signals (Samsara events vs raw engine states) agree per truck.",
    });
  }

  const active = metrics.filter((m) => m.total > 0);
  const wsum = active.reduce((s, m) => s + m.weight, 0);
  const overall =
    wsum > 0
      ? Math.round((active.reduce((s, m) => s + m.weight * m.pct, 0) / wsum) * 10) / 10
      : null;

  return { metrics, overall };
}
