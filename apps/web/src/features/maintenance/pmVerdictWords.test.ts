import { describe, expect, it } from "vitest";
import { pmVerdictLabel, pmVerdictRank } from "./pmVerdictWords";

describe("pmVerdictWords", () => {
  it("reads a schedule's null and a truck's unknown the same way: Can't tell", () => {
    expect(pmVerdictLabel(null)).toBe("Can't tell");
    expect(pmVerdictLabel("unknown")).toBe("Can't tell");
  });

  it("sorts what needs the shop first and a truck with no schedule last", () => {
    const order = (["ok", null, "unknown", "overdue", "due"] as const).slice().sort((a, b) => pmVerdictRank(a) - pmVerdictRank(b));
    expect(order).toEqual(["overdue", "due", "unknown", "ok", null]);
  });
});
