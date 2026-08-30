import type { HazmatCalcRequest, HazmatProduct } from "@silvicom/shared";
import {
  capacityFromForm,
  derivePackaging,
  isVehiclePackaging,
  PACKAGE_TYPE_OPTIONS,
  packageTypeSpec,
  phaseForHazardClass,
  weightToLb,
  type DerivedPackaging,
} from "@silvicom/shared";
import type { Verdict } from "@hazmat/engine";

/**
 * Placard Calculator form model + pure form→request logic (plan H5, reworked by H-P1). Kept free of
 * any runtime imports (no @/lib/api / supabase) so it unit-tests without the browser client — the
 * composables in useHazmatCalc.ts add the Vue Query wiring on top. Free-text products are impossible:
 * a line without a resolved `hmtRef` is dropped, never guessed (fail-closed at the source, H6).
 *
 * H-P1 changes the questions the form asks, not the engine contract:
 *  · "Carrier context" (engine jargon: cargo_tank / van_or_flatbed) became EQUIPMENT — stated in
 *    trailer terms (tanker, hopper, van…), the same vocabulary as the Trailers page. The engine
 *    kind + each line's default packaging are derived (EQUIPMENT_OPTIONS), never asked raw. It also
 *    collided with the load form's genuinely-named "carrier relationship" (§172.506) — a different
 *    fact that stays where it was.
 *  · "Bulk / Non-bulk" became PACKAGE TYPE (drums, totes, cylinders…) — the §171.8 answer is a
 *    property of the package and is derived (hazmatPackaging.ts). A 275-gal tote on a dry van is
 *    bulk; asking a dispatcher to know that is how loads get under-placarded.
 *  · Gross weight takes lb OR kg and converts; package count is captured (§172.202(a)(7) — every
 *    real BOL states it) and sent to the engine.
 */
export type QuantityUnit = "gal" | "lb" | "kg" | "L";
export type VehicleKind = "cargo_tank" | "van_or_flatbed";
export type TankState = "loaded" | "residue_uncleaned" | "cleaned_and_purged";

// Enum fields are typed `string` for clean ComboSelect binding (repo convention — LoadForm's
// StopDraft.kind), constrained by the option lists and validated by the engine schema server-side.
export interface CalcLineForm {
  product: HazmatProduct | null;
  /** BOL package vocabulary (hazmatPackaging.ts) — bulk/non-bulk is DERIVED from this. */
  packageType: string;
  /** Count of DOT packages ("4 totes" → 4). Blank/irrelevant for loose bulk. */
  packageCount: string;
  /** D-H14: OPTIONAL per-package size. When set, the measured §171.8 answer overrides the type
   *  default (gal/L = receptacle volume; lb/kg = water capacity, for gases). */
  perPackageCapacityValue: string;
  perPackageCapacityUnit: string;
  quantityValue: string;
  quantityUnit: string;
  grossWeightValue: string;
  /** "lb" | "kg" — converted to lb for the engine (§172.504(c) evaluates pounds). */
  grossWeightUnit: string;
  compartmentIndex: string;
  isResidueLine: boolean;
  /** §173.150(f) offeror election — INPUT, never inferred (D1). */
  reclassedCombustible: boolean;
  /** H-LQ: the offeror's Limited Quantity declaration (§172.203(b)/§172.315) — INPUT, never
   *  inferred. The engine verifies it against HMT column 8A and refuses fail-closed. */
  isLimitedQuantity: boolean;
  /**
   * §171.8: percent by weight of the marine-pollutant component, when this line is a SOLUTION OR
   * MIXTURE rather than the material itself. Blank means neat, or a mixture nobody measured — both
   * stay classified as a marine pollutant, so this field can only ever remove a requirement when
   * someone actually states the number. Only asked on a product that IS on appendix B.
   */
  marinePollutantConcentrationPct: string;
}

export interface CalcForm {
  /** Trailer-vocabulary equipment ("tanker" | "hopper" | "van" | "reefer" | "flatbed" | ""). */
  equipmentType: string;
  cargoTankCapacityGal: string;
  tankState: string;
  /** §172.336(c) table: comma/space-separated IDs retained from the previous or current business day. */
  businessDayIds: string;
  /**
   * H-MX: is any NON-hazmat freight riding along? "" = not sure (conservative default) | "no" | "yes".
   * Feeds the engine's `otherFreightAboard` tri-state — it decides the §172.301(a)(3) vehicle ID
   * display on big single-product package loads, and NEVER the placard aggregate (hazmat-only by CFR).
   */
  otherFreight: string;
  /**
   * §172.322: does any part of this move go by vessel? "" = not stated | "no" | "yes".
   *
   * It exists because the marine-pollutant answer INVERTS on it, and in the direction nobody
   * expects: §171.4(c)(1) exempts non-bulk marine pollutants from the whole subchapter on a
   * highway-only move, and §172.322(d)(3) waives the mark on an already-placarded bulk vehicle
   * "except for transportation by vessel". Left unstated, the engine raises a conditional rather
   * than guessing — but only on the loads where the two branches actually disagree.
   */
  vesselLeg: string;
  lines: CalcLineForm[];
}

export interface CalcResult {
  engineVersion: string;
  datasetVersion: string;
  datasetProvisional: boolean;
  verdict: Verdict;
}

/**
 * The user states equipment in fleet terms; the engine kind and the default line packaging are
 * derived, mirroring `resolveVehicleKind` (shared) so the calculator and a real analysis of the same
 * trailer cannot disagree. A hopper is van_or_flatbed for the engine's tank rules yet defaults its
 * lines BULK — it is bulk packaging under §171.8 (the old two-option dropdown could not say this).
 */
export interface EquipmentSpec {
  value: string;
  label: string;
  vehicleKind: VehicleKind;
  defaultLinePackaging: "bulk" | "non_bulk";
  /** The line package type a fresh line starts as on this equipment. */
  defaultPackageType: string;
}
export const EQUIPMENT_OPTIONS: readonly EquipmentSpec[] = [
  { value: "tanker", label: "Tanker / cargo tank (bulk liquid)", vehicleKind: "cargo_tank", defaultLinePackaging: "bulk", defaultPackageType: "bulk_cargo" },
  { value: "hopper", label: "Hopper / pneumatic (bulk dry)", vehicleKind: "van_or_flatbed", defaultLinePackaging: "bulk", defaultPackageType: "bulk_cargo" },
  { value: "van", label: "Dry van / box truck (packages)", vehicleKind: "van_or_flatbed", defaultLinePackaging: "non_bulk", defaultPackageType: "" },
  { value: "reefer", label: "Reefer (packages)", vehicleKind: "van_or_flatbed", defaultLinePackaging: "non_bulk", defaultPackageType: "" },
  { value: "flatbed", label: "Flatbed / step deck (packages)", vehicleKind: "van_or_flatbed", defaultLinePackaging: "non_bulk", defaultPackageType: "" },
];

export function equipmentSpec(value: string): EquipmentSpec | null {
  return EQUIPMENT_OPTIONS.find((o) => o.value === value) ?? null;
}

/** The fleet's `trailer_type` vocabulary → the calculator's equipment vocabulary. */
export function equipmentFromTrailerType(trailerType: string | null | undefined): string {
  switch (trailerType) {
    case "tanker": return "tanker";
    case "hopper": return "hopper";
    case "reefer": return "reefer";
    case "flatbed": return "flatbed";
    case "dry_van": return "van";
    default: return ""; // "other" / unset — the user states it
  }
}

export const TANK_STATE_OPTIONS: Array<{ value: TankState; label: string }> = [
  { value: "loaded", label: "Loaded" },
  { value: "residue_uncleaned", label: "Residue — uncleaned" },
  { value: "cleaned_and_purged", label: "Cleaned & purged" },
];
export const QUANTITY_UNIT_OPTIONS: Array<{ value: QuantityUnit; label: string }> = [
  { value: "gal", label: "gal" },
  { value: "L", label: "L" },
  { value: "lb", label: "lb" },
  { value: "kg", label: "kg" },
];
export const GROSS_WEIGHT_UNIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "lb", label: "lb" },
  { value: "kg", label: "kg" },
];
/** H-MX: the mixed-load tri-state. Blank means "not sure" — the engine then assumes the worst. */
export const OTHER_FREIGHT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Not sure" },
  { value: "no", label: "No — these products are the whole load" },
  { value: "yes", label: "Yes — other freight rides along (mixed load)" },
];
/**
 * §171.8's threshold for the product on a line — 10% listed, 1% severe, and 1% when the severity is
 * unknown because the pollutant is an unnamed component (SP 441). The stricter figure classifies MORE
 * mixtures as marine pollutants, which is the over-display direction.
 *
 * Mirrors `concentrationThresholdPct` in the engine so the form's hint states the same number the
 * verdict will apply.
 */
export function marinePollutantThresholdPct(product: HazmatProduct | null): number {
  return product?.marinePollutantSevere === false ? 10 : 1;
}

/** §172.322: the vessel-leg tri-state. Blank means unstated — the engine then asks rather than assumes. */
export const VESSEL_LEG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Not stated" },
  { value: "no", label: "No — highway only" },
  { value: "yes", label: "Yes — part of this move goes by vessel" },
];

/** D-H14: per-package size units. gal/L are receptacle volume; lb/kg are water capacity (gases). */
export const CAPACITY_UNIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "gal", label: "gal" },
  { value: "L", label: "L" },
  { value: "lb", label: "lb (water cap.)" },
  { value: "kg", label: "kg (water cap.)" },
];
export { PACKAGE_TYPE_OPTIONS };

/**
 * A fresh line, shaped by the equipment the user has stated (F-P4 / H-P1). On a tanker or hopper the
 * line starts as loose bulk in gallons; on package equipment the package type is deliberately BLANK —
 * the §171.8 answer rides on it, so the user states what the BOL says rather than inheriting a guess.
 * Everything stays editable.
 */
export function emptyLine(equipmentType = ""): CalcLineForm {
  const eq = equipmentSpec(equipmentType);
  const packageType = eq?.defaultPackageType ?? "";
  const spec = packageTypeSpec(packageType);
  return {
    product: null,
    packageType,
    packageCount: "",
    perPackageCapacityValue: "",
    perPackageCapacityUnit: "gal",
    quantityValue: "",
    quantityUnit: spec?.defaultUnit ?? (eq?.defaultLinePackaging === "bulk" ? "gal" : "lb"),
    grossWeightValue: "",
    grossWeightUnit: "lb",
    compartmentIndex: "",
    isResidueLine: false,
    reclassedCombustible: false,
    isLimitedQuantity: false,
    marinePollutantConcentrationPct: "",
  };
}

/**
 * An empty form states nothing about the equipment. `equipmentType` is deliberately unset rather than
 * defaulted: it is the input that most changes the answer — bulk versus non-bulk decides whether the
 * 1,001 lb aggregate applies at all — and a default of `tanker` meant anyone who never touched the
 * dropdown, including every anonymous visitor to the public calculator, silently calculated as a
 * fuel tanker. The form requires a choice instead of guessing one.
 */
export function emptyForm(): CalcForm {
  return {
    equipmentType: "",
    cargoTankCapacityGal: "",
    tankState: "loaded",
    businessDayIds: "",
    otherFreight: "",
    vesselLeg: "",
    lines: [emptyLine()],
  };
}

/** Is this form answerable? The engine needs the equipment stated and at least one resolved product. */
export function calcFormReady(form: CalcForm): boolean {
  return equipmentSpec(form.equipmentType) !== null && form.lines.some((l) => l.product != null);
}

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Parse the business-day ID field ("UN1203, un1993" → ["UN1203","UN1993"]); blank → null (unknown). */
export function parseBusinessDayIds(raw: string): string[] | null {
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? ids : null;
}

/** True when the form has at least one resolved product — the calculate button gates on this. */
export function hasResolvedLine(form: CalcForm): boolean {
  return form.lines.some((l) => l.product !== null);
}

/**
 * The line's full §171.8 derivation (D-H14): a measured per-package capacity beats the type
 * default — both directions, with the reason and an `overrodeType` flag the UI surfaces. The phase
 * comes from the product's hazard class (Class 2 → gas test; else the conservative liquid test).
 * When neither capacity nor type answers, the equipment's default applies — bulk on a
 * tanker/hopper, non-bulk on package equipment — so an incomplete line degrades to the same answer
 * the old binary dropdown defaulted to, never to silence.
 */
export function linePackagingDerivation(line: CalcLineForm, equipmentType: string): DerivedPackaging {
  const derived = derivePackaging({
    packageType: line.packageType,
    phase: phaseForHazardClass(line.product?.hazardClass ?? null),
    capacity: capacityFromForm(numOrNull(line.perPackageCapacityValue), line.perPackageCapacityUnit),
  });
  if (derived.source !== "none") return derived;
  const fallback = equipmentSpec(equipmentType)?.defaultLinePackaging ?? "bulk";
  return { kind: fallback, source: "none", because: null, overrodeType: false };
}

/** The bare §171.8 answer (see linePackagingDerivation for the reasoned version). */
export function linePackagingKind(line: CalcLineForm, equipmentType: string): "bulk" | "non_bulk" {
  return linePackagingDerivation(line, equipmentType).kind;
}

/** The line's gross weight in pounds (kg converted; §172.504(c) evaluates pounds). */
export function lineGrossWeightLb(line: CalcLineForm): number | null {
  return weightToLb(numOrNull(line.grossWeightValue), line.grossWeightUnit);
}

/**
 * D-H23 (2026-08-30): what the offeror DECLARED, carried alongside what the engine consumes.
 *
 * `declared_lines` is an EVIDENCE column — the defense packet prints it and `reproduce.ts` re-runs
 * from it — and until now it stored only the engine's derived answer: `packagingKind: "non_bulk"`
 * where the BOL said "10 drums", and an opaque `hmtRef` where the paper said "UN1203 · Gasoline".
 * Two things went wrong with that. A draft could not be re-opened for editing without silently
 * losing the package type and the per-package size, which are the two inputs the §171.8 derivation
 * (D-H14) runs on — so a second save could flip bulk/non-bulk on a record nobody had knowingly
 * changed. And a packet could not state the declaration in the words the shipping paper used.
 *
 * These keys can never change a verdict — the engine's `lineSchema` is a plain `z.object`, so zod
 * STRIPS unknown keys before any rule sees them (pinned by "is stripped by lineSchema" in
 * declaredLines.test.ts). They survive onto the stored row because
 * `hazmatCreateLoadRequestSchema.declaredLines` is `z.array(z.record(z.string(), z.unknown()))` and
 * `hazmatLoads.ts` writes the request's lines verbatim.
 *
 * `declaredProduct` is a SNAPSHOT, for display and re-editing only. The authoritative resolution
 * stays `hmtRef` against the run's pinned `dataset_version` — never this copy, which is why
 * `reproduce.ts` reads the ref and not the label.
 */
export interface DeclaredLineProvenance {
  declaredProduct: HazmatProduct;
  /** The BOL package vocabulary the user stated ("drums", "ibc_tote", "bulk_cargo", …). */
  declaredPackageType: string;
  /** The optional measured per-package size (D-H14), as entered. Null when it was left blank. */
  declaredPerPackage: { value: string; unit: string } | null;
}

/** Map one resolved form line to a canonical engine `LoadInput` line (also used for a load's declared_lines). */
export function buildEngineLine(l: CalcLineForm, equipmentType = ""): Record<string, unknown> {
  const product = l.product as HazmatProduct;
  const compartment = numOrNull(l.compartmentIndex);
  const count = isVehiclePackaging(l.packageType) ? null : numOrNull(l.packageCount);
  return {
    declaredProduct: product,
    declaredPackageType: l.packageType,
    declaredPerPackage:
      l.perPackageCapacityValue.trim() === ""
        ? null
        : { value: l.perPackageCapacityValue, unit: l.perPackageCapacityUnit },
    hmtRef: product.hmtRef,
    reclassedCombustible: l.reclassedCombustible,
    isLimitedQuantity: l.isLimitedQuantity,
    // A blank quantity is UNKNOWN, not zero. Coercing it to 0 made "the dispatcher did not fill this
    // in" indistinguishable from "the BOL declares none" — and `grossWeightLb` on the next line has
    // always sent null for exactly that reason.
    quantity: { value: numOrNull(l.quantityValue), unit: l.quantityUnit },
    grossWeightLb: lineGrossWeightLb(l),
    compartmentIndex: compartment === null ? null : Math.trunc(compartment),
    isResidueLine: l.isResidueLine,
    flashPointF: null,
    ethanolPct: null,
    packagingKind: linePackagingKind(l, equipmentType),
    packageCount: count === null ? null : Math.trunc(count),
    marinePollutantConcentrationPct: numOrNull(l.marinePollutantConcentrationPct),
  };
}

/** Resolved lines only (unknown products dropped, never guessed — fail-closed at the source). */
export function buildEngineLines(lines: CalcLineForm[], equipmentType = ""): Record<string, unknown>[] {
  return lines.filter((l) => l.product !== null).map((l) => buildEngineLine(l, equipmentType));
}

/**
 * Build the `POST /hazmat/calc` body from the form. `evaluatedAt` + `dataset` are injected server-side;
 * `policy` is null (pure calculator mode → eligibility is `not_checked`). Lines without a resolved product
 * are dropped, never guessed.
 */
export function buildCalcRequest(form: CalcForm): HazmatCalcRequest {
  const eq = equipmentSpec(form.equipmentType);
  const vehicleKind = eq?.vehicleKind ?? "cargo_tank"; // unreachable when calcFormReady gates; conservative anyway
  const lines = buildEngineLines(form.lines, form.equipmentType);

  const load = {
    vehicle: {
      kind: vehicleKind,
      cargoTankCapacityGal: vehicleKind === "cargo_tank" ? numOrNull(form.cargoTankCapacityGal) : null,
      compartments: null,
    },
    tankState: form.tankState,
    lines,
    // H-MX: tri-state — "yes"/"no" are the user's statement, blank stays null (unknown, conservative).
    otherFreightAboard: form.otherFreight === "yes" ? true : form.otherFreight === "no" ? false : null,
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: {
      vesselConnected: form.vesselLeg === "yes" ? true : form.vesselLeg === "no" ? false : null,
      imdgPapers: null,
    },
    tripContext: {
      previousOrCurrentBusinessDayIds: parseBusinessDayIds(form.businessDayIds),
      carrierRelationship: "unknown" as const,
    },
    policy: null,
  };

  return { load: load as Record<string, unknown> };
}

/**
 * H-MX: the line gross weight the entered packaging implies — package count × per-package weight —
 * offered as a one-click suggestion, never silently applied. Only when the per-package figure is a
 * WEIGHT (lb/kg): a volume needs a density guess, and for Class 2 products lb/kg per package means
 * water capacity (D-H14), not contents weight, so gases never get a suggestion.
 */
export function suggestedGrossLb(line: CalcLineForm): number | null {
  if (line.perPackageCapacityUnit !== "lb" && line.perPackageCapacityUnit !== "kg") return null;
  if (phaseForHazardClass(line.product?.hazardClass ?? null) === "gas") return null;
  const per = weightToLb(numOrNull(line.perPackageCapacityValue), line.perPackageCapacityUnit);
  const count = numOrNull(line.packageCount);
  if (per == null || per <= 0 || count == null || count <= 0) return null;
  return Math.round(per * count);
}

/**
 * Strip regulatory citations from a derived note for FORM display (the results panel keeps its
 * citations — that is where they carry audit value). Removes "(§171.8(1))"-style parentheticals and
 * bare "§171.8(2)" tokens, then tidies the whitespace the removal leaves behind.
 */
export function stripCitations(text: string): string {
  // Mark bare §-references first (their own parens would defeat a one-pass parenthetical regex),
  // then drop any parenthetical that contains a marker or an agency citation, then the markers.
  const MARK = "\u0000";
  return text
    .replace(/§\s?[0-9]+(?:\.[0-9]+)*(?:\([0-9a-zA-Z]+\))*(?:'s)?/g, MARK)
    // eslint-disable-next-line no-control-regex -- null byte is the private sentinel for removed citations.
    .replace(/\s*\([^()]*(?:\u0000|PHMSA|49 CFR)[^()]*\)/g, "")
    // eslint-disable-next-line no-control-regex -- remove the private null-byte citation sentinel.
    .replace(/\u0000\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}
