import { z } from "zod";

/**
 * A truck's idle equipment as DECLARED, its long-park behaviour as EVIDENCE, and the one rule that
 * compares them (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1, D-IE7).
 *
 * ── DECLARED AND EVIDENCE NEVER OVERWRITE EACH OTHER ────────────────────────────────────────────
 * `has_apu` / `apu_type` are what the owner ruled (migration 0403, `equipment_source =
 * 'owner_ruling_2026-10-01'`) or what the office entered (`manual`). Behaviour is read from
 * `vehicle_long_park_behaviour` (0403) and only ever raises a REVIEW: a truck ruled "no APU" that
 * shuts down on every long park may have one fitted — or may simply be parked, sold and waiting
 * (568, `- SOLD`, 0% idling / 60% off on 2026-10-02). A person decides which; this file never does.
 *
 * ── THE THRESHOLDS ARE CALIBRATED, NOT GUESSED ──────────────────────────────────────────────────
 * Measured on production 2026-10-02 against the trucks the ruling had just declared, long parks
 * (≥ 4 h) over 45 days, share of parks > 80% running / < 20% running:
 *   battery APU (57 trucks):  idling p10 0%, p50 0%,  p90 23%  ·  engine off p10 50%, p50 90%
 *   no APU      (121 trucks): idling p10 6%, p50 48%, p90 84%  ·  engine off p50 35%, p90 68%
 * "Behaves like a battery APU" is ≤ 10% idling AND ≥ 60% off — inside the battery cohort's body, out
 * of the no-APU cohort's. "Behaves like no APU" is ≥ 30% idling, which 9 in 10 battery trucks stay
 * under. Between them is `mixed`, which is NOT a disagreement: a driver who shuts down some nights and
 * not others is evidence of a driver, not of equipment. With these numbers the review list was 16
 * declared trucks (6 battery behaving like no APU, 10 the other way) plus 722, undeclared.
 */

/** The §1.6 long-park definition, passed to `vehicle_long_park_behaviour` (0403 has no defaults). */
export const LONG_PARK = {
  minParkSec: 4 * 3600,
  /** A park "mostly running": more than this share of it idling. */
  idlingShare: 0.8,
  /** A park "mostly off": less than this share of it idling. */
  offShare: 0.2,
  windowDays: 45,
  /** Fewer long parks than this in the window says nothing about equipment. */
  minParks: 10,
} as const;

export const BEHAVES_LIKE_THRESHOLDS = {
  batteryMaxIdlingPct: 10,
  batteryMinOffPct: 60,
  noApuMinIdlingPct: 30,
} as const;

export const BEHAVES_LIKE = ["battery_apu", "no_apu", "mixed", "not_enough_parks"] as const;
export type BehavesLike = (typeof BEHAVES_LIKE)[number];

export const DECLARED_EQUIPMENT = ["battery_apu", "no_apu", "other", "not_entered"] as const;
export type DeclaredEquipment = (typeof DECLARED_EQUIPMENT)[number];

export const EQUIPMENT_SOURCES = ["owner_ruling_2026-10-01", "manual"] as const;

export interface LongParkMeasure {
  parks: number;
  idlingParks: number;
  offParks: number;
}

/** Percent of long parks that were mostly running / mostly off; null when there were none. */
export function longParkShares(m: LongParkMeasure): { idlingPct: number | null; offPct: number | null } {
  if (m.parks <= 0) return { idlingPct: null, offPct: null };
  return {
    idlingPct: Math.round((100 * m.idlingParks) / m.parks),
    offPct: Math.round((100 * m.offParks) / m.parks),
  };
}

export function behavesLike(m: LongParkMeasure): BehavesLike {
  if (m.parks < LONG_PARK.minParks) return "not_enough_parks";
  const idling = (100 * m.idlingParks) / m.parks;
  const off = (100 * m.offParks) / m.parks;
  const t = BEHAVES_LIKE_THRESHOLDS;
  if (idling <= t.batteryMaxIdlingPct && off >= t.batteryMinOffPct) return "battery_apu";
  if (idling >= t.noApuMinIdlingPct) return "no_apu";
  return "mixed";
}

/** The declared equipment in the terms behaviour can be compared with. */
export function declaredEquipment(v: { hasApu: boolean | null; apuType: string | null }): DeclaredEquipment {
  if (v.apuType === "battery_hvac") return "battery_apu";
  if (v.apuType === "none") return "no_apu";
  if (v.apuType != null) return "other";
  if (v.hasApu === false) return "no_apu";
  if (v.hasApu === true) return "other";
  return "not_entered";
}

/**
 * Does this truck need a person to look at it? Only when the evidence is clear AND says the
 * opposite of the declaration — or says something definite about a truck nobody has declared.
 * `mixed` and `not_enough_parks` never raise one; `other` (fleet has none, R7) is not compared.
 */
export function needsEquipmentReview(declared: DeclaredEquipment, behaves: BehavesLike): boolean {
  if (behaves !== "battery_apu" && behaves !== "no_apu") return false;
  if (declared === "not_entered") return true;
  if (declared === "other") return false;
  return declared !== behaves;
}

/**
 * The purchase batch a truck belongs to (Q-IE7): make + model + model year + purchase MONTH. Derived
 * from the row every time, never stored, so a McLeod date correction moves the truck to its batch.
 * Null when any input is missing — an on-order unit has no batch yet.
 */
export function purchaseBatchKey(v: {
  make: string | null;
  model: string | null;
  year: number | null;
  purchasedAt: string | null;
}): string | null {
  if (!v.make || !v.model || v.year == null || !v.purchasedAt || !/^\d{4}-\d{2}/.test(v.purchasedAt)) return null;
  return `${v.make}|${v.model}|${v.year}|${v.purchasedAt.slice(0, 7)}`;
}

/** "Freightliner Cascadia 2021, bought 12/2020" — the batch in the page's words (D-FSV7 dates). */
export function purchaseBatchLabel(key: string | null): string | null {
  if (!key) return null;
  const [make, model, year, month] = key.split("|");
  const [y, m] = (month ?? "").split("-");
  return `${make} ${model} ${year}, bought ${m}/${y}`;
}

export const BEHAVES_LIKE_LABELS: Record<BehavesLike, string> = {
  battery_apu: "Behaves like battery APU",
  no_apu: "Behaves like no APU",
  mixed: "Mixed",
  not_enough_parks: "Not enough long parks",
};

/** A declaration in plain words — the burn-rate table's cohort names (IE4). */
export const DECLARED_EQUIPMENT_LABELS: Record<DeclaredEquipment, string> = {
  battery_apu: "Battery APU",
  no_apu: "No APU",
  other: "Other equipment",
  not_entered: "Not entered yet",
};

export const EQUIPMENT_SOURCE_LABELS: Record<(typeof EQUIPMENT_SOURCES)[number], string> = {
  "owner_ruling_2026-10-01": "Owner's ruling, 10/01/2026",
  manual: "Entered by the office",
};

/** One row of `GET /api/idle/equipment`. */
export const idleEquipmentRowSchema = z.object({
  vehicleId: z.string(),
  unitNumber: z.string(),
  batch: z.string().nullable(),
  hasApu: z.boolean().nullable(),
  apuType: z.string().nullable(),
  hasOptimizedIdle: z.boolean().nullable(),
  equipmentSource: z.string().nullable(),
  declared: z.enum(DECLARED_EQUIPMENT),
  parks: z.number().int(),
  idlingPct: z.number().nullable(),
  offPct: z.number().nullable(),
  behavesLike: z.enum(BEHAVES_LIKE),
  review: z.boolean(),
  /** The 0043 learned capability, kept until IE6 retires it; the page's fleet figure still reads it. */
  idleCapability: z.string().nullable(),
  idleOptimizedPct: z.number(),
});
export type IdleEquipmentRow = z.infer<typeof idleEquipmentRowSchema>;
