import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

/**
 * These files leave the product. The carrier opens them in Excel and forwards them to Pilot, so the
 * two things that matter are that a value survives the round trip intact and that no value is ever
 * executed as a formula on the way.
 */
describe("toCsv", () => {
  it("quotes only what needs quoting, and doubles embedded quotes", () => {
    expect(toCsv(["a", "b"], [["plain", "has,comma"]])).toBe('a,b\r\nplain,"has,comma"');
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\r\n"say ""hi"""');
    expect(toCsv(["a"], [["two\nlines"]])).toBe('a\r\n"two\nlines"');
  });

  it("renders null and undefined as an empty cell, not the word", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, 0]])).toBe("a,b,c\r\n,,0");
  });

  it("neutralises a value a spreadsheet would treat as a formula", () => {
    // Site names and the P.O. field are vendor free text; a cell starting `=` executes on open.
    for (const dangerous of ["=1+1", "@SUM(A1)", "+CMD", "-cmd|'/c calc'"]) {
      expect(toCsv(["v"], [[dangerous]])).toBe(`v\r\n'${dangerous}`);
    }
  });

  it("leaves numbers alone — including negatives, so a column still sums", () => {
    // The naive guard neutralises `-12.50` as well, which turns every negative dollar figure in these
    // exports into text and defeats the reason anyone downloads a CSV.
    expect(toCsv(["v"], [[-12.5]])).toBe("v\r\n-12.5");
    expect(toCsv(["v"], [["-0.1731"]])).toBe("v\r\n-0.1731");
    expect(toCsv(["v"], [["+1.5"]])).toBe("v\r\n+1.5");
  });

  it("uses CRLF between rows, which is what RFC 4180 and Excel expect", () => {
    expect(toCsv(["a"], [["1"], ["2"]])).toBe("a\r\n1\r\n2");
  });
});
