import { describe, it, expect } from "vitest";
import { fleetReportToQuery } from "@silvicom/shared";
import {
  canStepForward,
  latestReportableMonth,
  periodAtGrain,
  periodForCustom,
  periodForMonth,
  periodForQuarter,
  periodForYtd,
  periodFromLink,
  periodLabel,
  shiftMonth,
  stepPeriod,
} from "./reportPeriod";

/**
 * The period arithmetic behind the fleet report's rail (D-FRUI1). Every case is a month boundary a
 * reader will actually cross — the year end, a quarter edge, February — because those are where a
 * hand-written date window goes wrong by one day and the report reads low without saying so.
 */
describe("reportPeriod", () => {
  it("builds a month as inclusive first and last days, February included", () => {
    expect(periodForMonth("2026-07")).toEqual({ grain: "month", from: "2026-07-01", to: "2026-07-31" });
    expect(periodForMonth("2026-02")).toEqual({ grain: "month", from: "2026-02-01", to: "2026-02-28" });
    expect(periodForMonth("2028-02").to).toBe("2028-02-29");
  });

  it("shifts a month across the year end in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-07", -7)).toBe("2025-12");
  });

  it("builds the quarter holding any of its months", () => {
    for (const key of ["2026-07", "2026-08", "2026-09"]) {
      expect(periodForQuarter(key)).toEqual({ grain: "quarter", from: "2026-07-01", to: "2026-09-30" });
    }
    expect(periodForQuarter("2026-12")).toEqual({ grain: "quarter", from: "2026-10-01", to: "2026-12-31" });
  });

  it("builds the year to the end of a month", () => {
    expect(periodForYtd("2026-07")).toEqual({ grain: "ytd", from: "2026-01-01", to: "2026-07-31" });
  });

  it("widens a custom range to whole months and rights a reversed one", () => {
    expect(periodForCustom("2026-03-15", "2026-07-02")).toEqual({ grain: "custom", from: "2026-03-01", to: "2026-07-31" });
    expect(periodForCustom("2026-07-02", "2026-03-15")).toEqual({ grain: "custom", from: "2026-03-01", to: "2026-07-31" });
  });

  it("steps a month by a month, a quarter by a quarter, and the year to date by its end month", () => {
    expect(stepPeriod(periodForMonth("2026-01"), -1)).toEqual(periodForMonth("2025-12"));
    expect(stepPeriod(periodForQuarter("2026-07"), -1)).toEqual(periodForQuarter("2026-04"));
    expect(stepPeriod(periodForQuarter("2026-01"), -1)).toEqual(periodForQuarter("2025-10"));
    expect(stepPeriod(periodForYtd("2026-07"), -1)).toEqual(periodForYtd("2026-06"));
    expect(stepPeriod(periodForYtd("2026-01"), -1)).toEqual(periodForYtd("2025-12"));
    expect(stepPeriod(periodForMonth("2026-06"), 1)).toEqual(periodForMonth("2026-07"));
  });

  it("does not step a custom range", () => {
    const custom = periodForCustom("2026-03-01", "2026-07-31");
    expect(stepPeriod(custom, 1)).toBe(custom);
    expect(canStepForward(custom, "2026-12")).toBe(false);
  });

  it("refuses to step past the cap month", () => {
    expect(canStepForward(periodForMonth("2026-06"), "2026-07")).toBe(true);
    expect(canStepForward(periodForMonth("2026-07"), "2026-07")).toBe(false);
    // A quarter whose next step ends after the cap cannot step, even though it starts before it.
    expect(canStepForward(periodForQuarter("2026-04"), "2026-08")).toBe(false);
    expect(canStepForward(periodForQuarter("2026-04"), "2026-09")).toBe(true);
  });

  it("re-expresses a period at another grain from the month it ends in", () => {
    expect(periodAtGrain(periodForMonth("2026-08"), "quarter")).toEqual(periodForQuarter("2026-07"));
    expect(periodAtGrain(periodForQuarter("2026-07"), "month")).toEqual(periodForMonth("2026-09"));
    expect(periodAtGrain(periodForMonth("2026-07"), "ytd")).toEqual(periodForYtd("2026-07"));
  });

  it("names a period the way a reader says it", () => {
    expect(periodLabel(periodForMonth("2026-07"))).toBe("July 2026");
    expect(periodLabel(periodForQuarter("2026-08"))).toBe("Q3 2026");
    expect(periodLabel(periodForYtd("2026-07"))).toBe("2026 to July");
    expect(periodLabel(periodForCustom("2026-03-01", "2026-07-31"))).toBe("Mar – Jul 2026");
    expect(periodLabel(periodForCustom("2025-11-01", "2026-02-28"))).toBe("Nov 2025 – Feb 2026");
    expect(periodLabel(periodForCustom("2026-07-01", "2026-07-31"))).toBe("July 2026");
  });

  it("opens on the latest month the sweep finished, never on one it reached mid-month", () => {
    const points = [{ month: "2026-06" }, { month: "2026-07" }, { month: "2026-08" }];
    expect(latestReportableMonth({ points, missing: ["2026-08"] })).toBe("2026-07");
    expect(latestReportableMonth({ points, missing: [] })).toBe("2026-08");
    expect(latestReportableMonth({ points: [], missing: ["2026-08"] })).toBeNull();
  });
});

describe("periodFromLink — the period a Fleet report link names (F21 R4b (e))", () => {
  it("keeps the grain when its own period covers exactly the linked months", () => {
    expect(periodFromLink("2026-07", "2026-07", "month")).toEqual({ grain: "month", from: "2026-07-01", to: "2026-07-31" });
    expect(periodFromLink("2026-01", "2026-03", "quarter")).toEqual({ grain: "quarter", from: "2026-01-01", to: "2026-03-31" });
    expect(periodFromLink("2026-01", "2026-03", "ytd")).toEqual({ grain: "ytd", from: "2026-01-01", to: "2026-03-31" });
  });

  it("reads months a grain does not cover, or no grain, as a custom range of whole months", () => {
    expect(periodFromLink("2026-02", "2026-03", "quarter")).toEqual({ grain: "custom", from: "2026-02-01", to: "2026-03-31" });
    expect(periodFromLink("2026-03", "2026-01", undefined)).toEqual({ grain: "custom", from: "2026-01-01", to: "2026-03-31" });
    expect(periodFromLink("2026-07", "2026-07", "banana")).toEqual({ grain: "custom", from: "2026-07-01", to: "2026-07-31" });
  });

  it("names no period when either end is not a month", () => {
    for (const [a, b] of [["2026-7", "2026-07"], ["2026-07-01", "2026-07"], ["2026-13", "2026-12"], [undefined, "2026-07"]]) {
      expect(periodFromLink(a, b, "month"), `${a} ${b}`).toBeNull();
    }
  });

  it("round-trips every grain through the contract's writer", () => {
    for (const p of [periodForMonth("2026-02"), periodForQuarter("2026-08"), periodForYtd("2026-05"), periodForCustom("2026-03-10", "2026-06-02")]) {
      const q = fleetReportToQuery(p);
      expect(periodFromLink(q.from, q.to, q.grain)).toEqual(p);
    }
  });
});

