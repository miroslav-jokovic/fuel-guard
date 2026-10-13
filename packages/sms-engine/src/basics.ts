/**
 * The six BASICs a roadside violation can count in, and which inspections are RELEVANT to each
 * (SMS Methodology v3.21 §3, `docs/regulatory/fmcsa/SMSMethodology.pdf`).
 *
 * A violation counts only on an inspection relevant to its BASIC. Measured against FMCSA's own
 * 2026-08-28 snapshot (`tests/parity.test.ts`): ten of our violations sit on inspections of the wrong
 * level and FMCSA scored none of them — vehicle-maintenance violations written on Level 3
 * (driver-only) inspections are the common case.
 */
export const SMS_BASICS = [
  "unsafe_driving",
  "hos_compliance",
  "driver_fitness",
  "controlled_substances_alcohol",
  "vehicle_maintenance",
  "hm_compliance",
] as const;
export type SmsBasic = (typeof SMS_BASICS)[number];

/** Driver Inspection: Levels 1, 2, 3, 6. Vehicle Inspection: Levels 1, 2, 5, 6 (Methodology §3.2–3.6). */
const DRIVER_LEVELS: ReadonlySet<number> = new Set([1, 2, 3, 6]);
const VEHICLE_LEVELS: ReadonlySet<number> = new Set([1, 2, 5, 6]);

export interface BasicRules {
  /** Inspection levels relevant to the BASIC; null = any inspection (Unsafe Driving is measured per power unit). */
  levels: ReadonlySet<number> | null;
  /** Only inspections where placardable HM was carried count (HM Compliance, §3.7). */
  placardOnly: boolean;
  /** The +2 out-of-service weight applies (§3: not for Unsafe Driving, not for Controlled Substances/Alcohol). */
  oosWeight: boolean;
}

export const BASIC_RULES: Record<SmsBasic, BasicRules> = {
  unsafe_driving: { levels: null, placardOnly: false, oosWeight: false, crashRelated: true },
  hos_compliance: { levels: DRIVER_LEVELS, placardOnly: false, oosWeight: true, crashRelated: false },
  driver_fitness: { levels: DRIVER_LEVELS, placardOnly: false, oosWeight: true, crashRelated: false },
  controlled_substances_alcohol: { levels: DRIVER_LEVELS, placardOnly: false, oosWeight: false, crashRelated: false },
  vehicle_maintenance: { levels: VEHICLE_LEVELS, placardOnly: false, oosWeight: true, crashRelated: false },
  hm_compliance: { levels: VEHICLE_LEVELS, placardOnly: true, oosWeight: true, crashRelated: false },
};

/** The sum of one inspection's severity weights in one BASIC is capped here, before time weighting. */
export const INSPECTION_BASIC_CAP = 30;
/** Added to a violation's severity weight when it put the driver or vehicle out of service. */
export const OOS_WEIGHT = 2;
