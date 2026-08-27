import { describe, expect, it } from "vitest";
import { loadDataset } from "@hazmat/data";
import { searchProducts } from "./hazmatProducts.js";

/**
 * HMT product lookup (plan H5) — verified against the REAL shipped dataset (2026.07.1), matching the
 * repo pattern (hazmatAnalysis.test.ts). The picker must resolve to canonical `hmtRef`s the engine
 * accepts, and must NOT fuzzy-match numeric queries into look-alike products (resolveHmtLine discipline).
 */
const dataset = loadDataset();
const entries = dataset.entries;

describe("searchProducts — HMT picker lookup", () => {
  it("no query → the curated common-fuel shortlist, gasoline first, flagged isFuelCommon", () => {
    const products = searchProducts(entries, { limit: 50 });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.isFuelCommon)).toBe(true);
    const gas = products.find((p) => p.idNumber === "1203");
    expect(gas).toBeDefined();
    expect(gas!.hmtRef).toBe("UN1203-gasoline#II");
    expect(gas!.idLabel).toBe("UN1203");
    expect(gas!.pg).toBe("II");
    // Gasoline is the first curated ID, so it leads the default set.
    expect(products[0]!.idNumber).toBe("1203");
  });

  it("numeric query matches on ID and yields a canonical hmtRef", () => {
    const products = searchProducts(entries, { q: "1203", limit: 50 });
    expect(products[0]!.hmtRef).toBe("UN1203-gasoline#II");
    expect(products.every((p) => p.idNumber.startsWith("1203"))).toBe(true);
  });

  it("accepts UN-prefixed and spaced ID queries", () => {
    for (const q of ["UN1203", "un 1203", "NA1993"]) {
      const products = searchProducts(entries, { q, limit: 50 });
      expect(products.length).toBeGreaterThan(0);
    }
  });

  it("expands multi-PG entries to one row per packing group", () => {
    const products = searchProducts(entries, { q: "1268", limit: 50 });
    const distillates = products.filter((p) => p.entryId === "UN1268-petroleum-distillates-n-o-s");
    expect(distillates.map((p) => p.pg).sort()).toEqual(["I", "II", "III"]);
    expect(distillates.map((p) => p.hmtRef)).toContain("UN1268-petroleum-distillates-n-o-s#I");
  });

  it("name query matches PSN substrings", () => {
    const products = searchProducts(entries, { q: "gasoline", limit: 50 });
    expect(products.some((p) => p.idNumber === "1203")).toBe(true);
  });

  it("does NOT fuzzy-match: a numeric query only hits IDs, never name digits", () => {
    // "1206" (Heptanes) must not surface 1208 (Hexanes) — exact-substring on ID only.
    const products = searchProducts(entries, { q: "1206", limit: 50 });
    expect(products.every((p) => p.idNumber.startsWith("1206"))).toBe(true);
    expect(products.some((p) => p.idNumber === "1208")).toBe(false);
  });

  it("respects the limit", () => {
    const products = searchProducts(entries, { q: "1", limit: 5 });
    expect(products.length).toBeLessThanOrEqual(5);
  });

  it("unknown product → empty (fail-closed at the source; no free-text products)", () => {
    const products = searchProducts(entries, { q: "zzzznotathing", limit: 50 });
    expect(products).toEqual([]);
  });
});
