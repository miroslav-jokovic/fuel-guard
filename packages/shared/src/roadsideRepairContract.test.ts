import { describe, expect, it } from "vitest";
import { byRepairUrgency, repairAlertStage, repairClock, repairDueOn } from "./roadsideRepairContract.js";

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

describe("when a repair rings the bell", () => {
  const open = { decision: null, proposal: { outcome: "no_candidate" as const, candidates: [], readAt: "x" }, dueOn: "2026-10-21" };
  it("rings from three days before the due day, then for the week after it, and never once settled", () => {
    expect(repairAlertStage(open, "2026-10-17")).toBeNull();
    expect(repairAlertStage(open, "2026-10-18")).toBe("due_soon");
    expect(repairAlertStage(open, "2026-10-21")).toBe("due_soon");
    expect(repairAlertStage(open, "2026-10-22")).toBe("overdue");
    expect(repairAlertStage(open, "2026-10-28")).toBe("overdue");
    expect(repairAlertStage(open, "2026-10-29")).toBeNull();
    expect(repairAlertStage({ ...open, proposal: { ...open.proposal, outcome: "repaired_at_scene" } }, "2026-10-21")).toBeNull();
  });
});

describe("the Shop's order", () => {
  it("puts what is nearest to today first, the overdue one on a tie, and a long backlog last", () => {
    const days = ["2026-06-01", "2026-10-30", "2026-10-17", "2026-10-21", "2026-10-19"];
    expect(days.map((dueOn) => ({ dueOn })).sort(byRepairUrgency("2026-10-19")).map((r) => r.dueOn)).toEqual([
      "2026-10-19", "2026-10-17", "2026-10-21", "2026-10-30", "2026-06-01",
    ]);
  });
});
