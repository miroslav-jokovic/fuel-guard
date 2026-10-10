import { describe, expect, it } from "vitest";
import { readCacheKey, type CacheKeyInput } from "./cacheKey.js";

/** §4 item 6 (F-EX10): each term, changed ALONE, gives a different key. */
const BASE: CacheKeyInput = {
  profileVersion: "1.1.0",
  models: ["claude-sonnet-4-6"],
  promptVersion: "shipping_document-1.0.0",
  schemaHash: "a".repeat(64),
  acceptanceRule: "none",
  pages: [{ sha256: "b".repeat(64), normaliserVersion: "1.0.0" }, { sha256: "c".repeat(64), normaliserVersion: "1.0.0" }],
  sendRule: "1",
  reviewEpoch: 0,
};

describe("readCacheKey", () => {
  it("is stable for the same inputs", () => {
    expect(readCacheKey(BASE)).toBe(readCacheKey({ ...BASE, pages: [...BASE.pages] }));
    expect(readCacheKey(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any one term changes — including a review, so a corrected read is never replayed", () => {
    const variants: Partial<CacheKeyInput>[] = [
      { profileVersion: "1.2.0" },
      { models: ["claude-sonnet-5-5"] },
      { promptVersion: "shipping_document-1.0.1" },
      { schemaHash: "d".repeat(64) },
      { acceptanceRule: "2.5.0" },
      { pages: [BASE.pages[0]!] },
      { pages: [BASE.pages[1]!, BASE.pages[0]!] },
      { pages: [{ ...BASE.pages[0]!, normaliserVersion: "1.1.0" }, BASE.pages[1]!] },
      { sendRule: "2" },
      { reviewEpoch: 1 },
    ];
    const keys = new Set([readCacheKey(BASE), ...variants.map((v) => readCacheKey({ ...BASE, ...v }))]);
    expect(keys.size).toBe(variants.length + 1);
  });

  it("refuses a term holding a newline, which could forge another key's line", () => {
    expect(() => readCacheKey({ ...BASE, promptVersion: "x\nmodels=y" })).toThrow(/prompt/);
  });
});
