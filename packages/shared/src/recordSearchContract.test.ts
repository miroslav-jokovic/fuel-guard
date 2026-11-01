import { describe, expect, it } from "vitest";
import { recordSearchPattern, recordSearchTerm } from "./recordSearchContract.js";

/** The ⌘K record term (D-SB8): what survives into an `ilike` pattern and a PostgREST `.or()` string. */
describe("recordSearchTerm", () => {
  it("keeps what unit numbers, load numbers and names are made of", () => {
    expect(recordSearchTerm("T-1042")).toBe("T-1042");
    expect(recordSearchTerm("L123.4")).toBe("L123.4");
    expect(recordSearchTerm("O'Neil")).toBe("O'Neil");
    expect(recordSearchTerm("#77")).toBe("#77");
    expect(recordSearchTerm("Đorđe")).toBe("Đorđe");
  });

  it("turns LIKE wildcards and .or() syntax into spaces", () => {
    expect(recordSearchTerm('10%_4,2)(x"\\')).toBe("10 4 2 x");
    expect(recordSearchTerm("a*b:c")).toBe("a b c");
  });

  it("answers null when too little is left to name one record", () => {
    expect(recordSearchTerm("")).toBeNull();
    expect(recordSearchTerm(" 7 ")).toBeNull();
    expect(recordSearchTerm("%%,,")).toBeNull();
  });

  it("caps the length, so a pasted paragraph is not a query", () => {
    expect(recordSearchTerm("x".repeat(500))).toHaveLength(40);
  });

  it("wraps the term for a contains match", () => {
    expect(recordSearchPattern("1042")).toBe("%1042%");
  });
});
