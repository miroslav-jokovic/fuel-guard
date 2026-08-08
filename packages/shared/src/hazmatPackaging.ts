/**
 * Hazmat packaging vocabulary (plan H-P1 — the packaging model).
 *
 * Real BOLs state quantity as COUNT × PACKAGE TYPE plus a weight ("4 totes, 9,240 lb"), and the
 * regulatory question hiding inside that line — is this bulk or non-bulk packaging (§171.8)? — is a
 * property of the PACKAGE, not something a dispatcher should be asked to answer. The old form asked
 * the raw question ("Bulk / Non-bulk") and made the human translate; this module encodes the
 * translation so the answer is derived and the human states only what the paper says.
 *
 * §171.8 in brief: bulk packaging is >119 gal liquid capacity, >882 lb (400 kg) solids, or >1,000 L
 * for gases — so a 275/330-gal IBC ("tote") is BULK even when it rides on a dry van, while a 55-gal
 * drum is non-bulk even in a truckload of them. Getting the tote case wrong flips the §172.504(c)
 * 1,001-lb analysis and the §172.331 ID-display duty, which is exactly the under-placarding failure
 * the engine's D2 posture forbids.
 *
 * "Pallet" is deliberately NOT a package type. A pallet is unitization; a pallet of 4 drums is 4
 * packages. The UI carries this as a hint rather than a selectable value so the count entered is
 * always the count of DOT packages.
 */

export type PackagingKind = "bulk" | "non_bulk";

export interface PackageTypeSpec {
  value: string;
  label: string;
  /** The §171.8 answer this package type implies. */
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
    value: "drum",
    label: "Drum (≤ 119 gal)",
    packagingKind: "non_bulk",
    defaultUnit: "gal",
    hint: "A 55-gal drum is non-bulk. A pallet of drums is counted as its drums, not as pallets.",
  },
  { value: "pail", label: "Pail / jerrican", packagingKind: "non_bulk", defaultUnit: "gal" },
  { value: "cylinder", label: "Cylinder", packagingKind: "non_bulk", defaultUnit: "lb" },
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
    label: "Other bulk packaging (> 119 gal / > 882 lb capacity)",
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

/** The §171.8 bulk/non-bulk answer for a package type; null when the type is unset/unknown. */
export function packagingKindFor(value: string): PackagingKind | null {
  return packageTypeSpec(value)?.packagingKind ?? null;
}

/** Package types that describe the vehicle itself (no meaningful package count). */
export function isVehiclePackaging(value: string): boolean {
  return value === "bulk_cargo";
}

export const LB_PER_KG = 2.20462;

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
