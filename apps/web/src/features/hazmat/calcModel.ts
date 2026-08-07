import type { HazmatCalcRequest, HazmatProduct } from "@fuelguard/shared";
import type { Verdict } from "@hazmat/engine";

/**
 * Placard Calculator form model + pure form→request logic (plan H5). Kept free of any runtime imports
 * (no @/lib/api / supabase) so it unit-tests without the browser client — the composables in
 * useHazmatCalc.ts add the Vue Query wiring on top. Free-text products are impossible: a line without a
 * resolved `hmtRef` is dropped, never guessed (fail-closed at the source, mirroring resolveHmtLine, H6).
 */
export type QuantityUnit = "gal" | "lb" | "kg" | "L";
export type PackagingKind = "bulk" | "non_bulk";
export type VehicleKind = "cargo_tank" | "van_or_flatbed";
export type TankState = "loaded" | "residue_uncleaned" | "cleaned_and_purged";

// Enum fields are typed `string` for clean ComboSelect binding (repo convention — LoadForm's
// StopDraft.kind), constrained by the option lists and validated by the engine schema server-side.
export interface CalcLineForm {
  product: HazmatProduct | null;
  quantityValue: string;
  quantityUnit: string;
  packagingKind: string;
  grossWeightLb: string;
  compartmentIndex: string;
  isResidueLine: boolean;
  /** §173.150(f) offeror election — INPUT, never inferred (D1). */
  reclassedCombustible: boolean;
}

export interface CalcForm {
  vehicleKind: string;
  cargoTankCapacityGal: string;
  tankState: string;
  /** §172.336(c) table: comma/space-separated IDs retained from the previous or current business day. */
  businessDayIds: string;
  lines: CalcLineForm[];
}

export interface CalcResult {
  engineVersion: string;
  datasetVersion: string;
  datasetProvisional: boolean;
  verdict: Verdict;
}

export const VEHICLE_KIND_OPTIONS: Array<{ value: VehicleKind; label: string }> = [
  { value: "cargo_tank", label: "Cargo tank (bulk)" },
  { value: "van_or_flatbed", label: "Van / flatbed (non-bulk)" },
];
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
export const PACKAGING_KIND_OPTIONS: Array<{ value: PackagingKind; label: string }> = [
  { value: "bulk", label: "Bulk" },
  { value: "non_bulk", label: "Non-bulk" },
];

/**
 * A fresh line, shaped by the carrier context the user has stated (F-P4).
 *
 * These used to be literals: every line began as bulk gallons, which is a fuel tanker's answer and
 * nobody else's. On a van or flatbed it was wrong on every line, and — since packaging drives the
 * §172.504(c) aggregate and the ID-display rules — wrong in a way that changed the verdict. Derive
 * them instead, and leave them editable.
 */
export function emptyLine(vehicleKind = ""): CalcLineForm {
  const isTank = vehicleKind === "cargo_tank";
  return {
    product: null,
    quantityValue: "",
    quantityUnit: isTank ? "gal" : "lb",
    packagingKind: isTank ? "bulk" : "non_bulk",
    grossWeightLb: "",
    compartmentIndex: "",
    isResidueLine: false,
    reclassedCombustible: false,
  };
}

/**
 * An empty form states nothing about the vehicle. `vehicleKind` is deliberately unset rather than
 * defaulted: it is the single input that most changes the answer — bulk versus non-bulk decides
 * whether the 1,001 lb aggregate applies at all — and a default of `cargo_tank` meant anyone who never
 * touched the dropdown, including every anonymous visitor to the public calculator, silently
 * calculated as a fuel tanker. The form requires a choice instead of guessing one.
 */
export function emptyForm(): CalcForm {
  return {
    vehicleKind: "",
    cargoTankCapacityGal: "",
    tankState: "loaded",
    businessDayIds: "",
    lines: [emptyLine()],
  };
}

/** Is this form answerable? The engine needs a carrier context and at least one resolved product. */
export function calcFormReady(form: CalcForm): boolean {
  return form.vehicleKind !== "" && form.lines.some((l) => l.product != null);
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

/** Map one resolved form line to a canonical engine `LoadInput` line (also used for a load's declared_lines). */
export function buildEngineLine(l: CalcLineForm): Record<string, unknown> {
  const product = l.product as HazmatProduct;
  const compartment = numOrNull(l.compartmentIndex);
  return {
    hmtRef: product.hmtRef,
    reclassedCombustible: l.reclassedCombustible,
    quantity: { value: numOrNull(l.quantityValue) ?? 0, unit: l.quantityUnit },
    grossWeightLb: numOrNull(l.grossWeightLb),
    compartmentIndex: compartment === null ? null : Math.trunc(compartment),
    isResidueLine: l.isResidueLine,
    flashPointF: null,
    ethanolPct: null,
    packagingKind: l.packagingKind,
    packageCount: null,
  };
}

/** Resolved lines only (unknown products dropped, never guessed — fail-closed at the source). */
export function buildEngineLines(lines: CalcLineForm[]): Record<string, unknown>[] {
  return lines.filter((l) => l.product !== null).map(buildEngineLine);
}

/**
 * Build the `POST /hazmat/calc` body from the form. `evaluatedAt` + `dataset` are injected server-side;
 * `policy` is null (pure calculator mode → eligibility is `not_checked`). Lines without a resolved product
 * are dropped, never guessed.
 */
export function buildCalcRequest(form: CalcForm): HazmatCalcRequest {
  const lines = buildEngineLines(form.lines);

  const load = {
    vehicle: {
      kind: form.vehicleKind,
      cargoTankCapacityGal: form.vehicleKind === "cargo_tank" ? numOrNull(form.cargoTankCapacityGal) : null,
      compartments: null,
    },
    tankState: form.tankState,
    lines,
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: {
      previousOrCurrentBusinessDayIds: parseBusinessDayIds(form.businessDayIds),
      carrierRelationship: "unknown" as const,
    },
    policy: null,
  };

  return { load: load as Record<string, unknown> };
}
