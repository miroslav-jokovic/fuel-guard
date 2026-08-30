import type { HazmatProduct } from "@silvicom/shared";
import { emptyLine, type CalcLineForm } from "./calcModel";

/**
 * The inverse of `buildEngineLine` — a stored `declared_lines` row back into the form shape, so a
 * DRAFT hazmat record can be re-opened and corrected (D-H23).
 *
 * Why this needs a file of its own rather than a branch inside `calcModel`: the forward direction is
 * a pure projection (form → the engine's contract, everything derivable dropped), while this
 * direction is a RECOVERY that can fail. It fails on exactly one thing — a line with no
 * `declaredProduct` snapshot — and it must fail loudly rather than invent a product, because the
 * whole H6 posture of this feature is that an unresolved material cannot enter a load. Callers get
 * the count of what could not be recovered and are expected to say so on screen.
 *
 * Lines with no snapshot are not hypothetical: `buildEngineLine` only started writing one on
 * 2026-08-30, and the BOL extraction path (H-EX) composes engine lines from a photo without ever
 * passing through the form. Both produce a legible, analysable record — just not an editable one.
 */
export interface RecoveredDeclaration {
  lines: CalcLineForm[];
  /** How many stored lines carried no `declaredProduct` and were therefore not recovered. */
  unrecoverable: number;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

function isProduct(v: unknown): v is HazmatProduct {
  return typeof v === "object" && v !== null && typeof (v as HazmatProduct).hmtRef === "string";
}

/**
 * One stored line → one form line. `equipmentType` only seeds the fields the row does not carry, so
 * a recovered line never gains a value the declaration did not state.
 */
export function formLineFromDeclared(raw: unknown, equipmentType = ""): CalcLineForm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (!isProduct(row.declaredProduct)) return null;

  const base = emptyLine(equipmentType);
  const perPackage = row.declaredPerPackage as { value?: unknown; unit?: unknown } | null | undefined;
  const quantity = row.quantity as { value?: unknown; unit?: unknown } | undefined;

  return {
    ...base,
    product: row.declaredProduct,
    packageType: str(row.declaredPackageType),
    packageCount: row.packageCount == null ? "" : str(row.packageCount),
    perPackageCapacityValue: perPackage ? str(perPackage.value) : "",
    perPackageCapacityUnit: perPackage && perPackage.unit != null ? str(perPackage.unit) : base.perPackageCapacityUnit,
    quantityValue: quantity?.value == null ? "" : str(quantity.value),
    quantityUnit: quantity?.unit != null ? str(quantity.unit) : base.quantityUnit,
    // Always stored in pounds (§172.504(c) evaluates pounds), so the unit comes back as lb even when
    // the user originally typed kg. The NUMBER is the declaration; the unit was only ever an input aid.
    grossWeightValue: row.grossWeightLb == null ? "" : str(row.grossWeightLb),
    grossWeightUnit: "lb",
    compartmentIndex: row.compartmentIndex == null ? "" : str(row.compartmentIndex),
    isResidueLine: row.isResidueLine === true,
    reclassedCombustible: row.reclassedCombustible === true,
    isLimitedQuantity: row.isLimitedQuantity === true,
  };
}

/** Recover a whole `declared_lines` array, reporting what could not be recovered. */
export function formLinesFromDeclared(raw: unknown, equipmentType = ""): RecoveredDeclaration {
  const rows = Array.isArray(raw) ? raw : [];
  const lines: CalcLineForm[] = [];
  let unrecoverable = 0;
  for (const row of rows) {
    const line = formLineFromDeclared(row, equipmentType);
    if (line) lines.push(line);
    else unrecoverable += 1;
  }
  return { lines, unrecoverable };
}
