import { describe, it, expect } from "vitest";
import { lineSchema } from "@hazmat/engine";
import type { HazmatProduct } from "@silvicom/shared";
import { buildEngineLine, emptyLine, type CalcLineForm } from "./calcModel";
import { formLineFromDeclared, formLinesFromDeclared } from "./declaredLines";

const GASOLINE: HazmatProduct = {
  hmtRef: "e1#II",
  entryId: "e1",
  idPrefix: "UN",
  idNumber: "1203",
  idLabel: "UN1203",
  psn: "Gasoline",
  hazardClass: "3",
  subsidiaryClasses: [],
  pg: "II",
  symbols: [],
  label: "UN1203 · Gasoline · Class 3 · PG II",
  isFuelCommon: true,
  isMarinePollutant: false,
  marinePollutantSevere: null,
};

function drumLine(): CalcLineForm {
  return {
    ...emptyLine("van"),
    product: GASOLINE,
    packageType: "drum",
    packageCount: "10",
    perPackageCapacityValue: "55",
    perPackageCapacityUnit: "gal",
    quantityValue: "550",
    quantityUnit: "gal",
    grossWeightValue: "3600",
    grossWeightUnit: "lb",
    isLimitedQuantity: true,
    isResidueLine: false,
    reclassedCombustible: false,
  };
}

describe("declared-line round trip (D-H23)", () => {
  it("recovers the package type and per-package size the engine line does not carry", () => {
    const stored = buildEngineLine(drumLine(), "van");
    // The two inputs the §171.8 derivation runs on are absent from the engine's own contract — it
    // only receives the ANSWER (`packagingKind`). Without the snapshot a second save would re-derive
    // from nothing and could flip bulk/non-bulk on a record nobody knowingly changed.
    expect(stored.packagingKind).toBe("non_bulk");
    expect("packageType" in stored).toBe(false);

    const back = formLineFromDeclared(stored, "van")!;
    expect(back.packageType).toBe("drum");
    expect(back.perPackageCapacityValue).toBe("55");
    expect(back.perPackageCapacityUnit).toBe("gal");
    expect(back.packageCount).toBe("10");
    expect(back.product?.hmtRef).toBe("e1#II");
  });

  it("round-trips the offeror's three declarations", () => {
    const line = { ...drumLine(), isResidueLine: true, reclassedCombustible: true, isLimitedQuantity: true };
    const back = formLineFromDeclared(buildEngineLine(line, "van"), "van")!;
    expect(back.isResidueLine).toBe(true);
    expect(back.reclassedCombustible).toBe(true);
    expect(back.isLimitedQuantity).toBe(true);
  });

  it("returns the gross weight in pounds even when it was entered in kg", () => {
    const line = { ...drumLine(), grossWeightValue: "1000", grossWeightUnit: "kg" };
    const back = formLineFromDeclared(buildEngineLine(line, "van"), "van")!;
    // §172.504(c) evaluates pounds, so pounds is what the record stores; the kg the user typed was
    // only ever an input aid and is deliberately not preserved.
    expect(back.grossWeightUnit).toBe("lb");
    expect(Number(back.grossWeightValue)).toBeCloseTo(2204.62, 1);
  });

  it("refuses to invent a product for a line with no snapshot", () => {
    const noSnapshot = { hmtRef: "e1#II", packagingKind: "bulk", quantity: { value: 1, unit: "gal" } };
    expect(formLineFromDeclared(noSnapshot, "tanker")).toBeNull();

    const recovered = formLinesFromDeclared([buildEngineLine(drumLine(), "van"), noSnapshot], "van");
    expect(recovered.lines).toHaveLength(1);
    expect(recovered.unrecoverable).toBe(1);
  });

  it("tolerates a declaration that is not an array", () => {
    expect(formLinesFromDeclared(null)).toEqual({ lines: [], unrecoverable: 0 });
    expect(formLinesFromDeclared(undefined)).toEqual({ lines: [], unrecoverable: 0 });
  });
});

describe("declaration provenance cannot reach the engine", () => {
  it("is stripped by lineSchema, so it can never change a verdict", () => {
    const stored = buildEngineLine(drumLine(), "van");
    expect(stored.declaredProduct).toBeDefined();
    expect(stored.declaredPackageType).toBe("drum");

    const parsed = lineSchema.parse(stored);
    expect("declaredProduct" in parsed).toBe(false);
    expect("declaredPackageType" in parsed).toBe(false);
    expect("declaredPerPackage" in parsed).toBe(false);
    expect(parsed.hmtRef).toBe("e1#II");
    expect(parsed.packagingKind).toBe("non_bulk");
  });
});
