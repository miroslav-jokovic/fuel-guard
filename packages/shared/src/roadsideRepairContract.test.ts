import { describe, expect, it } from "vitest";
import { repairClock, repairDueOn } from "./roadsideRepairContract.js";

describe("the 396.9(d) clock", () => {
  it("is due fifteen calendar days after the inspection, across a month end", () => {
    expect(repairDueOn("2026-10-20")).toBe("2026-11-04");
  });

  it("counts days left, due today as zero, and days overdue", () => {
    expect(repairClock("2026-10-21", "2026-10-16")).toEqual({ overdue: false, days: 5 });
    expect(repairClock("2026-10-21", "2026-10-21")).toEqual({ overdue: false, days: 0 });
    expect(repairClock("2026-10-21", "2026-10-23")).toEqual({ overdue: true, days: 2 });
  });
});
