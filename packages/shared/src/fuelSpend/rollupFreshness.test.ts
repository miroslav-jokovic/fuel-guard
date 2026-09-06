import { describe, it, expect } from "vitest";
import { describeRollupFreshness, SPEND_REBUILD_DAYS } from "./rollupFreshness.js";

/**
 * A6 / D-FUI18 — a derived table states when it was derived.
 *
 * The rollup rebuilds only the trailing 14 days, so a window reaching further back contains figures
 * built once and never re-derived through any correction since. Measured in production: 29,114 rows
 * whose `updated_at` all fall inside one week in August. The page said nothing about it.
 */

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("describeRollupFreshness — how old is the oldest thing in this window", () => {
  it("says nothing when the window holds no rows — an empty window has no age to report", () => {
    for (const empty of [null, undefined, "", "not-a-date"]) {
      expect(describeRollupFreshness(empty, NOW)).toEqual({ builtAt: null, ageDays: null, stale: false, lead: null, short: null });
    }
  });

  it("reads plainly for a fresh window", () => {
    expect(describeRollupFreshness(daysAgo(0), NOW).lead).toBe("Figures rebuilt today.");
    expect(describeRollupFreshness(daysAgo(1), NOW).lead).toBe("Figures rebuilt 1 day ago.");
    expect(describeRollupFreshness(daysAgo(3), NOW).lead).toBe("Figures rebuilt 3 days ago.");
  });

  // The whole point: past the rebuild window the sentence changes from a timestamp to a WARNING, and
  // says what the reader cannot see — that corrections since have not reached the older rows.
  it("changes what it says, not just the number, once the build predates the rebuild window", () => {
    const inside = describeRollupFreshness(daysAgo(SPEND_REBUILD_DAYS), NOW);
    expect(inside.stale).toBe(false);
    expect(inside.lead).toBe("Figures rebuilt 14 days ago.");

    const outside = describeRollupFreshness(daysAgo(SPEND_REBUILD_DAYS + 1), NOW);
    expect(outside.stale).toBe(true);
    expect(outside.lead).toContain("have not been applied");
    expect(outside.lead).toContain("15 days ago");
  });

  // A document's meta block cannot hold the sentence, and the obvious compact form — just the age —
  // would drop precisely the half that matters. The short form carries the warning or it is not short,
  // it is incomplete.
  it("keeps the warning in the compact form the PDF's meta block prints", () => {
    expect(describeRollupFreshness(daysAgo(0), NOW).short).toBe("today");
    expect(describeRollupFreshness(daysAgo(1), NOW).short).toBe("1 day ago");
    expect(describeRollupFreshness(daysAgo(SPEND_REBUILD_DAYS), NOW).short).toBe("14 days ago");
    expect(describeRollupFreshness(daysAgo(SPEND_REBUILD_DAYS + 1), NOW).short)
      .toBe("15 days ago — older than the 14-day rebuild");
  });

  it("floors the age rather than rounding it — a claim rounds toward the reader's caution", () => {
    // 1.9 days old. "2 days ago" would overstate how stale it is, which sounds harmless and is not:
    // the reader is deciding whether to trust a figure, and a number that drifts either way is noise.
    const t = new Date(NOW.getTime() - 1.9 * 86_400_000).toISOString();
    expect(describeRollupFreshness(t, NOW).ageDays).toBe(1);
  });

  it("never reports a negative age when a row was built in the future", () => {
    // Clock skew between the rollup process and the reader is not the reader's problem to interpret.
    const r = describeRollupFreshness(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW);
    expect(r.ageDays).toBe(0);
    expect(r.stale).toBe(false);
  });

  it("takes the rebuild window as an argument, so the API's REBUILD_DAYS stays the one definition", () => {
    expect(describeRollupFreshness(daysAgo(20), NOW, 30).stale).toBe(false);
    expect(describeRollupFreshness(daysAgo(20), NOW, 7).stale).toBe(true);
  });
});
