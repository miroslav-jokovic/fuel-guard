import { describe, expect, it } from "vitest";
import { lastIncludedDay, wholeMonthBound } from "./ledgerPeriod.js";

/** Every accounting window is half-open; the month-grained reads widen from its last day (Q-AI10). */
describe("lastIncludedDay / wholeMonthBound", () => {
  it("July's exclusive bound is 08-01: its last day is 07-31 and its months end at 08-01, not 09-01", () => {
    expect(lastIncludedDay("2026-08-01")).toBe("2026-07-31");
    expect(wholeMonthBound("2026-08-01")).toBe("2026-08-01");
  });
  it("a mid-month bound widens to the end of the month its last day is in", () => {
    expect(wholeMonthBound("2026-07-15")).toBe("2026-08-01");
  });
  it("crosses a year and a short February", () => {
    expect(lastIncludedDay("2027-01-01")).toBe("2026-12-31");
    expect(wholeMonthBound("2027-01-01")).toBe("2027-01-01");
    expect(lastIncludedDay("2028-03-01")).toBe("2028-02-29");
  });
});
