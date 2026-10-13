import type { FieldEvidence, HazmatProduct, ReadResponse } from "@silvicom/shared";

/**
 * BOL reads for the prefill's tests, with evidence built the way `shippingEvidence.ts` records it under
 * rule 4: pass A and pass B per leaf, the table's verdict on a line's judged fields, the OCR's row word on
 * its count and weight.
 */
export type Line = Record<string, unknown>;
const LINE_DEFAULTS: Line = {
  idText: null, descriptionText: null, psn: null, hazardClass: null, pg: null, technicalName: null,
  quantity: { value: null, unit: null }, grossWeightLb: null, packageCount: null, perPackageWeightLb: null,
  packaging: null, hmColumnMark: null, marks: [],
};
export const DIESEL: Line = {
  idText: "NA1993", descriptionText: "NA1993, Diesel fuel, Combustible liquid, PG III", psn: "Diesel fuel", hazardClass: "3", pg: "III",
  quantity: { value: 8500, unit: "GAL" }, grossWeightLb: 59500, packageCount: 1, packaging: "1 cargo tank",
};
export const PAINT: Line = {
  idText: "UN1263", psn: "PAINT", hazardClass: "3", pg: "II", quantity: { value: null, unit: null },
  grossWeightLb: 3806, packageCount: 6, packaging: "6 DRUMS",
};
export const DIESEL_REF = "NA1993-diesel-fuel#III";
export const PAINT_REF = "UN1263-paint#II";
export const product = (hmtRef: string): HazmatProduct => ({
  hmtRef, entryId: hmtRef.split("#")[0]!, idPrefix: "UN", idNumber: "0000", idLabel: hmtRef, psn: hmtRef, hazardClass: "3",
  subsidiaryClasses: [], pg: "II", symbols: [], label: hmtRef, isFuelCommon: false, isMarinePollutant: false, marinePollutantSevere: null,
});
export const PRODUCTS = [product(DIESEL_REF), product(PAINT_REF)];

const JUDGED = ["idText", "psn", "hazardClass", "pg"];
const ROW = ["packageCount", "grossWeightLb", "quantity.value"];
const get = (o: Line, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v as Line | null)?.[k] ?? null, o);
const KEYS = ["idText", "descriptionText", "psn", "hazardClass", "pg", "technicalName", "quantity.value", "quantity.unit", "grossWeightLb",
  "packageCount", "perPackageWeightLb", "packaging", "hmColumnMark", "marks"];

export interface LineSpec {
  a: Line | null;
  b?: Line | null;
  table?: { consistent: true; hmtRef: string } | { consistent: false; reason: string };
  /** What the OCR row showed for a row-judged key; absent = no OCR. */
  ocr?: Record<string, unknown>;
}

/** A finished read of these lines, each at its index. */
export function read(specs: LineSpec[], over: Partial<ReadResponse> & { otherLines?: string[] } = {}): ReadResponse {
  const evidence: FieldEvidence[] = [];
  const aLines = specs.filter((s) => s.a).map((s) => ({ ...LINE_DEFAULTS, ...s.a }));
  specs.forEach((s, i) => {
    const a = s.a ? { ...LINE_DEFAULTS, ...s.a } : null;
    const b = s.b === undefined ? a : s.b ? { ...LINE_DEFAULTS, ...s.b } : null;
    for (const key of KEYS) {
      const path = `hazmat.lines[${i}].${key}`;
      const av = a ? get(a, key) : undefined;
      const bv = b ? get(b, key) : undefined;
      const sources: FieldEvidence["sources"] = [];
      if (av !== undefined) sources.push({ reader: "passA", page: null, bbox: null, value: av as never });
      if (bv !== undefined) sources.push({ reader: "passB", page: null, bbox: null, value: bv as never });
      if (JUDGED.includes(key) && s.table) sources.push({ reader: "table", page: null, bbox: null, value: s.table as never });
      if (ROW.includes(key) && s.ocr && key in s.ocr) sources.push({ reader: "ocr", page: 1, bbox: null, value: s.ocr[key] as never });
      const nothing = (av ?? null) === null && (bv ?? null) === null;
      evidence.push({ path, value: (av ?? bv ?? null) as never, status: nothing ? "not_read" : "check", sources, ruleVersion: "4" });
    }
  });
  const otherLines = over.otherLines ?? [];
  evidence.push({ path: "otherLines", value: otherLines, status: "check", sources: [], ruleVersion: "4" });
  return {
    id: "00000000-0000-4000-8000-000000000001", sourceId: null, assemblyId: "00000000-0000-4000-8000-000000000002",
    profile: "shipping_document", profileVersion: "1.1.0", status: "done", failureCode: null,
    result: { hazmat: { lines: aLines }, otherLines }, evidence, pages: [], paperAudit: null, ...over,
  } as ReadResponse;
}

export const ok = (hmtRef: string) => ({ consistent: true as const, hmtRef });
