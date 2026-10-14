import { describe, expect, it } from "vitest";
import { reviewEntrySchema } from "@silvicom/shared";
import { bolLineView, bolPrefill, type PrefillKey, type PrefillLine } from "./bolPrefill";
import { DIESEL, DIESEL_REF, ok, PAINT, PAINT_REF, product, PRODUCTS, read } from "./bolPrefill.fixtures";
import { fieldNeedsAct, pendingCount, readingChoices, reviewEntries, type Acted } from "./bolReview";

/**
 * D-DR24: a field the evidence disputes stops Calculate until a person acts on it, and every Calculate
 * records what was sent — `confirmed` or `corrected` against what pass A wrote, `explicit` only where a
 * person acted. The reads are `bolPrefill.fixtures.ts`'s.
 */
const fill = (r: ReturnType<typeof read>, equipment = "van") => {
  const p = bolPrefill(r, PRODUCTS, equipment)!;
  return { r, lines: p.lines.map((prefill) => ({ prefill, current: { ...prefill.form } })) };
};
const actedOn = (prefill: PrefillLine, ...keys: PrefillKey[]): Acted => new Map([[prefill, new Set(keys)]]);
const NONE: Acted = new Map();

describe("which fields stop Calculate", () => {
  it("none, when both readers agree and the OCR row backs the count and weight", () => {
    const { lines } = fill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { packageCount: 6, grossWeightLb: 3806 } }]));
    expect(pendingCount(lines, NONE)).toBe(0);
  });

  it("a count the readers read as 9 and 6 — and a pick or a tick settles it", () => {
    const { lines } = fill(read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]));
    const { prefill, current } = lines[0]!;
    expect(fieldNeedsAct(prefill.fields.packageCount)).toBe(true);
    expect(pendingCount(lines, NONE)).toBe(1);
    expect(readingChoices(prefill.fields.packageCount, "packageCount")).toEqual([9, 6]);
    expect(pendingCount(lines, actedOn(prefill, "packageCount"))).toBe(0);
    current.packageCount = "6";
    expect(pendingCount(lines, NONE)).toBe(0); // changing it is an act too
  });

  it("a value only one reader read, and a weight the OCR row looked for and did not find", () => {
    const one = fill(read([{ a: PAINT, b: { ...PAINT, grossWeightLb: null }, table: ok(PAINT_REF) }]));
    expect(pendingCount(one.lines, NONE)).toBe(1);
    const ocr = fill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { grossWeightLb: 3808 } }]));
    expect(ocr.lines[0]!.prefill.fields.grossWeight.rowBacked).toBe(false);
    expect(pendingCount(ocr.lines, NONE)).toBe(1);
  });

  it("a line with no product, which a tick cannot settle — it would leave the calculation unseen", () => {
    const { lines } = fill(read([{ a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }]));
    const { prefill, current } = lines[0]!;
    expect(pendingCount(lines, actedOn(prefill, "product"))).toBe(1);
    current.product = product(PAINT_REF);
    expect(pendingCount(lines, NONE)).toBe(0);
  });

  it("a Limited Quantity notation only one reader read", () => {
    const { lines } = fill(read([{ a: { ...PAINT, marks: ["LTD QTY"] }, b: PAINT, table: ok(PAINT_REF) }]));
    expect(lines[0]!.current.isLimitedQuantity).toBe(false);
    expect(pendingCount(lines, NONE)).toBe(1);
    expect(pendingCount(lines, actedOn(lines[0]!.prefill, "limitedQuantity"))).toBe(0);
  });

  it("nothing for a field neither reader read: there is no value to vouch for", () => {
    const { lines } = fill(read([{ a: { ...PAINT, packageCount: null }, table: ok(PAINT_REF), ocr: { grossWeightLb: 3806 } }]));
    expect(lines[0]!.prefill.fields.packageCount.state).toBe("not_read");
    expect(pendingCount(lines, NONE)).toBe(0);
  });
});

describe("what the field says while it waits", () => {
  it("offers the two readings and 'Matches the page'; after the act it says who checked it", () => {
    const { lines } = fill(read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]));
    const { prefill, current } = lines[0]!;
    expect(bolLineView(prefill, current).fields.packageCount).toMatchObject({ pending: true, confirmable: true, choices: [9, 6], tone: "warning" });
    const after = bolLineView(prefill, current, actedOn(prefill, "packageCount")).fields.packageCount;
    expect(after).toMatchObject({ text: "Checked against the page by you.", tone: "neutral" });
    expect(after.pending).toBeUndefined();
  });

  it("offers no 'Matches the page' on a line with no product", () => {
    const { lines } = fill(read([{ a: { ...PAINT, idText: "5503615" }, table: { consistent: false, reason: "id_not_found" } }]));
    expect(bolLineView(lines[0]!.prefill, lines[0]!.current).fields.product).toMatchObject({ pending: true, confirmable: false });
  });
});

describe("the review a Calculate press records", () => {
  it("an untouched agreed line: every path confirmed against pass A, none explicit", () => {
    const { r, lines } = fill(read([{ a: PAINT, table: ok(PAINT_REF), ocr: { packageCount: 6, grossWeightLb: 3806 } }]));
    const entries = reviewEntries(r.result, lines, NONE);
    expect(entries.map((e) => [e.path, e.action, e.explicit])).toEqual([
      ["hazmat.lines[0].idText", "confirmed", false],
      ["hazmat.lines[0].psn", "confirmed", false],
      ["hazmat.lines[0].hazardClass", "confirmed", false],
      ["hazmat.lines[0].pg", "confirmed", false],
      ["hazmat.lines[0].packageCount", "confirmed", false],
      ["hazmat.lines[0].grossWeightLb", "confirmed", false],
    ]);
    for (const e of entries) {
      expect(e.newValue).toEqual(e.oldValue);
      expect(reviewEntrySchema.safeParse(e).success).toBe(true);
    }
  });

  it("a disputed count the person corrected: corrected from pass A's 9 to 6, explicit", () => {
    const { r, lines } = fill(read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]));
    lines[0]!.current.packageCount = "6";
    const count = reviewEntries(r.result, lines, NONE).find((e) => e.path.endsWith("packageCount"));
    expect(count).toEqual({ path: "hazmat.lines[0].packageCount", action: "corrected", oldValue: 9, newValue: 6, explicit: true });
  });

  it("a disputed count the person ticked as pass A's: confirmed, explicit", () => {
    const { r, lines } = fill(read([{ a: { ...PAINT, packageCount: 9 }, b: PAINT, table: ok(PAINT_REF) }]));
    const count = reviewEntries(r.result, lines, actedOn(lines[0]!.prefill, "packageCount")).find((e) => e.path.endsWith("packageCount"));
    expect(count).toMatchObject({ action: "confirmed", oldValue: 9, newValue: 9, explicit: true });
  });

  it("a weight entered in kg is recorded in pounds, the path's own unit", () => {
    const { r, lines } = fill(read([{ a: PAINT, table: ok(PAINT_REF) }]));
    Object.assign(lines[0]!.current, { grossWeightValue: "1000", grossWeightUnit: "kg" });
    const w = reviewEntries(r.result, lines, NONE).find((e) => e.path.endsWith("grossWeightLb"))!;
    expect(w).toMatchObject({ action: "corrected", oldValue: 3806, explicit: true });
    expect(w.newValue).toBeCloseTo(2204.62, 1);
  });

  it("a product the person chose instead: printed text the choice also prints is confirmed, the rest corrected", () => {
    const { r, lines } = fill(read([{ a: PAINT, table: ok(PAINT_REF) }]));
    lines[0]!.current.product = { ...product(DIESEL_REF), idLabel: "UN1263", psn: "Diesel fuel", hazardClass: "3", pg: "III" };
    const byPath = Object.fromEntries(reviewEntries(r.result, lines, NONE).map((e) => [e.path.split(".").pop(), e]));
    expect(byPath.idText).toMatchObject({ action: "confirmed", explicit: true });
    expect(byPath.hazardClass).toMatchObject({ action: "confirmed", explicit: true });
    expect(byPath.psn).toMatchObject({ action: "corrected", oldValue: "PAINT", newValue: "Diesel fuel", explicit: true });
    expect(byPath.pg).toMatchObject({ action: "corrected", oldValue: "II", newValue: "III" });
  });

  it("a line only the second reader saw: kept as read, it corrects pass A's nothing", () => {
    const { r, lines } = fill(read([{ a: PAINT, table: ok(PAINT_REF) }, { a: null, b: DIESEL, table: ok(DIESEL_REF) }], ), "tanker");
    const second = reviewEntries(r.result, lines, NONE).filter((e) => e.path.startsWith("hazmat.lines[1]."));
    expect(second.find((e) => e.path.endsWith("idText"))).toMatchObject({ action: "corrected", oldValue: null });
    expect(second.every((e) => reviewEntrySchema.safeParse(e).success)).toBe(true);
  });

  it("no count for a tank, whose count the form neither shows nor sends", () => {
    const { r, lines } = fill(read([{ a: DIESEL, table: ok(DIESEL_REF) }]), "tanker");
    expect(reviewEntries(r.result, lines, NONE).some((e) => e.path.endsWith("packageCount"))).toBe(false);
  });
});
