/**
 * Hazmat packaging vocabulary + the §171.8 capacity classifier (H-P1, extended by D-H14).
 *
 * Real BOLs state quantity as COUNT × PACKAGE TYPE plus a weight ("4 totes, 9,240 lb"), and the
 * regulatory question hiding inside that line — is this bulk or non-bulk packaging (§171.8)? — is a
 * property of the PACKAGE, not something a dispatcher should be asked to answer. The old form asked
 * the raw question ("Bulk / Non-bulk") and made the human translate; this module encodes the
 * translation so the answer is derived and the human states only what the paper says.
 *
 * §171.8 verbatim (eCFR, verified 2026-08-08 — D-H14 research): bulk packaging has
 *   (1) a maximum capacity greater than 450 L (119 gal) as a receptacle for a LIQUID;
 *   (2) a maximum net mass greater than 400 kg (882 lb) AND a maximum capacity greater than
 *       450 L (119 gal) as a receptacle for a SOLID (a TWO-part test — both must be exceeded); or
 *   (3) a water capacity greater than 454 kg (1,000 lb) as a receptacle for a GAS.
 * The METRIC figures govern (PHMSA 19-0045: 454 kg ≈ 1,001 lb, so a nominal 1,000-lb-WC cylinder —
 * the 420-lb propane exchange size — is NON-bulk). Classification rides on the capacity of the
 * packaging, never on its contents' weight or volume (PHMSA 10-0055).
 *
 * Two layers, deliberately:
 *   · TYPE DEFAULTS — each package type carries the §171.8 answer its ordinary sizes imply
 *     (a drum is non-bulk, a 275/330-gal tote is bulk). Zero-input path; right for the
 *     overwhelming majority of lines.
 *   · CAPACITY OVERRIDE (D-H14) — when a per-package capacity IS known, the classifier applies the
 *     actual three-test §171.8 logic and the measured answer beats the type default, both
 *     directions, with the reason attached. Where information is incomplete the tie goes TOWARD
 *     bulk (D2: over-placarding inconveniences; under-placarding is the failure the engine exists
 *     to prevent).
 *
 * "Pallet" is deliberately NOT a package type. A pallet is unitization; a pallet of 4 drums is 4
 * packages. The UI carries this as a hint rather than a selectable value so the count entered is
 * always the count of DOT packages.
 */

export type PackagingKind = "bulk" | "non_bulk";

// ── §171.8 thresholds — metric governs; imperial shown in copy ─────────────────────────────────
export const BULK_LIQUID_CAPACITY_L = 450; // > 450 L (119 gal) liquid capacity → bulk
export const BULK_SOLID_NET_MASS_KG = 400; // > 400 kg (882 lb) net mass AND > 450 L → bulk
export const BULK_GAS_WATER_CAPACITY_KG = 454; // > 454 kg (1,000 lb) water capacity → bulk

export const LB_PER_KG = 2.20462;
export const L_PER_GAL = 3.785411784;

export interface PackageTypeSpec {
  value: string;
  label: string;
  /** The §171.8 answer this package type's ordinary sizes imply (the zero-input default). */
  packagingKind: PackagingKind;
  /** The unit a line of this type most naturally states its net quantity in. */
  defaultUnit: "gal" | "lb" | "kg" | "L";
  hint?: string;
}

export const PACKAGE_TYPES: readonly PackageTypeSpec[] = [
  {
    value: "bulk_cargo",
    label: "Loose bulk (tank or hopper compartment)",
    packagingKind: "bulk",
    defaultUnit: "gal",
    hint: "The vehicle compartment is the packaging — cargo tank, hopper, pneumatic.",
  },
  {
    value: "ibc_tote",
    label: "IBC / tote",
    packagingKind: "bulk",
    defaultUnit: "gal",
    hint: "Standard 275/330-gal IBCs exceed 119 gal — bulk packaging even on a van (§171.8).",
  },
  {
    value: "portable_tank",
    label: "Portable tank / ISO tank",
    packagingKind: "bulk",
    defaultUnit: "gal",
  },
  {
    value: "asme_tank",
    label: "ASME tank / large gas receptacle (> 1,000 lb water cap.)",
    packagingKind: "bulk",
    defaultUnit: "gal",
    hint: "A charged 250/500/1,000-gal propane tank moved on a truck is BULK (§171.8(3)). Whether moving it charged is authorized at all is a separate §173.315 question — confirm before hauling.",
  },
  {
    value: "tube_trailer",
    label: "Tube trailer / MEGC",
    packagingKind: "bulk",
    defaultUnit: "lb",
    hint: "Each tube is a cylinder over 1,000 lb water capacity — bulk.",
  },
  {
    value: "drum",
    label: "Drum (≤ 119 gal)",
    packagingKind: "non_bulk",
    defaultUnit: "gal",
    hint: "A 55-gal drum is non-bulk. A pallet of drums is counted as its drums, not as pallets.",
  },
  { value: "pail", label: "Pail / jerrican", packagingKind: "non_bulk", defaultUnit: "gal" },
  {
    value: "cylinder",
    label: "Cylinder (≤ 1,000 lb water capacity)",
    packagingKind: "non_bulk",
    defaultUnit: "lb",
    hint: "Every consumer/exchange propane size — 1-lb through 420-lb — is non-bulk (PHMSA 19-0045). Over 1,000 lb water capacity is a bulk cylinder: use Tube trailer / ASME tank, or enter the capacity.",
  },
  { value: "box", label: "Box / case / carton", packagingKind: "non_bulk", defaultUnit: "lb" },
  { value: "bag", label: "Bag / sack", packagingKind: "non_bulk", defaultUnit: "lb" },
  {
    value: "other_non_bulk",
    label: "Other non-bulk package",
    packagingKind: "non_bulk",
    defaultUnit: "lb",
  },
  {
    value: "other_bulk",
    label: "Other bulk packaging (> 119 gal liquid · > 882 lb AND > 119 gal solid · > 1,000 lb water cap. gas)",
    packagingKind: "bulk",
    defaultUnit: "lb",
  },
];

export const PACKAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = PACKAGE_TYPES.map(
  (t) => ({ value: t.value, label: t.label }),
);

export function packageTypeSpec(value: string): PackageTypeSpec | null {
  return PACKAGE_TYPES.find((t) => t.value === value) ?? null;
}

/** The §171.8 TYPE-DEFAULT answer for a package type; null when the type is unset/unknown. */
export function packagingKindFor(value: string): PackagingKind | null {
  return packageTypeSpec(value)?.packagingKind ?? null;
}

/** Package types that describe the vehicle itself (no meaningful package count). */
export function isVehiclePackaging(value: string): boolean {
  return value === "bulk_cargo";
}

/**
 * A weight stated in lb or kg, as pounds — the unit every §172.504(c)/§172.301(a)(3) threshold is
 * evaluated in. Volume units return null: gallons of an unknown material have no honest weight, and
 * guessing a density is how a tool under-placards.
 */
export function weightToLb(value: number | null, unit: string): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (unit === "lb") return value;
  if (unit === "kg") return Math.round(value * LB_PER_KG * 100) / 100;
  return null;
}

// ── D-H14: the measured §171.8 classifier ──────────────────────────────────────────────────────

/** Which §171.8 test applies. Derived from the hazard class where possible; defaults to `liquid`,
 *  which is the CONSERVATIVE reading for an unknown phase (its single-part volume test flips to
 *  bulk where the solid two-part test might not — over-classifying, never under). */
export type PackagingPhase = "liquid" | "solid" | "gas";

/** Class 2 (2.1/2.2/2.3) → gas test; Class 4.1/4.2/4.3/5.1 and Class 8 solids can't be told from
 *  the class number alone, so everything else takes the liquid test (conservative, see above). */
export function phaseForHazardClass(hazardClass: string | null | undefined): PackagingPhase {
  const c = (hazardClass ?? "").trim();
  if (c === "2" || c.startsWith("2.")) return "gas";
  return "liquid";
}

export interface PackageCapacityInput {
  /** Receptacle volume in litres — the liquid-capacity figure, or the water-capacity VOLUME for a
   *  gas (1 L of water = 1 kg, so a volume-stated water capacity converts exactly). */
  volumeL?: number | null;
  /** Water capacity as a MASS in kg (gases — §171.8(3) states the threshold as 454 kg). */
  waterCapacityKg?: number | null;
  /** Maximum net mass per package in kg (solids — the second half of the two-part test). */
  netMassKg?: number | null;
}

export interface CapacityClassification {
  kind: PackagingKind;
  /** Plain-language reason, always citing the operative §171.8 figure. */
  because: string;
}

/**
 * The three §171.8 tests, exactly as written, metric-governed. Returns null when the provided
 * capacity information cannot answer the applicable test (caller falls back to the type default).
 * Incomplete-but-suggestive information fails TOWARD bulk with the reason saying so.
 */
export function classifyByCapacity(
  phase: PackagingPhase,
  cap: PackageCapacityInput,
): CapacityClassification | null {
  if (phase === "gas") {
    const waterKg = cap.waterCapacityKg ?? (cap.volumeL != null ? cap.volumeL : null); // 1 L water = 1 kg
    if (waterKg == null || !Number.isFinite(waterKg)) return null;
    return waterKg > BULK_GAS_WATER_CAPACITY_KG
      ? { kind: "bulk", because: `water capacity ${round(waterKg)} kg exceeds 454 kg (1,000 lb) — bulk gas receptacle (§171.8(3))` }
      : { kind: "non_bulk", because: `water capacity ${round(waterKg)} kg is at or under 454 kg (1,000 lb) — non-bulk (§171.8(3); PHMSA 19-0045)` };
  }
  if (phase === "solid") {
    const { volumeL, netMassKg } = cap;
    if (volumeL == null || !Number.isFinite(volumeL)) return null;
    if (volumeL <= BULK_LIQUID_CAPACITY_L) {
      // The two-part test can never pass with volume at/under 450 L, whatever the mass.
      return { kind: "non_bulk", because: `capacity ${round(volumeL)} L is at or under 450 L (119 gal) — the §171.8(2) two-part test cannot be met` };
    }
    if (netMassKg == null || !Number.isFinite(netMassKg)) {
      // Volume exceeds; mass unknown → the tie goes toward bulk (D2), and says so.
      return { kind: "bulk", because: `capacity ${round(volumeL)} L exceeds 450 L and the per-package net mass is unknown — classified bulk conservatively (§171.8(2))` };
    }
    return netMassKg > BULK_SOLID_NET_MASS_KG
      ? { kind: "bulk", because: `capacity ${round(volumeL)} L > 450 L AND net mass ${round(netMassKg)} kg > 400 kg (882 lb) — bulk solid packaging (§171.8(2))` }
      : { kind: "non_bulk", because: `net mass ${round(netMassKg)} kg is at or under 400 kg (882 lb) — non-bulk despite the volume (§171.8(2) requires BOTH)` };
  }
  // liquid (and the conservative default for unknown phases)
  const { volumeL } = cap;
  if (volumeL == null || !Number.isFinite(volumeL)) return null;
  return volumeL > BULK_LIQUID_CAPACITY_L
    ? { kind: "bulk", because: `capacity ${round(volumeL)} L exceeds 450 L (119 gal) — bulk (§171.8(1))` }
    : { kind: "non_bulk", because: `capacity ${round(volumeL)} L is at or under 450 L (119 gal) — non-bulk (§171.8(1))` };
}

export interface DerivedPackaging {
  kind: PackagingKind;
  /** Where the answer came from: the measured capacity, the type's default, or nothing. */
  source: "capacity" | "type" | "none";
  because: string | null;
  /** True when a measured capacity CONTRADICTED the type default — surface this to the user. */
  overrodeType: boolean;
}

/**
 * The one entry point the forms use: capacity (measured, §171.8) beats the type default, in both
 * directions, with the reason carried along. No capacity, no type → null kind is impossible here;
 * callers pass their own contextual fallback when both are absent (source: "none").
 */
export function derivePackaging(input: {
  packageType: string;
  phase: PackagingPhase;
  capacity?: PackageCapacityInput | null;
}): DerivedPackaging {
  const typeDefault = packagingKindFor(input.packageType);
  const measured = input.capacity ? classifyByCapacity(input.phase, input.capacity) : null;
  if (measured) {
    return {
      kind: measured.kind,
      source: "capacity",
      because: measured.because,
      overrodeType: typeDefault !== null && typeDefault !== measured.kind,
    };
  }
  if (typeDefault) {
    return { kind: typeDefault, source: "type", because: packageTypeSpec(input.packageType)?.hint ?? null, overrodeType: false };
  }
  return { kind: "bulk", source: "none", because: null, overrodeType: false };
}

/** Normalize a user-entered per-package capacity (value + unit) into the classifier's input.
 *  Units: gal/L are receptacle volume (for a gas: water-capacity volume); lb/kg are water capacity
 *  as mass (gases). Prefer lb/kg for gas receptacles — nominal "1,000 lb WC" containers sit under
 *  the metric line, while marketing-rounded gallon figures can sit just over it (safe direction). */
export function capacityFromForm(value: number | null, unit: string): PackageCapacityInput | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (unit === "gal") return { volumeL: value * L_PER_GAL };
  if (unit === "L") return { volumeL: value };
  if (unit === "lb") return { waterCapacityKg: value / LB_PER_KG };
  if (unit === "kg") return { waterCapacityKg: value };
  return null;
}

const round = (n: number): number => Math.round(n * 100) / 100;
