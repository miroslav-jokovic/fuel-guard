import { describe, expect, it } from "vitest";
import { parseBolFields, type BolLineFields } from "./bolFields.js";
import { checkAgreement, checkArithmetic, reconcileDeclaredVsExtracted } from "./crossValidate.js";

const bol = (lines: Array<Partial<BolLineFields>>, over: Record<string, unknown> = {}) =>
  parseBolFields({ lines, ...over });
const GAS: Partial<BolLineFields> = { idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" } };

describe("crossValidate — dual-pass agreement (step 4b)", () => {
  it("identical passes → no flags", () => {
    expect(checkAgreement(bol([GAS]), bol([GAS]))).toEqual([]);
  });
  it("id-number disagreement on a line is flagged", () => {
    const b = bol([{ ...GAS, idText: "UN1993" }]);
    expect(checkAgreement(bol([GAS]), b)).toContain("pass_disagreement:idNumber:line1");
  });
  it("different line counts is itself a disagreement", () => {
    expect(checkAgreement(bol([GAS]), bol([GAS, GAS]))).toContain("pass_disagreement:line_count");
  });
  it("ER phone (digits) and certification presence must agree", () => {
    expect(checkAgreement(bol([GAS], { emergencyPhone: "800-424-9300" }), bol([GAS], { emergencyPhone: "800-424-9301" })))
      .toContain("pass_disagreement:emergencyPhone");
    expect(checkAgreement(bol([GAS], { shipperCertification: true }), bol([GAS], { shipperCertification: false })))
      .toContain("pass_disagreement:certification");
  });
  it("UN1203 vs 1203 agree (id compared by digits, not prefix formatting)", () => {
    expect(checkAgreement(bol([GAS]), bol([{ ...GAS, idText: "1203" }]))).toEqual([]);
  });
});

describe("crossValidate — printed arithmetic (step 4c)", () => {
  it("count × per-package = extended weight passes; a mismatch flags", () => {
    expect(checkArithmetic(bol([{ packageCount: 2, perPackageWeightLb: 627, grossWeightLb: 1254 }]))).toEqual([]);
    expect(checkArithmetic(bol([{ packageCount: 2, perPackageWeightLb: 627, grossWeightLb: 1000 }]))).toContain("extended_weight_mismatch:line1");
  });
  it("sum of line weights vs the printed total", () => {
    expect(checkArithmetic(bol([{ grossWeightLb: 600 }, { grossWeightLb: 654 }], { totalGrossWeightLb: 1254 }))).toEqual([]);
    expect(checkArithmetic(bol([{ grossWeightLb: 600 }], { totalGrossWeightLb: 2000 }))).toContain("total_weight_mismatch");
  });
  it("a multi-page set missing pages flags", () => {
    expect(checkArithmetic(bol([GAS], { pageInfo: { page: 1, of: 2 } }))).toContain("page_incomplete");
  });
});

describe("crossValidate — declared vs extracted reconciliation (step 4d)", () => {
  it("a clean match within tolerance → no flags", () => {
    expect(reconcileDeclaredVsExtracted(
      [{ hmtRef: "UN1203-gasoline#II", quantityValue: 8000 }],
      [{ hmtRef: "UN1203-gasoline#II", quantityValue: 8100 }],
    )).toEqual([]); // 8100 vs 8000 is within 2%
  });
  it("unmatched lines in either direction flag", () => {
    const flags = reconcileDeclaredVsExtracted(
      [{ hmtRef: "UN1202-diesel-fuel#III" }],
      [{ hmtRef: "UN1203-gasoline#II", quantityValue: 8000 }],
    );
    expect(flags).toContain("extracted_line_not_declared:UN1203-gasoline#II");
    expect(flags).toContain("declared_line_not_extracted:UN1202-diesel-fuel#III");
  });
  it("a quantity beyond 2% flags", () => {
    expect(reconcileDeclaredVsExtracted(
      [{ hmtRef: "UN1203-gasoline#II", quantityValue: 8000 }],
      [{ hmtRef: "UN1203-gasoline#II", quantityValue: 9000 }],
    )).toContain("quantity_mismatch:UN1203-gasoline#II");
  });
});
