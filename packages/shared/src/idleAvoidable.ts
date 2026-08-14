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
 *  - Both evidence overlays (HOS duty, and the Optimized-Idle temperature envelope) are read PER SECOND, never as
 *    an all-or-nothing status flag: seconds an overlay proves are judged, seconds it misses or contradicts are
 *    uncertain and excluded. Partial evidence can only SHRINK the avoidable verdict, never inflate it.
 */
import { DEFAULT_FUEL_PRICE_PER_GAL } from "./fuelPriceDays.js";
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
  /**
   * Continuous idle seconds directly overlapping a REST HOS interval (sleeper berth / off duty) — the
   * hotel-load idle an idle-reduction alternative is bought to carry. Drives `reducibleIdleSec`.
   */
  restSec?: number;
  /** Continuous idle seconds directly overlapping an on-duty HOS interval. */
  workSec: number;
  /** Candidate seconds without a usable HOS interval. */
  unknownSec: number;
  /** Candidate seconds with conflicting HOS intervals. */
  ambiguousSec: number;
  /**
   * Direct on-duty idle seconds covered by the operational grace period, ALREADY BOUNDED PER PARK by the
   * producer (see ON_DUTY_GRACE_SEC). Aggregating a range sums one allowance per on-duty park, so this is a
   * total across parks and must NOT be re-capped at a single park's allowance here.
   */
  graceSec: number;
}

/**
 * Operational grace per on-duty park — pre-trip, paperwork, a short load — never counted as avoidable.
 * Per PARK, not per period: a truck that made nine on-duty stops in a month is owed nine allowances.
 * Deliberately separate from the pure engine warm-up, which OEMs put at only 3–5 minutes.
 */
export const ON_DUTY_GRACE_SEC = 15 * 60;

export interface AvoidableOpts {
  /** Fraction (0–1) of the period that must be observed to trust/score it. Default 0.5. */
  minCoverage?: number;
  /**
   * Fraction (0–1) of continuous idle that must carry direct duty evidence for the truck to be scored
   * as confident. Default 0.8. The unevidenced remainder is ALWAYS excluded from the avoidable verdict
   * regardless of this threshold — it only gates whether the truck counts as "confident" at all.
   */
  minDutyEvidencedShare?: number;
  /**
   * Fraction (0–1) of an Optimized-Idle truck's continuous idle that must carry direct temperature
   * evidence (inside or outside the envelope) for the truck to be scored as confident. Default 0.8.
   * Exactly the duty rule applied to the envelope: unevidenced seconds are always excluded as uncertain,
   * and this threshold only decides whether the truck counts as confident at all.
   */
  minEnvelopeEvidencedShare?: number;
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
  /**
   * Rest-period main-engine idle an idle-reduction alternative WOULD have carried — computed for every
   * truck, whether or not one is fitted. This is the OPPORTUNITY measure and it deliberately answers a
   * different question from `avoidableIdleSec`:
   *
   *   avoidable  = "this truck HAD an alternative and burned fuel anyway"  → coaching, blame, $ wasted
   *   reducible  = "this much rest idle an APU/optimized idle could carry" → capex case, fleet ROI
   *
   * On an equipped truck the two converge. On the 117 trucks with no equipment (or none recorded) the
   * avoidable verdict is a correct zero — there was nothing to use — while reducible is the number that
   * says what fitting equipment would be worth. Reporting only the first is what made a fleet with
   * 25,470 h of continuous idle render as ~$3k across 32 trucks (audit 2026-08-13).
   *
   * Same evidence discipline as avoidable: only duty-EVIDENCED rest seconds count, the operational grace
   * is removed, and unevidenced seconds are excluded rather than assumed. Null when no duty overlay is
   * available at all — never a fabricated zero.
   */
  reducibleIdleSec: number | null;
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
  // No admin flag + equipment unconfirmed → can't judge; excluded from scoring rather than blamed. Every
  // LEARNED pattern lands here, in both directions, and that symmetry is deliberate (audit 2026-08-13).
  //
  // A learned "apu"/"ecu_optimized" never GRANTS an alternative: a diesel APU is invisible to telematics.
  // A learned "continuous_only" used to DENY one — it returned alternative "none", which reported the
  // truck as confidently unavoidable. That was the same inference run backwards, and it was the worse of
  // the two: a truck whose driver never uses its APU looks EXACTLY like a truck that has none, so the
  // heaviest idlers were being auto-excused and dropped out of the equipment queue (25 trucks holding
  // 6,785 h of continuous idle). Only an admin record can say a truck has no alternative; behaviour
  // cannot. Unconfirmed trucks are still reported — `reducibleIdleSec` gives them a number — and they
  // now correctly show as "needs equipment" rather than as a settled zero.
  return { hasAlternative: false, alternative: "unknown" };
}

/** Compute the avoidable-idle verdict for one truck over one period, from stored facts only. */
export function computeAvoidable(input: AvoidableInput, opts: AvoidableOpts = {}): AvoidableResult {
  const minCoverage = opts.minCoverage ?? 0.5;
  const minDutyEvidencedShare = Math.min(1, Math.max(0, opts.minDutyEvidencedShare ?? 0.8));
  const minEnvelopeEvidencedShare = Math.min(
    1,
    Math.max(0, opts.minEnvelopeEvidencedShare ?? 0.8),
  );
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
  let envelopeCanJudge = true;
  if (
    hasAlternative &&
    alternative === "optimized_idle" &&
    input.optimizedEnvelope != null &&
    continuousIdleSec > 0
  ) {
    // SECONDS-WEIGHTED envelope evidence (audit 2026-08-13) — the same correction the duty overlay got on
    // 2026-08-12, applied to the temperature overlay. The previous rule was binary: unless the AGGREGATE
    // status was "sufficient", every continuous second was re-bucketed as uncertain and the truck was
    // excluded. A session is only "sufficient" when 100% of its idle seconds carry a temperature, the day
    // takes the WORST status of its sessions and the range the worst of its days, so one thin session in a
    // month zeroed the whole truck. In production that wiped out EVERY Optimized-Idle truck: ambient
    // coverage was 93.1% fleet-wide, but only 49% of sessions were gap-free, and all 33 trucks with
    // sessions had at least one gap (unit 773: 274 h of idle zeroed by 0.8 h — 0.3% — of missing
    // temperature).
    //
    // The principle is unchanged — judge from evidence, never assumption — but per second: seconds proven
    // INSIDE the band are avoidable, seconds proven OUTSIDE it are justified, and every second whose
    // temperature is missing or conflicting is uncertain and excluded. Partial evidence can therefore only
    // SHRINK the avoidable verdict, never inflate it. The status now decides nothing; the seconds do.
    const insideSec = Math.min(continuousIdleSec, Math.max(0, input.optimizedEnvelope.insideSec));
    const outsideSec = Math.min(
      continuousIdleSec - insideSec,
      Math.max(0, input.optimizedEnvelope.outsideSec),
    );
    // Everything the temperature overlay did not directly place inside or outside the band: its own
    // unknown/ambiguous seconds AND any continuous second the overlay never reached at all.
    const evidencedSec = insideSec + outsideSec;
    avoidableIdleSec = insideSec;
    justifiedIdleSec = outsideSec;
    uncertainIdleSec = continuousIdleSec - evidencedSec;
    unavoidableIdleSec = 0;
    envelopeCanJudge = evidencedSec / continuousIdleSec >= minEnvelopeEvidencedShare;
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
    // Duty-unevidenced seconds displace seconds we could otherwise BLAME — never the justified ones the
    // temperature overlay already proved were outside the equipment's band. Capping the combined uncertainty
    // at `continuous - justified` (not at `continuous`) is what keeps the buckets summing to continuous: with
    // the envelope now contributing real justified seconds instead of an all-or-nothing uncertain block, a
    // plain cap at `continuous` let justified + uncertain overrun it (unit 698: 380,280s of buckets against
    // 337,711s of continuous idle, caught by invariant 3 on 2026-08-13).
    uncertainIdleSec = Math.min(
      Math.max(0, continuousIdleSec - justifiedIdleSec),
      uncertainIdleSec + dutyUncertainSec,
    );
    // Grace is taken as the producer reported it: one ON_DUTY_GRACE_SEC allowance per on-duty park, summed
    // over the period. It used to be re-capped here at a SINGLE park's allowance, which meant a truck got
    // 15 minutes of operational grace for an entire month no matter how many on-duty stops it made — every
    // truck in the 31-day precision report showed exactly 900s of grace (audit 2026-08-13). Grace still can
    // only occupy seconds not already consumed by justified/uncertain (the envelope path may have marked ALL
    // continuous seconds uncertain before this block); without that cap the bucket sum exceeded continuous
    // by up to the grace — the "900-second algebra overage" the precision harness caught (2026-08-12).
    operationalGraceIdleSec = Math.min(
      evidencedSec,
      Math.max(0, duty.graceSec),
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

  // REDUCIBLE — the opportunity measure, computed independently of the equipment flags (see the field
  // doc). It is the truck's duty-EVIDENCED rest idle, less the seconds already accounted for elsewhere:
  // the justified ones (temperature outside the equipment's capable band — no alternative would have held
  // those either) and the operational grace. Rest idle is capped at the evidenced continuous idle so a
  // partial duty overlay can only shrink it, exactly as it does for avoidable.
  const reducibleIdleSec =
    input.dutyEvidence?.restSec == null
      ? null
      : Math.max(
          0,
          Math.min(
            Math.max(0, input.dutyEvidence.restSec),
            continuousIdleSec - uncertainIdleSec,
          ) -
            justifiedIdleSec -
            operationalGraceIdleSec,
        );

  const coverage = input.periodSec > 0 ? Math.min(1, input.coverageSec / input.periodSec) : 0;
  // Judgeable = we can say whether continuous idle was avoidable (an alternative exists, or we've established none).
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
    reducibleIdleSec: reducibleIdleSec == null ? null : Math.round(reducibleIdleSec),
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
  const price = opts.fuelPricePerGal ?? DEFAULT_FUEL_PRICE_PER_GAL;
  const gallons = (Math.max(0, avoidableIdleSec) / 3600) * galPerHour;
  // Round the DOLLARS from unrounded gallons. Rounding gallons first and pricing the rounded figure
  // discards up to half a cent per row before the price is even applied (audit 2026-08-13).
  return { gallons: Math.round(gallons * 100) / 100, usd: Math.round(gallons * price * 100) / 100 };
}

/** One day's contribution to a truck's avoidable idle, ready to be priced at that day's rate. */
export interface AvoidableDaySeconds {
  day: string;
  avoidableIdleSec: number;
  reducibleIdleSec: number;
}

export interface DatedAvoidableCost extends AvoidableCost {
  /** Effective $/gal actually charged, i.e. the day-priced cost divided by the gallons. */
  blendedPricePerGal: number | null;
  /** Days whose price came from `priceByDay`, and days that fell back to the flat rate. */
  pricedDays: number;
  unpricedDays: number;
}

/**
 * Cost the avoidable idle DAY BY DAY, each day at the diesel price that day actually cost.
 *
 * A range is not one price. Over a single measured month this fleet's gallon-weighted price ran
 * $4.223–$5.123 — a 21% spread — so charging a whole range at one rate mis-prices nearly every day in it
 * even when the average happens to be close. It was not close: the flat posted median was 6.2% above what
 * the fleet actually paid.
 *
 * The seconds come per day from the rollup, so this is a real per-day computation, not a range total
 * sliced up afterwards. A day with no price row falls back to `fuelPricePerGal` and is counted in
 * `unpricedDays` rather than silently dropped or zero-priced.
 */
export function avoidableCostByDay(
  days: readonly AvoidableDaySeconds[],
  priceByDay: ReadonlyMap<string, number>,
  opts: { idleGalPerHour?: number; fuelPricePerGal?: number } = {},
): { avoidable: DatedAvoidableCost; reducible: DatedAvoidableCost } {
  const galPerHour = opts.idleGalPerHour ?? 0.8;
  const fallbackPrice = opts.fuelPricePerGal ?? DEFAULT_FUEL_PRICE_PER_GAL;

  let avoidableGal = 0;
  let avoidableUsd = 0;
  let reducibleGal = 0;
  let reducibleUsd = 0;
  let priced = 0;
  let unpriced = 0;

  for (const day of days) {
    const dayPrice = priceByDay.get(day.day);
    const price = dayPrice != null && Number.isFinite(dayPrice) && dayPrice > 0 ? dayPrice : fallbackPrice;
    const contributes = day.avoidableIdleSec > 0 || day.reducibleIdleSec > 0;
    if (contributes) {
      if (dayPrice != null && dayPrice > 0) priced += 1;
      else unpriced += 1;
    }
    const aGal = (Math.max(0, day.avoidableIdleSec) / 3600) * galPerHour;
    const rGal = (Math.max(0, day.reducibleIdleSec) / 3600) * galPerHour;
    avoidableGal += aGal;
    avoidableUsd += aGal * price;
    reducibleGal += rGal;
    reducibleUsd += rGal * price;
  }

  const shape = (gallons: number, usd: number): DatedAvoidableCost => ({
    gallons: Math.round(gallons * 100) / 100,
    usd: Math.round(usd * 100) / 100,
    blendedPricePerGal: gallons > 0 ? Math.round((usd / gallons) * 10_000) / 10_000 : null,
    pricedDays: priced,
    unpricedDays: unpriced,
  });
  return { avoidable: shape(avoidableGal, avoidableUsd), reducible: shape(reducibleGal, reducibleUsd) };
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
