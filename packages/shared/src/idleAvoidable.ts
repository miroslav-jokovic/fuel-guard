/**
 * Avoidable-idle algorithm (pure, testable) — the SEPARATE module that turns the engine-time foundation into a
 * defensible "how much of this idle was avoidable" verdict. It reads only STORED FACTS produced by the
 * foundation: per-period engine-time totals (from vehicle_engine_days), the period's classified park sessions
 * (from idle_park_sessions), and the truck's capability evidence — never Samsara directly.
 *
 * Principle: judge avoidability from EVIDENCE, never assumption.
 *  - Managed idle (apu_or_off / optimized_cycling park sessions) is the good behavior actually happening → never waste.
 *  - Continuous idle is avoidable ONLY when the truck had a real alternative, and that is established SOLELY by
 *    an admin-confirmed APU / Optimized-Idle flag on the vehicle. Telematics cannot prove a diesel APU (engine-off
 *    at rest is indistinguishable from a plain overnight shutdown), so the LEARNED capability is display/cross-check
 *    only and never makes idle avoidable. A truck with no confirmed equipment is NOT blamed — its continuous idle is
 *    reported as "unavoidable / unconfirmed" and flagged so an admin can set the equipment on the Vehicles page.
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
  /** Complete temperature evidence for Optimized Idle continuous sessions, when available. */
  optimizedEnvelope?: OptimizedEnvelopeEvidence;
  /** Direct HOS overlap evidence for the continuous idle candidate, when available. */
  dutyEvidence?: IdleDutyEvidence;
}

export type OptimizedEnvelopeEvidenceStatus =
  "sufficient" | "insufficient" | "ambiguous" | "unavailable";

export type OptimizedEnvelopeEvidenceSource = "documented_default" | "learned_behavioral" | "none";

export interface OptimizedEnvelopeEvidence {
  status: OptimizedEnvelopeEvidenceStatus;
  source: OptimizedEnvelopeEvidenceSource;
  insideSec: number;
  outsideSec: number;
  unknownSec: number;
  ambiguousSec: number;
}

export type IdleDutyEvidenceStatus = "sufficient" | "insufficient" | "ambiguous" | "unavailable";

export interface IdleDutyEvidence {
  status: IdleDutyEvidenceStatus;
  /** Continuous idle seconds directly overlapping an on-duty HOS interval. */
  workSec: number;
  /** Candidate seconds without a usable HOS interval. */
  unknownSec: number;
  /** Candidate seconds with conflicting HOS intervals. */
  ambiguousSec: number;
  /** Direct on-duty idle seconds covered by the operational grace period. */
  graceSec: number;
}

export interface AvoidableOpts {
  /** Fraction (0–1) of the period that must be observed to trust/score it. Default 0.5. */
  minCoverage?: number;
  /** On-duty operational grace before work idle becomes avoidable. Default 15 minutes. */
  onDutyGraceSec?: number;
  /**
   * Fraction (0–1) of continuous idle that must carry direct duty evidence for the truck to be scored
   * as confident. Default 0.8. The unevidenced remainder is ALWAYS excluded from the avoidable verdict
   * regardless of this threshold — it only gates whether the truck counts as "confident" at all.
   */
  minDutyEvidencedShare?: number;
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
  /** Optimized-Idle continuous time outside the active temperature envelope. */
  justifiedIdleSec: number;
  /** Continuous time whose temperature evidence is missing or conflicting. */
  uncertainIdleSec: number;
  /** Direct on-duty continuous idle covered by the operational grace period. */
  operationalGraceIdleSec: number;
  hasAlternative: boolean;
  alternative: IdleAlternative;
  /** Observed fraction of the period (0–1). */
  coverage: number;
  /** True when coverage is sufficient AND avoidability is judgeable — only then should this feed scoring. */
  confident: boolean;
}

function resolveAlternative(i: AvoidableInput): {
  hasAlternative: boolean;
  alternative: IdleAlternative;
} {
  // Did the truck HAVE an alternative to main-engine idle? The CURATED Vehicles equipment flags
  // (has_apu / has_optimized_idle) are the SOLE source of truth — an admin record of what the truck is
  // actually fitted with, not a guess.
  //
  // The learned engine on/off pattern is deliberately NOT used to grant an alternative here. A diesel APU
  // is invisible to telematics: a truck that sat Off through a long park is indistinguishable from one that
  // simply shut down for the night with no APU at all (the same principle System A documents as audit A1.2).
  // Inferring "apu" from engine-off time is exactly what marked the whole fleet APU-capable and made almost
  // all continuous idle look avoidable. So learned "apu"/"ecu_optimized" now inform the DISPLAY only
  // (idle_capability badge, cross-check) — never the avoidable verdict.
  //
  // A truck that HAS the equipment (admin flag) but idled continuously still counts as having an
  // alternative → that continuous idle is avoidable (it should have used the APU / optimized idle).
  if (i.hasApu === true) return { hasAlternative: true, alternative: "apu" };
  if (i.hasOptimizedIdle === true) return { hasAlternative: true, alternative: "optimized_idle" };
  // Admin explicitly recorded NO engine-off equipment → continuous idle is unavoidable, not the driver's
  // waste. This is a definitive record and WINS over any learned pattern.
  if (i.hasApu === false) return { hasAlternative: false, alternative: "none" };
  // No admin flag, but the truck DEMONSTRABLY only ever idles continuously → safe to state it had no
  // alternative (it never rests off / cycles), so its idle is unavoidable rather than "unknown".
  if (i.learnedCapability === "continuous_only")
    return { hasAlternative: false, alternative: "none" };
  // No admin flag + equipment unconfirmed → can't judge; excluded from scoring rather than blamed. This is
  // where a learned "apu"/"ecu_optimized" lands now: reported, never counted as avoidable waste.
  return { hasAlternative: false, alternative: "unknown" };
}

/** Compute the avoidable-idle verdict for one truck over one period, from stored facts only. */
export function computeAvoidable(input: AvoidableInput, opts: AvoidableOpts = {}): AvoidableResult {
  const minCoverage = opts.minCoverage ?? 0.5;
  const onDutyGraceSec = Math.max(0, opts.onDutyGraceSec ?? 15 * 60);
  const minDutyEvidencedShare = Math.min(1, Math.max(0, opts.minDutyEvidencedShare ?? 0.8));
  const engineOnSec = Math.max(0, input.driveSec) + Math.max(0, input.idleSec);

  let managedIdleSec = 0;
  let continuousIdleSec = 0;
  for (const s of input.sessions) {
    if (s.mode === "continuous") continuousIdleSec += s.idleSec;
    else managedIdleSec += s.idleSec; // apu_or_off | optimized_cycling
  }
  // Park sessions (idle_park_sessions) and the day totals (vehicle_engine_days) are synced independently, so
  // classified idle can drift ABOVE the observed idle for the period. Never allow that: scale the session
  // split down to fit the day-total idle, so managed+continuous ≤ idle and therefore
  // avoidable ≤ continuous ≤ idle ≤ engine-on ALWAYS holds (no more "30 h avoidable of a 22 h engine-on truck").
  const observedIdle = Math.max(0, input.idleSec);
  const classifiedIdle = managedIdleSec + continuousIdleSec;
  if (classifiedIdle > observedIdle && classifiedIdle > 0) {
    const scale = observedIdle / classifiedIdle;
    managedIdleSec *= scale;
    continuousIdleSec *= scale;
  }
  // Idle the ≥30-min park sessions didn't cover (short stops) — never counted as waste.
  const shortIdleSec = Math.max(0, observedIdle - (managedIdleSec + continuousIdleSec));

  const { hasAlternative, alternative } = resolveAlternative(input);
  let avoidableIdleSec = hasAlternative ? continuousIdleSec : 0;
  let unavoidableIdleSec = hasAlternative ? 0 : continuousIdleSec;
  let justifiedIdleSec = 0;
  let uncertainIdleSec = 0;
  let operationalGraceIdleSec = 0;
  if (hasAlternative && alternative === "optimized_idle" && input.optimizedEnvelope != null) {
    if (input.optimizedEnvelope.status === "sufficient") {
      const insideSec = Math.min(continuousIdleSec, Math.max(0, input.optimizedEnvelope.insideSec));
      const outsideSec = Math.min(
        continuousIdleSec - insideSec,
        Math.max(0, input.optimizedEnvelope.outsideSec),
      );
      const uncertainFromEvidence = Math.min(
        continuousIdleSec - insideSec - outsideSec,
        Math.max(0, input.optimizedEnvelope.unknownSec) +
          Math.max(0, input.optimizedEnvelope.ambiguousSec),
      );
      avoidableIdleSec = insideSec;
      justifiedIdleSec = outsideSec;
      uncertainIdleSec = uncertainFromEvidence;
    } else {
      avoidableIdleSec = 0;
      uncertainIdleSec = continuousIdleSec;
    }
    unavoidableIdleSec = Math.max(
      0,
      continuousIdleSec - avoidableIdleSec - justifiedIdleSec - uncertainIdleSec,
    );
  }

  let dutyCanJudge = true;
  if (input.dutyEvidence != null && continuousIdleSec > 0) {
    const duty = input.dutyEvidence;
    // SECONDS-WEIGHTED duty evidence (audit 2026-08-12). The previous rule was binary: any period whose
    // duty status was not "sufficient" had ALL of its continuous idle re-bucketed as uncertain and was
    // excluded from scoring. Aggregated over a range where the status is the WORST of the days (and a
    // day the worst of its sessions, and a session "sufficient" only at 100% coverage with zero unknown
    // seconds), that compounds into all-or-nothing: in production, 154 of 169 well-covered trucks were
    // excluded for ONE imperfect day — most were duty-clean 29-30 days of 31 ("$38 across 5/177 trucks").
    //
    // The principle stays "judge from evidence, never assumption" — applied per second instead of per
    // period: seconds WITHOUT a usable duty overlay (unknown) or with a CONFLICTING one (ambiguous) are
    // excluded as uncertain, exactly as before; the evidenced remainder is judged normally. Partial
    // evidence can therefore only SHRINK the avoidable verdict, never inflate it. Confidence follows the
    // same logic: the truck is scoreable when at least MIN_DUTY_EVIDENCED_SHARE of its continuous idle
    // carries direct duty evidence — not only when every second of every day does.
    const dutyUncertainSec = Math.min(
      continuousIdleSec,
      Math.max(0, duty.unknownSec) + Math.max(0, duty.ambiguousSec),
    );
    const evidencedSec = continuousIdleSec - dutyUncertainSec;
    uncertainIdleSec = Math.min(continuousIdleSec, uncertainIdleSec + dutyUncertainSec);
    // Grace can only occupy seconds not already consumed by justified/uncertain (the envelope path may
    // have marked ALL continuous seconds uncertain before this block). Without this cap the bucket sum
    // exceeded continuous by up to the 15-minute grace on optimized-idle trucks with insufficient
    // temperature evidence — the "900-second algebra overage" the precision harness caught (2026-08-12).
    operationalGraceIdleSec = Math.min(
      evidencedSec,
      Math.min(Math.max(0, duty.graceSec), onDutyGraceSec),
      Math.max(0, continuousIdleSec - justifiedIdleSec - uncertainIdleSec),
    );
    avoidableIdleSec = Math.max(
      0,
      Math.min(
        avoidableIdleSec - operationalGraceIdleSec,
        continuousIdleSec - justifiedIdleSec - uncertainIdleSec - operationalGraceIdleSec,
      ),
    );
    unavoidableIdleSec = Math.max(
      0,
      continuousIdleSec -
        avoidableIdleSec -
        justifiedIdleSec -
        uncertainIdleSec -
        operationalGraceIdleSec,
    );
    dutyCanJudge = evidencedSec / continuousIdleSec >= minDutyEvidencedShare;
  }

  const coverage = input.periodSec > 0 ? Math.min(1, input.coverageSec / input.periodSec) : 0;
  // Judgeable = we can say whether continuous idle was avoidable (an alternative exists, or we've established none).
  const envelopeCanJudge =
    alternative !== "optimized_idle" ||
    continuousIdleSec <= 0 ||
    input.optimizedEnvelope == null ||
    input.optimizedEnvelope.status === "sufficient";
  const canJudge = alternative !== "unknown" && envelopeCanJudge;
  const confident = coverage >= minCoverage && canJudge && dutyCanJudge;

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
    justifiedIdleSec: Math.round(justifiedIdleSec),
    uncertainIdleSec: Math.round(uncertainIdleSec),
    operationalGraceIdleSec: Math.round(operationalGraceIdleSec),
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
