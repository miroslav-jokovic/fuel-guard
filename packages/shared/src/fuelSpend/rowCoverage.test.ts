import { describe, it, expect } from "vitest";
import { describeRowCoverage } from "./rowCoverage.js";

/**
 * FUEL-T5 — a list says how much of itself reaches a truck.
 *
 * The production numbers these assertions are shaped around, measured 2026-09-02: 339 of 28,620 EFS
 * transaction lines and 696 of 3,445 declines name no truck on the fleet. The second is one row in
 * five, on the page whose only job is a fraud signal.
 */

describe("describeRowCoverage — how much of this list names a truck", () => {
  it("says nothing at all when the list is empty, because the empty state below already explains it better", () => {
    const c = describeRowCoverage("transactions", 0, 0);
    expect(c.lead).toBeNull();
    expect(c.attributedPercent).toBeNull();
    expect(c.complete).toBe(true);
  });

  // The whole reason for the flooring, and the assertion most likely to catch a "tidy-up" later.
  // 1,204 of 1,205 is 99.917%, which `Math.round` turns into a sentence that contradicts the row
  // sitting underneath it.
  it("floors the share rather than rounding it, so a complete-looking percentage means a complete set", () => {
    const c = describeRowCoverage("transactions", 1205, 1204);
    expect(c.attributedPercent).toBe(99);
    expect(c.lead).toContain("99% of the 1,205 transactions");
    expect(c.lead).not.toContain("100%");
  });

  it("prints the remainder as an exact count, because a share is a summary and the count is what a reader acts on", () => {
    const c = describeRowCoverage("transactions", 28_620, 28_281);
    expect(c.unattributed).toBe(339);
    expect(c.lead).toContain("The other 339 transactions are absent from any figure counted per truck.");
  });

  // A fully attributed list is a DIFFERENT sentence, not "100%" — a percentage reads as a caveat even
  // when it is complete, and a caveat that fires on a healthy list is how a caveat stops being read.
  it("changes what it says, not just the number, when every row names a truck", () => {
    const c = describeRowCoverage("rejections", 400, 400);
    expect(c.complete).toBe(true);
    expect(c.lead).toBe("All 400 declines in this list name a truck on the fleet.");
    expect(c.lead).not.toContain("%");
  });

  it("uses each list's own noun, matching the count label the filter bar prints beneath it", () => {
    expect(describeRowCoverage("transactions", 10, 9).lead).toContain("10 transactions");
    expect(describeRowCoverage("rejections", 10, 9).lead).toContain("10 declines");
    expect(describeRowCoverage("rejections", 3445, 2749).lead).toContain("The other 696 declines");
  });

  it("gives a single unattributed row its own clause instead of 'The other 1 declines are'", () => {
    const c = describeRowCoverage("rejections", 2, 1);
    expect(c.lead).toBe(
      "50% of the 2 declines in this list name a truck on the fleet. The one that does not is absent from any figure counted per truck.",
    );
    expect(c.lead).not.toContain("1 decline");
  });

  it("says 'transaction' in the singular when the whole list is one row", () => {
    expect(describeRowCoverage("transactions", 1, 0).lead).toContain("0% of the 1 transaction in this list");
  });

  it("groups thousands, because a fuel list is five figures long and 28620 is not a number anyone reads", () => {
    expect(describeRowCoverage("transactions", 28_620, 28_281).lead).toContain("28,620");
  });

  // The two counts are read a moment apart while the poller may be writing. A transient
  // `attributed > rows` must not print an impossible share — that discredits the line permanently
  // for a state that lasts one refresh.
  it("clamps a count read mid-write rather than printing a share above 100%", () => {
    const c = describeRowCoverage("transactions", 100, 104);
    expect(c.attributedPercent).toBe(100);
    expect(c.unattributed).toBe(0);
    expect(c.complete).toBe(true);
  });

  it("treats a negative or fractional count as the nearest sane whole, never as a negative remainder", () => {
    expect(describeRowCoverage("transactions", 100, -5).unattributed).toBe(100);
    expect(describeRowCoverage("transactions", 100.9, 50.9).rows).toBe(100);
    expect(describeRowCoverage("transactions", 100.9, 50.9).attributed).toBe(50);
  });
});
