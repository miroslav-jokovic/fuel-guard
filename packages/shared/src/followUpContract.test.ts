import { describe, expect, it } from "vitest";
import { compareFollowUps, followUpActionRequestSchema, followUpTimesLabel } from "./followUpContract.js";

/** The desk's order and words (WARNING-DESK-PLAN D-WD12, §4). */
describe("compareFollowUps — the order the desk works in", () => {
  const line = (o: Partial<Parameters<typeof compareFollowUps>[0]> = {}) => ({
    severity: "normal" as const, warnedAgain: false, firstAt: "2026-11-20T00:00:00Z", status: "new" as const, closedAt: null, ...o,
  });

  it("puts urgent before high before normal, whatever their age", () => {
    const sorted = [line({ firstAt: "2026-11-01T00:00:00Z" }), line({ severity: "urgent", firstAt: "2026-11-25T00:00:00Z" }), line({ severity: "high" })].sort(compareFollowUps);
    expect(sorted.map((l) => l.severity)).toEqual(["urgent", "high", "normal"]);
  });

  it("within a severity, a line warned again after the call comes first, then the oldest", () => {
    const old = line({ firstAt: "2026-11-01T00:00:00Z" });
    const again = line({ warnedAgain: true, firstAt: "2026-11-25T00:00:00Z" });
    const fresh = line({ firstAt: "2026-11-24T00:00:00Z" });
    expect([fresh, old, again].sort(compareFollowUps)).toEqual([again, old, fresh]);
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
