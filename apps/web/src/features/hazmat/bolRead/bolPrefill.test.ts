import { describe, expect, it } from "vitest";
import { bolLineView, bolPrefill, fieldNote, hmtRefsOf, type PrefillField } from "./bolPrefill";
import { DIESEL, DIESEL_REF, ok, PAINT, PAINT_REF, product, PRODUCTS, read } from "./bolPrefill.fixtures";

/**
 * A read → the calculator's lines (N6). What must hold: the product is only ever the table's own row for
 * what was printed, nothing becomes *Read* that the evidence did not say, a disagreement between the
 * readers is visible on the field, Limited Quantity takes both readers, and nothing is converted that
 * cannot be converted exactly. The reads are `bolPrefill.fixtures.ts`'s.
 */
describe("bolPrefill", () => {
  it("fills a line from the read, its product the table's own row, every field Check, never Read", () => {
    const p = bolPrefill(read([{ a: DIESEL, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    const line = p.lines[0]!;
    expect(line.form).toMatchObject({
      product: { hmtRef: DIESEL_REF }, packageType: "bulk_cargo", packageCount: "",
      grossWeightValue: "59500", grossWeightUnit: "lb",
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
    expect(p.lines[0]!.fields.packageCount).toMatchObject({ agree: false, readings: [[9, 6]] });
    expect(p.lines[0]!.fields.grossWeight.readings).toEqual([]);
    expect(p.lines[0]!.fields.grossWeight.agree).toBe(true);
    expect(p.lines[0]!.form.packageCount).toBe("9");
  });

  it("judges the package type by what each reader's phrase reads as, and leaves the count to its own field", () => {
    // production read d0f2831a: "2.0000 DRUM" against "2 DRUM" — and wording the same drums two ways
    const decimals = bolPrefill(read([{ a: { ...PAINT, packaging: "6.0000 DRUM" }, b: { ...PAINT, packaging: "6 DRUM" }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(decimals.lines[0]!.fields.packageType).toMatchObject({ agree: true, readings: [] });
    const wording = bolPrefill(read([{ a: { ...PAINT, packaging: "6 Steel Drums" }, b: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(wording.lines[0]!.fields.packageType).toMatchObject({ agree: true, readings: [] });
    const counts = bolPrefill(read([{ a: { ...PAINT, packaging: "9 DRUMS", packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(counts.lines[0]!.fields.packageType.agree).toBe(true);
    expect(counts.lines[0]!.fields.packageCount).toMatchObject({ agree: false, readings: [[9, 6]] });
  });

  it("keeps a package type disputed when the phrases read as different types, or one as none", () => {
    const types = bolPrefill(read([{ a: { ...PAINT, packaging: "6 PAILS" }, b: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(types.lines[0]!.fields.packageType).toMatchObject({ agree: false, readings: [["6 PAILS", "6 DRUMS"]] });
    const unknown = bolPrefill(read([{ a: { ...PAINT, packaging: "5.00 EA" }, b: { ...PAINT, packaging: "1 TOTE" }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(unknown.lines[0]!.fields.packageType.agree).toBe(false);
    // 0134527 and 0133459: two phrases neither of which names a type are two readings, not one
    const neither = bolPrefill(read([{ a: { ...PAINT, packaging: "5.00 EA" }, b: { ...PAINT, packaging: "12" }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(neither.lines[0]!.fields.packageType.agree).toBe(false);
  });

  it("says whether the OCR found the value on the line's row", () => {
    const backed = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { grossWeightLb: 3806, packageCount: null } }]), PRODUCTS, "van")!;
    expect(backed.lines[0]!.fields.grossWeight.rowBacked).toBe(true);
    expect(backed.lines[0]!.fields.packageCount.rowBacked).toBe(false);
    expect(backed.lines[0]!.fields.packageType.rowBacked).toBeNull();
  });

  it("counts a born-digital page's text layer as a row witness, and needs every row witness to back the value", () => {
    const text = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF), textLayer: { grossWeightLb: 3806, packageCount: null } }]), PRODUCTS, "van")!;
    expect(text.lines[0]!.fields.grossWeight.rowBacked).toBe(true);
    expect(text.lines[0]!.fields.packageCount.rowBacked).toBe(false);
    const split = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { grossWeightLb: 3806 }, textLayer: { grossWeightLb: null } }]), PRODUCTS, "van")!;
    expect(split.lines[0]!.fields.grossWeight.rowBacked).toBe(false);
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

  it("fills no quantity, which the form does not show, and keeps reading it for template lines", () => {
    const p = bolPrefill(read([{ a: DIESEL, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    expect(p.lines[0]!.form.quantityValue).toBe("");
    expect(Object.keys(p.lines[0]!.fields)).not.toContain("quantity");
    const onlyQuantity = { idText: "UN1203", quantity: { value: 55, unit: "gal" } };
    expect(bolPrefill(read([{ a: onlyQuantity }]), PRODUCTS, "van")!.notLoaded).toEqual([]);
  });

  it("keeps the equipment's package type for a phrase it does not know, saying why", () => {
    const p = bolPrefill(read([{ a: { ...DIESEL, packaging: "1 TT" }, table: ok(DIESEL_REF) }]), PRODUCTS, "tanker")!;
    expect(p.lines[0]!.form.packageType).toBe("bulk_cargo");
    expect(p.lines[0]!.fields.packageType.reason).toMatch(/"1 TT"/);
    expect(bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!.form.packageType).toBe("drum");
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

  it("lists the non-hazmat rows a 1.3.0 read records one by one, a row only the second reader saw included", () => {
    const r = read([], { otherLines: [] });
    const row = (i: number, value: string, readers: ("passA" | "passB")[]) => ({
      path: `otherLines[${i}].description`, value, status: "check" as const, ruleVersion: "7",
      sources: readers.map((reader) => ({ reader, page: null, bbox: null, value })),
    });
    const rows = { ...r, result: { hazmat: { lines: [] }, otherLines: [{ description: "Not Regulated" }] },
      evidence: [...r.evidence.filter((e) => e.path !== "otherLines"), row(1, "Pails, empty", ["passB"]), row(0, "Not Regulated", ["passA", "passB"])] };
    const p = bolPrefill(rows, PRODUCTS, "van")!;
    expect(p.otherLines).toEqual(["Not Regulated", "Pails, empty"]);
    expect(p.otherFreight).toBe("yes");
  });

  it("is Not read only where every part of the field is, and Check without evidence", () => {
    const p = bolPrefill(read([{ a: { ...PAINT, packaging: null }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!;
    expect(p.lines[0]!.fields.packageType.state).toBe("not_read");
    expect(bolPrefill(read([{ a: { ...PAINT, packageCount: null }, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!.form.packageCount).toBe("");
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

describe("fieldNote — the line under a filled field", () => {
  const f = (over: Partial<PrefillField>): PrefillField => ({ state: "check", agree: true, readings: [], rowBacked: null, sumBacked: null, witnessed: null, reason: null, paths: [], ...over });

  it("asks a person to look where the readers disagree, naming both readings", () => {
    expect(fieldNote(f({ agree: false, readings: [[9, 6], [3808, 3806]] }), false))
      .toEqual({ text: "The two readers disagree: 9 or 6; 3,808 or 3,806. Check the page.", tone: "warning" });
    expect(fieldNote(f({ agree: false, readings: [[null, ["LTD QTY"]]] }), false).text).toBe("The two readers disagree: nothing or LTD QTY. Check the page.");
    expect(fieldNote(f({ agree: false, readings: [[[], ["LTD QTY"]]] }), false).text).toBe("The two readers disagree: nothing or LTD QTY. Check the page.");
  });

  it("asks a person to look where only one reader read it, or where the field carries a reason", () => {
    expect(fieldNote(f({ agree: null }), false).tone).toBe("warning");
    expect(fieldNote(f({ reason: "Choose the product." }), false)).toEqual({ text: "Choose the product.", tone: "warning" });
  });

  it("only says where an agreed value came from, with the OCR's word when it found it", () => {
    expect(fieldNote(f({}), false)).toEqual({ text: "From the BOL · both readers agree", tone: "neutral" });
    expect(fieldNote(f({ rowBacked: true }), false).text).toBe("From the BOL · both readers agree · found on the line's printed row");
    expect(fieldNote(f({ rowBacked: true, sumBacked: true }), false).text).toBe("From the BOL · both readers agree · found on the line's printed row · adds up to the BOL's total");
    expect(fieldNote(f({ sumBacked: false }), false)).toMatchObject({ tone: "warning", text: expect.stringMatching(/do not add up to its printed total/) });
    expect(fieldNote(f({ state: "not_read", agree: true }), false).text).toMatch(/^Not read on the BOL/);
    expect(fieldNote(f({ state: "read" }), false)).toEqual({ text: "Read from the BOL.", tone: "success" });
  });

  it("stops describing the reader's value once a person changed it", () => {
    expect(fieldNote(f({ agree: false, readings: [[9, 6]] }), true)).toEqual({ text: "Changed by you.", tone: "neutral" });
  });
});

describe("bolLineView", () => {
  it("marks exactly the field a person changed, against the read's own values", () => {
    const line = bolPrefill(read([{ a: PAINT, table: ok(PAINT_REF) }]), PRODUCTS, "van")!.lines[0]!;
    const current = { ...line.form };
    expect(Object.values(bolLineView(line, current).fields).map((n) => n.text)).not.toContain("Changed by you.");
    current.packageCount = "5";
    const after = bolLineView(line, current).fields;
    expect(after.packageCount.text).toBe("Changed by you.");
    expect(after.grossWeight.text).not.toBe("Changed by you.");
    current.grossWeightUnit = "kg";
    current.product = product(DIESEL_REF);
    current.isLimitedQuantity = true;
    current.packageType = "box";
    expect(Object.values(bolLineView(line, current).fields).every((n) => n.text === "Changed by you.")).toBe(true);
    expect(bolLineView(line, current).printed).toBe("UN1263, PAINT, 3, II");
  });
});
