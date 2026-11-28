import { describe, expect, it } from "vitest";
import { compareFollowUps, followUpActionRequestSchema, followUpTimesLabel } from "./followUpContract.js";

/** The desk's order and words (WARNING-DESK-PLAN D-WD18, §4). */
describe("compareFollowUps — the order the desk works in", () => {
  const line = (o: Partial<Parameters<typeof compareFollowUps>[0]> = {}) => ({
    severity: "normal" as const, lastAt: "2026-11-20T00:00:00Z", status: "new" as const, closedAt: null, ...o,
  });

  it("puts the line warned most recently first, whatever its severity", () => {
    const urgentOld = line({ severity: "urgent", lastAt: "2026-11-27T21:31:00Z" });
    const normalNew = line({ lastAt: "2026-11-28T00:23:00Z" });
    const highMid = line({ severity: "high", lastAt: "2026-11-27T23:00:00Z" });
    expect([urgentOld, normalNew, highMid].sort(compareFollowUps)).toEqual([normalNew, highMid, urgentOld]);
  });

  it("breaks a tie in time by severity", () => {
    const normal = line();
    const urgent = line({ severity: "urgent" });
    expect([normal, urgent].sort(compareFollowUps)).toEqual([urgent, normal]);
  });

  it("orders closed lines by the newest close", () => {
    const a = line({ status: "closed", closedAt: "2026-11-20T00:00:00Z" });
    const b = line({ status: "closed", closedAt: "2026-11-26T00:00:00Z" });
    expect([a, b].sort(compareFollowUps)).toEqual([b, a]);
  });
});

describe("followUpTimesLabel", () => {
  it("says once, or N times over the days the warnings span", () => {
    expect(followUpTimesLabel(1, "2026-11-26T08:00:00Z", "2026-11-26T08:00:00Z")).toBe("once");
    expect(followUpTimesLabel(3, "2026-11-26T08:00:00Z", "2026-11-26T09:00:00Z")).toBe("3 times in 1 day");
    expect(followUpTimesLabel(5, "2026-11-24T10:00:00Z", "2026-11-26T11:00:00Z")).toBe("5 times in 3 days");
  });
});

describe("followUpActionRequestSchema", () => {
  it("requires a note to close as not a problem, and for a note", () => {
    expect(followUpActionRequestSchema.safeParse({ action: "closed_not_a_problem", version: 1 }).success).toBe(false);
    expect(followUpActionRequestSchema.safeParse({ action: "note", note: "  ", version: 1 }).success).toBe(false);
    expect(followUpActionRequestSchema.safeParse({ action: "closed_not_a_problem", note: "Sensor fault, shop knows", version: 1 }).success).toBe(true);
    expect(followUpActionRequestSchema.safeParse({ action: "called", version: 1 }).success).toBe(true);
  });

  it("refuses an action the database does not know", () => {
    expect(followUpActionRequestSchema.safeParse({ action: "reopened", version: 1 }).success).toBe(false);
  });
});
