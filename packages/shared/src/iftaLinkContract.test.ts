import { describe, expect, it } from "vitest";
import { IFTA_QUERY_KEYS, iftaQuarterKey, iftaToQuery, parseIftaQuarterKey } from "./iftaLinkContract.js";

describe("the IFTA ledger's URL (F21 R4b)", () => {
  it("writes a quarter as q=YYYY-Qn and reads it back", () => {
    expect(iftaToQuery({ year: 2026, quarter: 3 })).toEqual({ q: "2026-Q3" });
    expect(parseIftaQuarterKey(iftaQuarterKey({ year: 2025, quarter: 4 }))).toEqual({ year: 2025, quarter: 4 });
    expect(IFTA_QUERY_KEYS.quarter).toBe("q");
  });

  it("names no quarter for the page's label, a bare number, or a fifth quarter", () => {
    for (const bad of ["Q3 2026", "3", "2026-Q5", "2026-q3", "", null, undefined]) expect(parseIftaQuarterKey(bad), String(bad)).toBeNull();
    expect(parseIftaQuarterKey(" 2026-Q1 ")).toEqual({ year: 2026, quarter: 1 });
  });
});
