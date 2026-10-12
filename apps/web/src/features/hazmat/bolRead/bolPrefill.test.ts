import { describe, expect, it } from "vitest";
import type { FieldEvidence, HazmatProduct, ReadResponse } from "@silvicom/shared";
import { bolPrefill, hmtRefsOf } from "./bolPrefill";

/**
 * A read → the calculator's lines (N6). What must hold: the product is only ever the table's own row for
 * what was printed, nothing becomes *Read* that the evidence did not say, a disagreement between the
 * readers is visible on the field, Limited Quantity takes both readers, and nothing is converted that
 * cannot be converted exactly. The evidence is built the way `shippingEvidence.ts` records it.
 */
type Line = Record<string, unknown>;
const LINE_DEFAULTS: Line = {
  idText: null, descriptionText: null, psn: null, hazardClass: null, pg: null, technicalName: null,
  quantity: { value: null, unit: null }, grossWeightLb: null, packageCount: null, perPackageWeightLb: null,
  packaging: null, hmColumnMark: null, marks: [],
};
const DIESEL: Line = {
  idText: "NA1993", descriptionText: "NA1993, Diesel fuel, Combustible liquid, PG III", psn: "Diesel fuel", hazardClass: "3", pg: "III",
  quantity: { value: 8500, unit: "GAL" }, grossWeightLb: 59500, packageCount: 1, packaging: "1 cargo tank",
};
const PAINT: Line = {
  idText: "UN1263", psn: "PAINT", hazardClass: "3", pg: "II", quantity: { value: null, unit: null },
  grossWeightLb: 3806, packageCount: 6, packaging: "6 DRUMS",
};
const DIESEL_REF = "NA1993-diesel-fuel#III";
const PAINT_REF = "UN1263-paint#II";
const product = (hmtRef: string): HazmatProduct => ({
  hmtRef, entryId: hmtRef.split("#")[0]!, idPrefix: "UN", idNumber: "0000", idLabel: hmtRef, psn: hmtRef, hazardClass: "3",
  subsidiaryClasses: [], pg: "II", symbols: [], label: hmtRef, isFuelCommon: false, isMarinePollutant: false, marinePollutantSevere: null,
});
const PRODUCTS = [product(DIESEL_REF), product(PAINT_REF)];

const JUDGED = ["idText", "psn", "hazardClass", "pg"];
const ROW = ["packageCount", "grossWeightLb", "quantity.value"];
const get = (o: Line, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v as Line | null)?.[k] ?? null, o);
const KEYS = ["idText", "descriptionText", "psn", "hazardClass", "pg", "technicalName", "quantity.value", "quantity.unit", "grossWeightLb",
  "packageCount", "perPackageWeightLb", "packaging", "hmColumnMark", "marks"];

interface LineSpec {
  a: Line | null;
  b?: Line | null;
  table?: { consistent: true; hmtRef: string } | { consistent: false; reason: string };
  /** What the OCR row showed for a row-judged key; absent = no OCR. */
  ocr?: Record<string, unknown>;
}

/** Evidence for each line at its index, as shippingEvidence.ts writes it under rule 4. */
function read(specs: LineSpec[], over: Partial<ReadResponse> & { otherLines?: string[] } = {}): ReadResponse {
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
    result: { hazmat: { lines: aLines }, otherLines }, evidence, pages: [], ...over,
  } as ReadResponse;
}

const ok = (hmtRef: string) => ({ consistent: true as const, hmtRef });

describe("bolPrefill", () => {
  it("fills a line from the read, its product the table's own row, every field Check, never Read", () => {
    const p = bolPrefill(read([{ a: DIESEL, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    const line = p.lines[0]!;
    expect(line.form).toMatchObject({
      product: { hmtRef: DIESEL_REF }, packageType: "bulk_cargo", packageCount: "1",
      quantityValue: "8500", quantityUnit: "gal", grossWeightValue: "59500", grossWeightUnit: "lb",
      isLimitedQuantity: false, reclassedCombustible: false,
    });
    expect(Object.values(line.fields).map((f) => f.state)).not.toContain("read");
    expect(line.fields.product).toMatchObject({ state: "check", agree: true, reason: null });
    expect(line.printed).toBe("NA1993, Diesel fuel, Combustible liquid, PG III");
  });

  it("leaves the product empty, with the table's reason, when the table refused the line", () => {
    const p = bolPrefill(read([{ a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }]), PRODUCTS, "van")!;
    expect(p.lines[0]!.form.product).toBeNull();
    expect(p.lines[0]!.fields.product.reason).toBe("The UN/NA number is not in the Hazardous Materials Table.");
  });

  it("leaves the product empty when the calculator's dataset does not hold the table's row", () => {
    const p = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }]), [product(DIESEL_REF)], "van")!;
    expect(p.lines[0]!.form.product).toBeNull();
    expect(p.lines[0]!.fields.product.reason).toMatch(/dataset does not hold/);
  });

  it("shows a disagreement between the readers on the field it concerns, and only there", () => {
    const p = bolPrefill(read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(p.lines[0]!.fields.packageCount.agree).toBe(false);
    expect(p.lines[0]!.fields.grossWeight.agree).toBe(true);
    expect(p.lines[0]!.form.packageCount).toBe("9");
  });

  it("says whether the OCR found the value on the line's row", () => {
    const backed = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { grossWeightLb: 3806, packageCount: null } }]), PRODUCTS, "van")!;
    expect(backed.lines[0]!.fields.grossWeight.ocrBacked).toBe(true);
    expect(backed.lines[0]!.fields.packageCount.ocrBacked).toBe(false);
    expect(backed.lines[0]!.fields.packageType.ocrBacked).toBeNull();
  });

  it("ticks Limited Quantity only when both readers read the notation", () => {
    const lq = { ...PAINT, marks: ["LTD QTY"] };
    expect(bolPrefill(read([{ a: lq, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!.form.isLimitedQuantity).toBe(true);
    const one = bolPrefill(read([{ a: lq, b: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!;
    expect(one.form.isLimitedQuantity).toBe(false);
    expect(one.fields.limitedQuantity).toMatchObject({ agree: false, reason: expect.stringMatching(/Only one reader/) });
    // Worded differently by each reader, it is still one answer: both read Limited Quantity.
    const worded = bolPrefill(read([{ a: lq, b: { ...PAINT, marks: ["LIMITED QUANTITY"] }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!;
    expect(worded.form.isLimitedQuantity).toBe(true);
    expect(worded.fields.limitedQuantity).toMatchObject({ agree: true, reason: null });
  });

  it("leaves a quantity in a unit the calculator does not take blank, saying why", () => {
    const p = bolPrefill(read([{ a: { ...DIESEL, quantity: { value: 32, unit: "BBL" } }, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    expect(p.lines[0]!.form.quantityValue).toBe("");
    expect(p.lines[0]!.fields.quantity.reason).toMatch(/"BBL"/);
  });

  it("keeps the equipment's package type for a phrase it does not know, saying why", () => {
    const p = bolPrefill(read([{ a: { ...DIESEL, packaging: "1 TT" }, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    expect(p.lines[0]!.form.packageType).toBe("bulk_cargo");
    expect(p.lines[0]!.fields.packageType.reason).toMatch(/"1 TT"/);
    // Drums on a dry van: the type is the paper's, and a blank quantity takes the drum's unit, not the van's.
    expect(bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!.form).toMatchObject({ packageType: "drum", quantityUnit: "gal" });
  });

  it("leaves out a pre-printed line with no count, weight or quantity, and lists it", () => {
    const template = { idText: "UN1993", psn: "Flammable liquid, n.o.s.", hazardClass: "3", pg: "III" };
    const p = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }, { a: template }]), PRODUCTS, "van")!;
    expect(p.lines.map((l) => l.index)).toEqual([0]);
    expect(p.notLoaded).toEqual(["UN1993, Flammable liquid, n.o.s., 3, III"]);
  });

  it("brings in a line only the second reader saw, saying so", () => {
    const p = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }, { a: null, b: DIESEL, table: ok(DIESEL_REF) }]), PRODUCTS, "van")!;
    expect(p.lines.map((l) => l.form.product?.hmtRef)).toEqual([PAINT_REF, DIESEL_REF]);
    expect(p.lines[1]!.notes).toContain("Only one of the two readers saw this line. Check it against the page.");
    expect(p.lines[1]!.fields.product.agree).toBeNull();
  });

  it("notes a printed Combustible liquid and leaves the election to a person", () => {
    const p = bolPrefill(read([{ a: { ...DIESEL, hazardClass: "Combustible liquid" }, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    expect(p.lines[0]!.form.reclassedCombustible).toBe(false);
    expect(p.lines[0]!.notes.join(" ")).toMatch(/§173\.150\(f\)/);
  });

  it("says other freight rides along only when the paper lists it", () => {
    expect(bolPrefill(read([{ a: PAINT }], { otherLines: ["Paper products"] }), PRODUCTS, "van")!.otherFreight).toBe("yes");
    expect(bolPrefill(read([{ a: PAINT }]), PRODUCTS, "van")!.otherFreight).toBe("");
  });

  it("is Not read only where every part of the field is, and Check without evidence", () => {
    const p = bolPrefill(read([{ a: { ...PAINT, packaging: null }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(p.lines[0]!.fields.packageType.state).toBe("not_read");
    expect(p.lines[0]!.fields.product.state).toBe("check");
    const bare = { ...read([{ a: PAINT }]), evidence: [] };
    expect(bolPrefill(bare, PRODUCTS, "van")!.lines[0]!.fields.grossWeight).toMatchObject({ state: "check", agree: null });
  });

  it("is Read only where every legible part of the field is Read", () => {
    const r = read([{ a: PAINT, table: ok(PAINT_REF) }]);
    const graduated = (paths: string[]) => ({ ...r, evidence: r.evidence.map((e) => (paths.includes(e.path) ? { ...e, status: "read" as const } : e)) });
    const all = ["idText", "psn", "hazardClass", "pg"].map((k) => `hazmat.lines[0].${k}`);
    expect(bolPrefill(graduated(all), PRODUCTS, "van")!.lines[0]!.fields.product.state).toBe("read");
    expect(bolPrefill(graduated(all.slice(1)), PRODUCTS, "van")!.lines[0]!.fields.product.state).toBe("check");
  });

  it("answers nothing for an unfinished read, and asks for each table row once", () => {
    expect(bolPrefill({ ...read([{ a: PAINT }]), status: "reading" }, PRODUCTS, "van")).toBeNull();
    expect(hmtRefsOf(read([{ a: PAINT, table: ok(PAINT_REF) }, { a: PAINT, table: ok(PAINT_REF) }, { a: DIESEL, table: { consistent: false, reason: "x" } }])))
      .toEqual([PAINT_REF]);
  });
});
