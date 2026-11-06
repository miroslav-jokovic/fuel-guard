import { describe, expect, it } from "vitest";
import { parsePrintedDate } from "./index.js";

describe("parsePrintedDate (PI3)", () => {
  it.each([
    ["03/01/2019", "2019-03-01"],
    ["3/1/2019", "2019-03-01"],
    ["3-1-19", "2019-03-01"],
    ["03.01.2019", "2019-03-01"],
    ["2019-03-01", "2019-03-01"],
    ["March 1, 2019", "2019-03-01"],
    ["Mar. 1 2019", "2019-03-01"],
    ["1 March 2019", "2019-03-01"],
    ["01-Mar-2019", "2019-03-01"],
    ["  12/31/68 ", "1968-12-31"],
    ["06/30/27", "2027-06-30"],
  ])("reads %s as %s, month first", (printed, expected) => {
    expect(parsePrintedDate(printed)).toBe(expected);
  });

  it.each([["02/30/2026"], ["13/01/2026"], ["Smarch 1, 2019"], [""], ["N/A"], ["2026"], ["06/2027"]])("refuses %s rather than guessing", (printed) => {
    expect(parsePrintedDate(printed)).toBeNull();
  });

  it("treats a missing value as no date", () => {
    expect(parsePrintedDate(null)).toBeNull();
    expect(parsePrintedDate(undefined)).toBeNull();
  });
});
