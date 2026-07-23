/**
 * Avoidable-idle algorithm (pure, testable) — the SEPARATE module that turns the engine-time foundation into a
 * defensible "how much of this idle was avoidable" verdict. It reads only STORED FACTS produced by the
 * foundation: per-period engine-time totals (from vehicle_engine_days), the period's classified park sessions
 * (from idle_park_sessions), and the truck's capability evidence — never Samsara directly.
 *
 * Principle: judge avoidability from EVIDENCE, never assumption.
 *  - Managed idle (apu_or_off / optimized_cycling park sessions) is the good behavior actually happening → never waste.
 *  - Continuous idle is avoidable ONLY when the truck had a real alternative: an admin-confirmed APU/Optimized-Idle
 *    flag, OR a capability the truck DEMONSTRABLY uses (learned apu / ecu_optimized). A truck with no such evidence
 *    is NOT blamed — its continuous idle is reported as "unavoidable (no idle-reduction capability)" and flagged so an
 *    admin can confirm the equipment. (A future refinement can split that bucket by weather; v1 stays assumption-free.)
 *  - When coverage is thin or capability is genuinely unknown, the period is marked not-confident and is EXCLUDED
 *    from scoring rather than guessed.
 */
import type { IdleMode, IdleCapability } from "./idleSessions.js";

/** Why (or why not) the truck had an alternative to main-engine idle — the basis of the avoidable verdict. */
export type IdleAlternative =
  | "apu" // admin-confirmed APU
  | "optimized_idle" // admin-confirmed OEM Optimized Idle
  | "learned_apu" // demonstrably rests engine-off on a meaningful share of parks
  | "learned_optimized" // demonstrably auto start/stop cycles
  | "none" // evidence says no alternative (admin says no APU, or continuous-only behavior)
  | "unknown"; // not enough evidence to judge

export interface AvoidableInput {
  /** Engine-time totals for the period, summed from vehicle_engine_days. */
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
  /** Wall-clock length of the period in seconds (e.g. days × 86400) — the denominator for coverage. */
  periodSec: number;
  /** The period's park sessions (from idle_park_sessions): each carries the idle seconds and its measured mode. */
  sessions: { idleSec: number; mode: IdleMode }[];
  /** Admin-confirmed equipment (source of truth). */
  hasApu: boolean | null;
  hasOptimizedIdle: boolean | null;
  /** Behavior learned from the truck's own park sessions (learnIdleCapability). */
  learnedCapability: IdleCapability;
}

export interface AvoidableOpts {
  /** Fraction (0–1) of the period that must be observed to trust/score it. Default 0.5. */
  minCoverage?: number;
}

export interface AvoidableResult {
  engineOnSec: number; // drive + idle
  driveSec: number;
  idleSec: number;
  offSec: number;
  /** Idle in apu_or_off / optimized_cycling park sessions — the good behavior. */
  managedIdleSec: number;
  /** Idle in continuous-mode park sessions — the candidate waste. */
  continuousIdleSec: number;
  /** Idle not inside any ≥30-min park session (normal short stops) — never avoidable. */
  shortIdleSec: number;
  /** Continuous idle on a truck that had an alternative → avoidable waste. */
  avoidableIdleSec: number;
  /** Continuous idle on a truck with no alternative evidence → reported, not blamed. */
  unavoidableIdleSec: number;
  hasAlternative: boolean;
  alternative: IdleAlternative;
  /** Observed fraction of the period (0–1). */
  coverage: number;
  /** True when coverage is sufficient AND avoidability is judgeable — only then should this feed scoring. */
  confident: boolean;
}

function resolveAlternative(i: AvoidableInput): { hasAlternative: boolean; alternative: IdleAlternative } {
  if (i.hasApu === true) return { hasAlternative: true, alternative: "apu" };
  if (i.hasOptimizedIdle === true) return { hasAlternative: true, alternative: "optimized_idle" };
  if (i.learnedCapability === "apu") return { hasAlternative: true, alternative: "learned_apu" };
  if (i.learnedCapability === "ecu_optimized") return { hasAlternative: true, alternative: "learned_optimized" };
  // No alternative: an explicit "no APU", or a truck that DEMONSTRABLY only idles continuously.
  if (i.hasApu === false || i.learnedCapability === "continuous_only") return { hasAlternative: false, alternative: "none" };
  return { hasAlternative: false, alternative: "unknown" }; // capability unknown + no admin flag → can't judge
}

/** Compute the avoidable-idle verdict for one truck over one period, from stored facts only. */
export function computeAvoidable(input: AvoidableInput, opts: AvoidableOpts = {}): AvoidableResult {
  const minCoverage = opts.minCoverage ?? 0.5;
  const engineOnSec = Math.max(0, input.driveSec) + Math.max(0, input.idleSec);

  let managedIdleSec = 0;
  let continuousIdleSec = 0;
  for (const s of input.sessions) {
    if (s.mode === "continuous") continuousIdleSec += s.idleSec;
    else managedIdleSec += s.idleSec; // apu_or_off | optimized_cycling
  }
  // Idle the ≥30-min park sessions didn't cover (short stops) — never counted as waste.
  const shortIdleSec = Math.max(0, input.idleSec - (managedIdleSec + continuousIdleSec));

  const { hasAlternative, alternative } = resolveAlternative(input);
  const avoidableIdleSec = hasAlternative ? continuousIdleSec : 0;
  const unavoidableIdleSec = hasAlternative ? 0 : continuousIdleSec;

  const coverage = input.periodSec > 0 ? Math.min(1, input.coverageSec / input.periodSec) : 0;
  // Judgeable = we can say whether continuous idle was avoidable (an alternative exists, or we've established none).
  const canJudge = alternative !== "unknown";
  const confident = coverage >= minCoverage && canJudge;

  return {
    engineOnSec,
    driveSec: input.driveSec,
    idleSec: input.idleSec,
    offSec: input.offSec,
    managedIdleSec: Math.round(managedIdleSec),
    continuousIdleSec: Math.round(continuousIdleSec),
    shortIdleSec: Math.round(shortIdleSec),
    avoidableIdleSec: Math.round(avoidableIdleSec),
    unavoidableIdleSec: Math.round(unavoidableIdleSec),
    hasAlternative,
    alternative,
    coverage: Math.round(coverage * 1000) / 1000,
    confident,
  };
}

export interface AvoidableCost {
  gallons: number;
  usd: number;
}

/** Fuel + $ wasted by the avoidable idle. Burn/price default to the Class-8 main-engine idle assumptions. */
export function avoidableCost(
  avoidableIdleSec: number,
  opts: { idleGalPerHour?: number; fuelPricePerGal?: number } = {},
): AvoidableCost {
  const galPerHour = opts.idleGalPerHour ?? 0.8;
  const price = opts.fuelPricePerGal ?? 4.0;
  const gallons = (Math.max(0, avoidableIdleSec) / 3600) * galPerHour;
  return { gallons: Math.round(gallons * 100) / 100, usd: Math.round(gallons * price * 100) / 100 };
}

/**
 * Idle score (0–100, higher = better): the share of RUNNING time (engine-on = drive + idle) that was avoidable
 * idle, inverted. A real denominator — a truck that ran 100 h and wasted 5 h scores far better than one that ran
 * 10 h and wasted 5 h. Returns null when there's no engine-on time (no basis to score).
 */
export function idleScore(avoidableIdleSec: number, engineOnSec: number): number | null {
  if (engineOnSec <= 0) return null;
  const share = Math.max(0, avoidableIdleSec) / engineOnSec;
  return Math.max(0, Math.min(100, Math.round(100 - share * 100)));
}
