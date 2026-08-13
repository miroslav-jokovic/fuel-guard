import { describe, expect, it } from "vitest";
import { compareSealedKeyIds } from "./backfillEfsSoapPasswords.js";

const envelope = (keyId: string): string => `v1.${keyId}.iv.tag.ciphertext`;

describe("compareSealedKeyIds", () => {
  it("accepts when every stored envelope carries the current key id", () => {
    expect(compareSealedKeyIds("current1", [envelope("current1"), envelope("current1")])).toEqual({
      currentKeyId: "current1",
      keyIds: [{ keyId: "current1", count: 2 }],
      sealedCount: 2,
      hasAnchor: true,
      ok: true,
    });
  });

  it("refuses when any stored envelope carries a different key id", () => {
    const verdict = compareSealedKeyIds("current1", [envelope("current1"), envelope("previous1")]);
    expect(verdict.ok).toBe(false);
    expect(verdict.keyIds).toEqual([
      { keyId: "current1", count: 1 },
      { keyId: "previous1", count: 1 },
    ]);
  });

  it("reports no anchor when nothing sealed exists", () => {
    expect(compareSealedKeyIds("current1", [null, undefined, ""])).toEqual({
      currentKeyId: "current1",
      keyIds: [],
      sealedCount: 0,
      hasAnchor: false,
      ok: true,
    });
  });
});
