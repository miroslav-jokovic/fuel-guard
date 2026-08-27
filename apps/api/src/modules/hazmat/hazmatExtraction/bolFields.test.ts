import { describe, expect, it } from "vitest";
import { classifyLineLoadState, normalizeUnit, pageComplete, parseBolFields, type BolLineFields } from "./bolFields.js";

const line = (over: Partial<BolLineFields> = {}): BolLineFields =>
  parseBolFields({ lines: [over] }).lines[0]!;

describe("bolFields — unit normalization", () => {
  it("maps printed unit spellings to the engine's closed set", () => {
    expect(normalizeUnit("Gallons")).toBe("gal");
    expect(normalizeUnit("gal.")).toBe("gal");
    expect(normalizeUnit("LBS")).toBe("lb");
    expect(normalizeUnit("liters")).toBe("L");
    expect(normalizeUnit("kg")).toBe("kg");
  });
  it("returns null for an unrecognized unit (→ fail-closed at the mapper)", () => {
    expect(normalizeUnit("barrels")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
  });
});

describe("bolFields — pre-printed catalog classification (step 4c2)", () => {
  it("no quantity, no count, no weight → dormant template line", () => {
    expect(classifyLineLoadState(line({ idText: "UN1263", psn: "Paint" }))).toBe("preprinted_not_loaded");
  });
  it("a bulk quantity present → loaded", () => {
    expect(classifyLineLoadState(line({ quantity: { value: 8000, unit: "gal" } }))).toBe("loaded");
  });
  it("count AND weight → loaded", () => {
    expect(classifyLineLoadState(line({ packageCount: 2, grossWeightLb: 1254 }))).toBe("loaded");
  });
  it("count without weight (or vice versa) → partial (a normal flag)", () => {
    expect(classifyLineLoadState(line({ packageCount: 2 }))).toBe("partial");
    expect(classifyLineLoadState(line({ grossWeightLb: 500 }))).toBe("partial");
  });
});

describe("bolFields — page completeness", () => {
  it("single page / no marker → complete", () => {
    expect(pageComplete(parseBolFields({ pageInfo: { page: 1, of: 1 } }))).toBe(true);
    expect(pageComplete(parseBolFields({}))).toBe(true);
  });
  it("multi-page set missing pages → incomplete", () => {
    expect(pageComplete(parseBolFields({ pageInfo: { page: 1, of: 3 } }))).toBe(false);
    expect(pageComplete(parseBolFields({ pageInfo: { page: 3, of: 3 } }))).toBe(true);
  });
});
