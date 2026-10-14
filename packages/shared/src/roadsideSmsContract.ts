import type { CalendarDay } from "./calendarDay.js";

/**
 * The CSA (SMS) points one roadside inspection carries, violation by violation — the Inspection page's
 * "points" column and its per-BASIC totals (INSPECTION-CHALLENGE-PLAN §6, IC3's calculator shown under
 * D-IC6).
 *
 * ── THE API COMPUTES, THIS FILE ONLY NAMES ─────────────────────────────────────────────────────
 * Every number here comes from `@silvicom/sms-engine`'s `scoreSms` and `basicPoints`, run by the API
 * (`modules/inspections/read/inspectionSms.ts`). Nothing in this file or in the web restates a rule: the
 * BASIC and exclusion keys below are the engine's own, and the API holds the two key sets equal at
 * compile time, so a reason the engine adds cannot reach the page unnamed.
 *
 * ── MEASURED TODAY, NOT AT FMCSA'S LAST SNAPSHOT ───────────────────────────────────────────────
 * `measuredOn` is today on the carrier's calendar. The time weight (3 / 2 / 1 by age) is the one the
 * next snapshot will use, which is the exposure a safety office is managing; FMCSA's published
 * snapshot is up to a month older and can differ by a bucket.
 *
 * ── A FIGURE ONLY WHERE THE CALCULATOR EQUALS FMCSA (D-IC6) ────────────────────────────────────
 * Points are given for a BASIC only when `smsImpactVerified` says the engine reproduces FMCSA there. In
 * an unverified BASIC (Hazardous Materials today) the violation says the points are withheld and why,
 * rather than showing a number FMCSA's own may be lower than.
 */

/** FMCSA's names for the six BASICs, keyed as the engine's `SMS_BASICS`. */
export const SMS_BASIC_NAMES = {
  unsafe_driving: "Unsafe Driving",
  hos_compliance: "Hours-of-Service Compliance",
  driver_fitness: "Driver Fitness",
  controlled_substances_alcohol: "Controlled Substances/Alcohol",
  vehicle_maintenance: "Vehicle Maintenance",
  hm_compliance: "Hazardous Materials Compliance",
} as const;
export type SmsBasicId = keyof typeof SMS_BASIC_NAMES;

/** Why a violation adds no points, keyed as the engine's `ExclusionReason` and worded for the office. */
export const SMS_EXCLUSION_TEXT = {
  outside_window: "Older than 24 months, so SMS no longer counts it.",
  not_loaded: "Not yet in FMCSA's system on the day measured.",
  not_in_appendix: "Not a violation SMS scores.",
  level_not_relevant: "SMS does not count this kind of violation on this level of inspection.",
  hm_not_placardable: "Hazmat violations count only when placarded hazmat was carried.",
  crash_related: "A moving violation on a post-crash inspection, which SMS leaves out.",
  dismissed: "The citation was dismissed in court.",
  counted_once: "Same code as another violation on this report, so it counts once.",
} as const;
export type SmsExclusionReason = keyof typeof SMS_EXCLUSION_TEXT;

/** The engine's time weight, said as the age that earns it (Methodology §3: 0–6, 6–12, 12–24 months). */
export const SMS_TIME_WEIGHT_TEXT: Readonly<Record<1 | 2 | 3, string>> = {
  3: "under 6 months old, so it counts three times",
  2: "6 to 12 months old, so it counts twice",
  1: "12 to 24 months old, so it counts once",
};

/**
 * Why a BASIC's points are withheld. Hazardous Materials has a measured cause (plan Q-IC9): FMCSA drops
 * the duties the HMR puts on the shipper by a flag its public data does not carry.
 */
export function smsPointsWithheldReason(basic: SmsBasicId): string {
  return basic === "hm_compliance"
    ? "Points not shown: FMCSA leaves out hazmat violations it charges to the shipper, and its public data does not say which, so our figure could be higher than FMCSA's."
    : "Points not shown: our calculation for this category does not yet match FMCSA's.";
}

export type RoadsideViolationSmsDto =
  /**
   * Counts, in a verified BASIC. `points` is (severity + OOS) × time weight for this violation alone,
   * before the inspection's 30-point cap — the cap is the BASIC total's (`RoadsideSmsBasicDto`).
   */
  | { status: "scored"; basic: SmsBasicId; severityWeight: number; oosWeight: number; timeWeight: 1 | 2 | 3; points: number }
  /** Counts, but in a BASIC whose figure is withheld (`smsPointsWithheldReason`). */
  | { status: "withheld"; basic: SmsBasicId }
  /** Adds nothing, for `reason`. `basic` is null when the code is not in Appendix A. */
  | { status: "excluded"; basic: SmsBasicId | null; reason: SmsExclusionReason };

/** One BASIC's total on this inspection: severity weights summed, capped at `cap`, times the time weight. */
export type RoadsideSmsBasicDto =
  | { basic: SmsBasicId; verified: true; severitySum: number; capped: number; points: number }
  | { basic: SmsBasicId; verified: false };

export interface RoadsideInspectionSmsDto {
  measuredOn: CalendarDay;
  /** The SMS Appendix A edition the weights come from (D-IC5). */
  appendixVersion: string;
  /** 3, 2 or 1 by the inspection's age; null when it no longer counts at all. */
  timeWeight: 1 | 2 | 3 | null;
  /** The per-inspection, per-BASIC severity cap (Methodology §3). */
  cap: number;
  /** Only the BASICs at least one violation counts in, in the engine's BASIC order. */
  basics: RoadsideSmsBasicDto[];
  /** Keyed by `RoadsideViolationDto.id`; every violation on the page has one. */
  violations: Record<string, RoadsideViolationSmsDto>;
}
