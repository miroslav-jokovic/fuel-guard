import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  TAG_ID_LENGTH,
  TAG_KINDS,
  TAG_VERSION,
  formatTag,
  normalizeTagId,
  parseTag,
} from "./tagContract.js";

describe("parseTag — a supplier barcode is never one of ours", () => {
  /**
   * The whole fall-through in D-INV7 rests on this: the resolve endpoint tries `parseTag` first and
   * treats null as "try it as a UPC". If any of these parsed, a scanned case of oil filters would
   * resolve as an asset instead of a part.
   */
  const supplierCodes = [
    "036000291452", // UPC-A, 12 digits — the shape on most US retail packaging
    "4006381333931", // EAN-13
    "0123456789012", // UPC-A with a leading zero, as many scanners emit it
    "ABC-1234-XYZ", // Code 128 can carry letters too
    "SIL1", // the prefix alone
    "", // an empty decode
  ];

  for (const code of supplierCodes) {
    it(`returns null for ${code || "(empty string)"}`, () => {
      expect(parseTag(code)).toBeNull();
    });
  }

  it("returns null for a future version rather than misreading its fields", () => {
    expect(parseTag("SIL2:AST:7K3M9P")).toBeNull();
  });

  it("returns null for a kind no resolver is registered for", () => {
    expect(parseTag("SIL1:VEH:7K3M9P")).toBeNull();
  });

  it("returns null for an id of the wrong length", () => {
    expect(parseTag("SIL1:AST:7K3M9")).toBeNull();
    expect(parseTag("SIL1:AST:7K3M9PQ")).toBeNull();
  });

  it("returns null for a character outside the Crockford alphabet", () => {
    // U is excluded so no id spells a word, and unlike I/L/O it is not folded — it is just wrong.
    expect(parseTag("SIL1:AST:7K3M9U")).toBeNull();
  });
});

describe("parseTag — round-trips what formatTag prints", () => {
  it("reads back every kind", () => {
    for (const kind of TAG_KINDS) {
      const printed = formatTag(kind, "7K3M9P");
      expect(parseTag(printed)).toEqual({ version: TAG_VERSION, kind, id: "7K3M9P" });
    }
  });

  it("prints the documented shape", () => {
    expect(formatTag("AST", "7K3M9P")).toBe("SIL1:AST:7K3M9P");
    expect(formatTag("BIN", "X4Q2VW")).toBe("SIL1:BIN:X4Q2VW");
  });

  it("refuses to print a tag that could not be scanned back", () => {
    // A bad label is expensive in a way a rejected call is not: it gets laminated onto a truck.
    expect(() => formatTag("AST", "7K3M9")).toThrow(/Crockford/);
    expect(() => formatTag("AST", "7K3M9U")).toThrow(/Crockford/);
  });
});

describe("normalizeTagId — what a person types off a scuffed label", () => {
  it("folds the confusable pairs Crockford removed the letters for", () => {
    // O→0 and I/L→1: the reason the alphabet omits them is that a human reading a greasy
    // label guesses wrong, so the parser has to guess back.
    expect(normalizeTagId("7K3MO9")).toBe("7K3M09");
    expect(normalizeTagId("7K3MI9")).toBe("7K3M19");
    expect(normalizeTagId("7K3ML9")).toBe("7K3M19");
  });

  it("upper-cases, because nobody holds shift for a fallback field", () => {
    expect(normalizeTagId("7k3m9p")).toBe("7K3M9P");
  });

  it("drops the hyphens a person adds when transcribing six characters", () => {
    expect(normalizeTagId("7K3-M9P")).toBe("7K3M9P");
  });

  it("leaves U alone, so a wrong character stays wrong", () => {
    expect(normalizeTagId("7K3M9U")).toBe("7K3M9U");
  });

  it("normalises inside parseTag too, not only at the edges", () => {
    expect(parseTag("sil1:ast:7k3-mo9")).toEqual({
      version: TAG_VERSION,
      kind: "AST",
      id: "7K3M09",
    });
  });
});

describe("the alphabet and the payload budget", () => {
  it("excludes exactly I, L, O and U", () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const excluded of ["I", "L", "O", "U"]) {
      expect(CROCKFORD_ALPHABET).not.toContain(excluded);
    }
  });

  it("keeps the printed payload inside a version-4 QR symbol", () => {
    // §2.4: 24 alphanumeric characters at ECC-H is the version-4 budget, and a bigger symbol on a
    // 1-inch label drops below the ~0.4 mm module floor a phone camera can resolve.
    const longest = formatTag("AST", CROCKFORD_ALPHABET.slice(0, TAG_ID_LENGTH));
    expect(longest.length).toBeLessThanOrEqual(24);
  });
});
