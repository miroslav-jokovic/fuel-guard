import { describe, expect, it } from "vitest";
import { buildDatasetIndex, loadDataset } from "@hazmat/data";
import { parseBolFields, type BolLineFields } from "./bolFields.js";
import { mapBolLines, type DeclaredLineRef } from "./mapBolLines.js";

/**
 * BolFields → engine lines, verified against the REAL dataset. The mapper's whole job is to be fail-closed:
 * unresolved / unmappable lines produce named flags and NO engine line, never a guessed one.
 */
const index = buildDatasetIndex(loadDataset());
const bol = (lines: Array<Partial<BolLineFields>>) => parseBolFields({ lines });

describe("mapBolLines — resolution + fail-closed", () => {
  it("maps a gasoline cargo-tank line to the canonical engine line", () => {
    const r = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" }, packaging: "1 cargo tank" }]), { vehicleKind: "cargo_tank" });
    expect(r.allResolved).toBe(true);
    const line = r.lines[0]!;
    expect(line.ok).toBe(true);
    expect(line.engineLine).toMatchObject({ hmtRef: "UN1203-gasoline#II", packagingKind: "bulk", quantity: { value: 8000, unit: "gal" } });
    expect(line.provenance.flashPointF).toBe("dataset_default");
  });

  it("an unresolvable line produces a named flag and NO engine line", () => {
    const r = mapBolLines(index, bol([{ idText: "UN1206", psn: "Hexanes", pg: "II" }]), { vehicleKind: "cargo_tank" });
    expect(r.allResolved).toBe(false);
    expect(r.lines[0]!.ok).toBe(false);
    expect(r.lines[0]!.engineLine).toBeUndefined();
    expect(r.flags).toContain("line_unresolved:psn_no_match");
  });

  it("an unrecognized quantity unit fails closed (no fabricated unit)", () => {
    const r = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", pg: "II", quantity: { value: 100, unit: "barrels" } }]), { vehicleKind: "cargo_tank" });
    expect(r.lines[0]!.ok).toBe(false);
    expect(r.flags).toContain("quantity_unit_unrecognized");
  });

  it("derives packaging from the phrase, then the vehicle kind", () => {
    const drums = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", pg: "II", quantity: { value: 55, unit: "gal" }, packaging: "10 drums" }]), { vehicleKind: "van_or_flatbed" });
    expect(drums.lines[0]!.engineLine!.packagingKind).toBe("non_bulk");
    const noHint = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", pg: "II", quantity: { value: 8000, unit: "gal" } }]), { vehicleKind: "cargo_tank" });
    expect(noHint.lines[0]!.engineLine!.packagingKind).toBe("bulk");
  });
});

describe("mapBolLines — §173.150(f) combustible-liquid election (offeror's, D1)", () => {
  const dieselCombustible: Partial<BolLineFields> = { idText: "NA1993", psn: "Diesel fuel", hazardClass: "Combustible liquid", pg: "III", quantity: { value: 5000, unit: "gal" } };

  it("honors the election ONLY when a declared line confirms it", () => {
    const declared: DeclaredLineRef[] = [{ hmtRef: "NA1993-diesel-fuel#III", reclassedCombustible: true }];
    const r = mapBolLines(index, bol([dieselCombustible]), { vehicleKind: "cargo_tank", declaredLines: declared });
    expect(r.lines[0]!.ok).toBe(true);
    expect(r.lines[0]!.engineLine!.reclassedCombustible).toBe(true);
    expect(r.lines[0]!.provenance.reclassedCombustible).toBe("declared");
  });

  it("unconfirmed election → flag + fail-closed to Class 3 (flammable covers combustible)", () => {
    const r = mapBolLines(index, bol([dieselCombustible]), { vehicleKind: "cargo_tank" });
    expect(r.flags).toContain("reclassification_unconfirmed");
    expect(r.lines[0]!.ok).toBe(false);
    expect(r.lines[0]!.engineLine!.reclassedCombustible).toBe(false);
  });
});

describe("mapBolLines — H-LQ + H-P1 packaging alignment (2026-08-08)", () => {
  const lqLine: Partial<BolLineFields> = {
    idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II",
    quantity: { value: 220, unit: "gal" }, grossWeightLb: 2000, packageCount: 40,
    packaging: "40 cases", marks: ["LIMITED QUANTITY"],
  };

  it("sets isLimitedQuantity ONLY from the dual-pass confirmation array — never from one pass's text", () => {
    const confirmed = mapBolLines(index, bol([lqLine]), { vehicleKind: "van_or_flatbed", lqConfirmed: [true] });
    expect(confirmed.lines[0]!.engineLine!.isLimitedQuantity).toBe(true);
    expect(confirmed.lines[0]!.provenance.isLimitedQuantity).toBe("extracted");
    // Same printed marks, but no dual-pass confirmation → false (fully regulated, conservative).
    const unconfirmed = mapBolLines(index, bol([lqLine]), { vehicleKind: "van_or_flatbed" });
    expect(unconfirmed.lines[0]!.engineLine!.isLimitedQuantity).toBe(false);
  });

  it("totes/IBCs in the packaging phrase are BULK (§171.8) — the pre-D-H14 non-bulk mapping is gone", () => {
    const tote = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", pg: "II", quantity: { value: 1100, unit: "gal" }, packaging: "4 totes" }]), { vehicleKind: "van_or_flatbed" });
    expect(tote.lines[0]!.engineLine!.packagingKind).toBe("bulk");
    const ibc = mapBolLines(index, bol([{ idText: "UN1203", psn: "Gasoline", pg: "II", quantity: { value: 275, unit: "gal" }, packaging: "1 IBC" }]), { vehicleKind: "van_or_flatbed" });
    expect(ibc.lines[0]!.engineLine!.packagingKind).toBe("bulk");
  });
});
