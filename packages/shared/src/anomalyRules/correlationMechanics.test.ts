import { describe, it, expect, vi } from "vitest";
import type { RuleResult } from "./types.js";
import type { RuleId } from "./catalog.generated.js";

/**
 * How `correlateSignals` COMBINES weights, pinned against fixed weights rather than the catalog's.
 *
 * Until CF5 (2026-10-08) these cases used real rules — tank_space_exceeded at 90 for "overwhelming",
 * location_mismatch + tank_fill_short for "two axes". CF5 made every rule but the two tank-rise rules a
 * note, so no catalog pair reaches an alert any more and those cases had to change. The alert branch is
 * still the engine: restoring a rule's authority is one number in catalog.yaml, and the day someone does
 * it the thresholds below are what decide. So the mechanics keep their own tests, with weights that
 * belong to the test and not to the product.
 */
vi.mock("./catalog.generated.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./catalog.generated.js")>();
  const fixed: Partial<Record<RuleId, { axis: (typeof real.SIGNAL_META)[RuleId]["axis"]; weight: number }>> = {
    tank_space_exceeded: { axis: "volume", weight: 90 },
    tank_fill_short: { axis: "volume", weight: 60 },
    location_mismatch: { axis: "location", weight: 50 },
    impossible_travel: { axis: "location", weight: 70 },
    odometer_regression: { axis: "odometer", weight: 55 },
  };
  return { ...real, SIGNAL_META: { ...real.SIGNAL_META, ...fixed } };
});

const { correlateSignals, CORRELATION_THRESHOLDS } = await import("./cases.js");

const sig = (ruleId: RuleId, severity: RuleResult["severity"] = "high"): RuleResult => ({
  ruleId,
  fired: true,
  severity,
  message: `${ruleId} fired`,
  evidence: {},
});

describe("correlateSignals — mechanics, on fixed test weights", () => {
  it("a signal at or above the overwhelming weight is an alert on its own, critical when it is", () => {
    const c = correlateSignals([sig("tank_space_exceeded", "critical")]);
    expect(c.level).toBe("alert");
    expect(c.severity).toBe("critical");
    expect(correlateSignals([sig("tank_space_exceeded", "high")]).severity).toBe("high");
  });

  it("two independent axes at or above the alert score are an alert", () => {
    const c = correlateSignals([sig("location_mismatch"), sig("tank_fill_short")]); // 50 + 60 = 110
    expect(c.level).toBe("alert");
    expect(c.score).toBe(CORRELATION_THRESHOLDS.alertScore);
    expect(c.axes.sort()).toEqual(["location", "volume"]);
  });

  it("one axis counts once: its strongest signal, never the sum", () => {
    const c = correlateSignals([sig("location_mismatch"), sig("impossible_travel")]); // both location
    expect(c.score).toBe(70);
    expect(c.level).toBe("review");
  });

  it("a lone signal at the review weight is a medium review; below it, clear but still listed", () => {
    const review = correlateSignals([sig("tank_fill_short")]);
    expect(review.level).toBe("review");
    expect(review.severity).toBe("medium");
    const clear = correlateSignals([sig("odometer_regression")]);
    expect(clear.level).toBe("clear");
    expect(clear.signals).toHaveLength(1);
  });

  it("the exported thresholds are the ones the cases above sit on (no drift)", () => {
    expect(CORRELATION_THRESHOLDS).toEqual({ overwhelming: 85, review: 60, alertScore: 110 });
  });
});
