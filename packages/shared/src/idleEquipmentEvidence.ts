import { APU_TYPES, type ApuType } from "./constants.js";

/** A documented profile is deliberately narrower than an equipment label. */
export type IdleEquipmentProfile =
  | "optimized_idle_documented_default"
  | "apu_unprofiled"
  | "diesel_apu_unprofiled"
  | "battery_hvac_unprofiled"
  | "fuel_heater_unprofiled"
  | "shore_power_unprofiled"
  | "none"
  | "unknown";

export type IdleEquipmentEvidenceStatus =
  | "inside_documented_default"
  | "outside_documented_default"
  | "mixed_documented_default"
  | "insufficient"
  | "ambiguous"
  | "not_applicable"
  | "unknown";

export const IDLE_EQUIPMENT_EVIDENCE_VERSION = "equipment-temp-v1" as const;
export const IDLE_LEARNED_ENVELOPE_VERSION = "optimized-envelope-v1" as const;

/** A temperature interval may be null when Samsara/weather backfill did not provide a value. */
export interface IdleThermalInterval {
  startMs: number;
  endMs: number;
  tempF: number | null;
}

export interface IdleEquipmentProfileInput {
  hasApu: boolean | null | undefined;
  apuType: ApuType | null | undefined;
  hasOptimizedIdle: boolean | null | undefined;
}

export interface IdleEquipmentEvidenceInput {
  profile: IdleEquipmentProfile;
  sessionStartMs: number;
  sessionEndMs: number;
  totalIdleSec: number;
  intervals: readonly IdleThermalInterval[];
  /** Active temperature envelope. Defaults to Detroit's documented factory limits. */
  envelopeLowF?: number;
  envelopeHighF?: number;
}

export interface IdleEquipmentEvidence {
  profile: IdleEquipmentProfile;
  status: IdleEquipmentEvidenceStatus;
  ambientSampleCount: number;
  ambientKnownIdleSec: number;
  ambientUnknownIdleSec: number;
  ambientMinF: number | null;
  ambientMaxF: number | null;
  ambientAvgF: number | null;
  envelopeInsideSec: number;
  envelopeOutsideSec: number;
  envelopeAmbiguousSec: number;
  evidenceVersion: typeof IDLE_EQUIPMENT_EVIDENCE_VERSION;
}

/** Detroit's manual calls these factory defaults and separately allows the limits to be changed. */
export const DETROIT_OPTIMIZED_IDLE_DEFAULT_LOW_F = 25;
export const DETROIT_OPTIMIZED_IDLE_DEFAULT_HIGH_F = 90;

export type IdleLearnedEnvelopeStatus = "sufficient" | "insufficient" | "not_applicable";

export type IdleEnvelopeObservationMode = "optimized_cycling" | "continuous";

export interface IdleEnvelopeObservation {
  temperatureF: number;
  mode: IdleEnvelopeObservationMode;
  idleSec: number;
}

export interface IdleLearnedEnvelope {
  status: IdleLearnedEnvelopeStatus;
  lowF: number | null;
  highF: number | null;
  sessions: number;
  knownIdleSec: number;
  cyclingIdleSec: number;
  continuousIdleSec: number;
  temperatureBins: number;
  evidenceVersion: typeof IDLE_LEARNED_ENVELOPE_VERSION;
}

export interface IdleLearnedEnvelopeOpts {
  minSessions?: number;
  minKnownIdleSec?: number;
  binSizeF?: number;
  minBinSec?: number;
  minCycleShare?: number;
  minCycleClusterWidthF?: number;
  minContinuousTailSec?: number;
  minContinuousTailShare?: number;
}

const DEFAULT_LEARNED_ENVELOPE_OPTS: Required<IdleLearnedEnvelopeOpts> = {
  minSessions: 20,
  minKnownIdleSec: 72_000,
  binSizeF: 5,
  minBinSec: 1_800,
  minCycleShare: 0.5,
  minCycleClusterWidthF: 20,
  minContinuousTailSec: 7_200,
  minContinuousTailShare: 0.5,
};

interface TemperatureBin {
  totalSec: number;
  cyclingSec: number;
  continuousSec: number;
}

function emptyLearnedEnvelope(status: IdleLearnedEnvelopeStatus): IdleLearnedEnvelope {
  return {
    status,
    lowF: null,
    highF: null,
    sessions: 0,
    knownIdleSec: 0,
    cyclingIdleSec: 0,
    continuousIdleSec: 0,
    temperatureBins: 0,
    evidenceVersion: IDLE_LEARNED_ENVELOPE_VERSION,
  };
}

function contiguousRuns(keys: number[], binSizeF: number): number[][] {
  const runs: number[][] = [];
  for (const key of keys.sort((a, b) => a - b)) {
    const current = runs[runs.length - 1];
    if (current == null || key - current[current.length - 1]! > binSizeF) runs.push([key]);
    else current.push(key);
  }
  return runs;
}

/**
 * Learn an Optimized Idle temperature envelope from observed parked-session behavior.
 *
 * This is deliberately not a generic APU learner: engine-off state does not identify an APU. The learned band
 * requires a substantial amount of known temperature data, a contiguous cycling cluster, and continuous-idle
 * tails on both sides. Missing or one-sided seasonal data returns insufficient, preserving the documented
 * default for the caller.
 */
export function learnIdleTemperatureEnvelope(
  observations: readonly IdleEnvelopeObservation[],
  opts: IdleLearnedEnvelopeOpts = {},
): IdleLearnedEnvelope {
  const o = { ...DEFAULT_LEARNED_ENVELOPE_OPTS, ...opts };
  const valid = observations.filter(
    (observation) =>
      Number.isFinite(observation.temperatureF) &&
      Number.isFinite(observation.idleSec) &&
      observation.idleSec > 0,
  );
  const result = emptyLearnedEnvelope("insufficient");
  result.sessions = valid.length;
  result.knownIdleSec = Math.round(
    valid.reduce((total, observation) => total + observation.idleSec, 0),
  );
  result.cyclingIdleSec = Math.round(
    valid
      .filter((observation) => observation.mode === "optimized_cycling")
      .reduce((total, observation) => total + observation.idleSec, 0),
  );
  result.continuousIdleSec = Math.round(
    valid
      .filter((observation) => observation.mode === "continuous")
      .reduce((total, observation) => total + observation.idleSec, 0),
  );

  const bins = new Map<number, TemperatureBin>();
  for (const observation of valid) {
    const key = Math.floor(observation.temperatureF / o.binSizeF) * o.binSizeF;
    const bin = bins.get(key) ?? { totalSec: 0, cyclingSec: 0, continuousSec: 0 };
    bin.totalSec += observation.idleSec;
    if (observation.mode === "optimized_cycling") bin.cyclingSec += observation.idleSec;
    else bin.continuousSec += observation.idleSec;
    bins.set(key, bin);
  }
  result.temperatureBins = bins.size;
  if (
    valid.length < o.minSessions ||
    result.knownIdleSec < o.minKnownIdleSec ||
    result.cyclingIdleSec <= 0 ||
    result.continuousIdleSec <= 0
  )
    return result;

  const eligibleKeys = [...bins.entries()]
    .filter(
      ([, bin]) => bin.totalSec >= o.minBinSec && bin.cyclingSec / bin.totalSec >= o.minCycleShare,
    )
    .map(([key]) => key);
  const runs = contiguousRuns(eligibleKeys, o.binSizeF);
  const candidate = runs
    .filter((run) => run.length * o.binSizeF >= o.minCycleClusterWidthF)
    .sort((left, right) => {
      const leftSec = left.reduce((total, key) => total + bins.get(key)!.cyclingSec, 0);
      const rightSec = right.reduce((total, key) => total + bins.get(key)!.cyclingSec, 0);
      return rightSec - leftSec || right.length - left.length || left[0]! - right[0]!;
    })[0];
  if (candidate == null) return result;

  const lowF = candidate[0]!;
  const highF = candidate[candidate.length - 1]! + o.binSizeF;
  const lowTail = [...bins.entries()]
    .filter(([key]) => key < lowF)
    .reduce(
      (tail, [, bin]) => ({
        totalSec: tail.totalSec + bin.totalSec,
        continuousSec: tail.continuousSec + bin.continuousSec,
      }),
      { totalSec: 0, continuousSec: 0 },
    );
  const highTail = [...bins.entries()]
    .filter(([key]) => key >= highF)
    .reduce(
      (tail, [, bin]) => ({
        totalSec: tail.totalSec + bin.totalSec,
        continuousSec: tail.continuousSec + bin.continuousSec,
      }),
      { totalSec: 0, continuousSec: 0 },
    );
  const hasLowTail =
    lowTail.totalSec > 0 &&
    lowTail.continuousSec >= o.minContinuousTailSec &&
    lowTail.continuousSec / lowTail.totalSec >= o.minContinuousTailShare;
  const hasHighTail =
    highTail.totalSec > 0 &&
    highTail.continuousSec >= o.minContinuousTailSec &&
    highTail.continuousSec / highTail.totalSec >= o.minContinuousTailShare;
  if (!hasLowTail || !hasHighTail) return result;

  result.status = "sufficient";
  result.lowF = lowF;
  result.highF = highF;
  return result;
}

export interface OptimizedIdleEnvelope {
  lowF: number;
  highF: number;
  source: "documented_default" | "learned_behavioral";
}

/** Resolve the active Optimized Idle envelope; insufficient learning always falls back to the documented default. */
export function resolveOptimizedIdleEnvelope(learned: IdleLearnedEnvelope): OptimizedIdleEnvelope {
  if (
    learned.status === "sufficient" &&
    learned.lowF != null &&
    learned.highF != null &&
    learned.lowF < learned.highF
  ) {
    return { lowF: learned.lowF, highF: learned.highF, source: "learned_behavioral" };
  }
  return {
    lowF: DETROIT_OPTIMIZED_IDLE_DEFAULT_LOW_F,
    highF: DETROIT_OPTIMIZED_IDLE_DEFAULT_HIGH_F,
    source: "documented_default",
  };
}

function isApuType(value: string): value is ApuType {
  return (APU_TYPES as readonly string[]).includes(value);
}

/** Resolve only the equipment fact that the fleet configuration actually records. */
export function resolveIdleEquipmentProfile(
  input: IdleEquipmentProfileInput,
): IdleEquipmentProfile {
  if (input.hasOptimizedIdle === true) return "optimized_idle_documented_default";
  if (input.apuType != null) {
    if (input.apuType === "none") return "none";
    return `${input.apuType}_unprofiled` as Exclude<
      IdleEquipmentProfile,
      "optimized_idle_documented_default" | "none" | "unknown"
    >;
  }
  if (input.hasApu === true) return "apu_unprofiled";
  if (input.hasApu === false) return "none";
  return "unknown";
}

/** Parse the constrained DB text without treating an arbitrary value as known equipment. */
export function parseIdleEquipmentType(value: string | null | undefined): ApuType | null {
  return value != null && isApuType(value) ? value : null;
}

function rounded(value: number): number {
  return Math.round(value);
}

function roundedTemperature(value: number): number {
  return Math.round(value * 10) / 10;
}

function baseEvidence(profile: IdleEquipmentProfile): IdleEquipmentEvidence {
  return {
    profile,
    status:
      profile === "none"
        ? "not_applicable"
        : profile === "optimized_idle_documented_default"
          ? "insufficient"
          : "unknown",
    ambientSampleCount: 0,
    ambientKnownIdleSec: 0,
    ambientUnknownIdleSec: 0,
    ambientMinF: null,
    ambientMaxF: null,
    ambientAvgF: null,
    envelopeInsideSec: 0,
    envelopeOutsideSec: 0,
    envelopeAmbiguousSec: 0,
    evidenceVersion: IDLE_EQUIPMENT_EVIDENCE_VERSION,
  };
}

/**
 * Summarize ambient-temperature evidence over the engine-idle portion of a parked session.
 *
 * Overlapping intervals are swept once. Conflicting values are retained as ambiguous seconds instead of
 * averaged, and gaps/null values remain unknown. This makes the output suitable for later scoring without
 * silently converting missing telemetry into a favorable or unfavorable conclusion.
 */
export function summarizeIdleEquipmentEvidence(
  input: IdleEquipmentEvidenceInput,
): IdleEquipmentEvidence {
  const evidence = baseEvidence(input.profile);
  const sessionStartMs = Number.isFinite(input.sessionStartMs) ? input.sessionStartMs : 0;
  const sessionEndMs = Number.isFinite(input.sessionEndMs) ? input.sessionEndMs : sessionStartMs;
  const totalIdleSec = Math.max(0, input.totalIdleSec);
  if (sessionEndMs <= sessionStartMs || totalIdleSec <= 0) return evidence;
  const envelopeLowF = Number.isFinite(input.envelopeLowF)
    ? input.envelopeLowF!
    : DETROIT_OPTIMIZED_IDLE_DEFAULT_LOW_F;
  const envelopeHighF = Number.isFinite(input.envelopeHighF)
    ? input.envelopeHighF!
    : DETROIT_OPTIMIZED_IDLE_DEFAULT_HIGH_F;
  if (!(envelopeLowF < envelopeHighF)) return evidence;

  const clipped = input.intervals
    .filter(
      (interval) =>
        Number.isFinite(interval.startMs) &&
        Number.isFinite(interval.endMs) &&
        interval.endMs > interval.startMs,
    )
    .map((interval) => ({
      startMs: Math.max(sessionStartMs, interval.startMs),
      endMs: Math.min(sessionEndMs, interval.endMs),
      tempF: interval.tempF != null && Number.isFinite(interval.tempF) ? interval.tempF : null,
    }))
    .filter((interval) => interval.endMs > interval.startMs);
  const boundaries = new Set<number>([sessionStartMs, sessionEndMs]);
  for (const interval of clipped) {
    boundaries.add(interval.startMs);
    boundaries.add(interval.endMs);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  let weightedTemperature = 0;
  let knownSec = 0;
  let unknownSec = 0;
  let ambiguousSec = 0;
  let insideSec = 0;
  let outsideSec = 0;
  const knownTemps: number[] = [];

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const startMs = ordered[i]!;
    const endMs = ordered[i + 1]!;
    const seconds = (endMs - startMs) / 1000;
    if (seconds <= 0) continue;
    const active = clipped.filter(
      (interval) => interval.startMs <= startMs && interval.endMs >= endMs,
    );
    const temperatures = [
      ...new Set(active.flatMap((interval) => (interval.tempF == null ? [] : [interval.tempF]))),
    ];
    const hasNull = active.some((interval) => interval.tempF == null);
    if (temperatures.length > 1 || (temperatures.length > 0 && hasNull)) {
      ambiguousSec += seconds;
      continue;
    }
    const tempF = temperatures[0];
    if (tempF == null) {
      unknownSec += seconds;
      continue;
    }
    knownSec += seconds;
    weightedTemperature += tempF * seconds;
    knownTemps.push(tempF);
    if (tempF >= envelopeLowF && tempF <= envelopeHighF) insideSec += seconds;
    else outsideSec += seconds;
  }

  evidence.ambientSampleCount = knownTemps.length;
  evidence.ambientKnownIdleSec = rounded(knownSec);
  evidence.ambientUnknownIdleSec = rounded(
    Math.max(totalIdleSec - knownSec - ambiguousSec, unknownSec),
  );
  evidence.ambientMinF = knownTemps.length > 0 ? roundedTemperature(Math.min(...knownTemps)) : null;
  evidence.ambientMaxF = knownTemps.length > 0 ? roundedTemperature(Math.max(...knownTemps)) : null;
  evidence.ambientAvgF = knownSec > 0 ? roundedTemperature(weightedTemperature / knownSec) : null;
  evidence.envelopeInsideSec = rounded(insideSec);
  evidence.envelopeOutsideSec = rounded(outsideSec);
  evidence.envelopeAmbiguousSec = rounded(ambiguousSec);

  if (input.profile !== "optimized_idle_documented_default") return evidence;
  if (ambiguousSec > 0) evidence.status = "ambiguous";
  else if (evidence.ambientUnknownIdleSec > 0 || knownSec <= 0) evidence.status = "insufficient";
  else if (insideSec > 0 && outsideSec > 0) evidence.status = "mixed_documented_default";
  else if (insideSec > 0) evidence.status = "inside_documented_default";
  else evidence.status = "outside_documented_default";
  return evidence;
}
