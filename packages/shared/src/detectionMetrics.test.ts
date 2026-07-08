import { describe, it, expect } from "vitest";
import { computeDetectionMetrics, wilsonInterval, type DispositionCaseInput } from "./detectionMetrics.js";

const c = (over: Partial<DispositionCaseInput>): DispositionCaseInput => ({ disposition: null, ...over });

describe("wilsonInterval", () => {
  it("returns null for an empty sample", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
  it("keeps 10/10 below 1.0 and above the naive 100% (small-sample honesty)", () => {
    const ci = wilsonInterval(10, 10)!;
    expect(ci.high).toBe(1); // clamped
    expect(ci.low).toBeGreaterThan(0.6);
    expect(ci.low).toBeLessThan(1); // NOT a hard 100%
  });
  it("brackets a large-sample proportion tightly around p", () => {
    const ci = wilsonInterval(900, 1000)!; // p = 0.9
    expect(ci.low).toBeGreaterThan(0.87);
    expect(ci.high).toBeLessThan(0.92);
  });
});

describe("computeDetectionMetrics", () => {
  it("computes precision over DECIDED cases and excludes inconclusive + pending", () => {
    const m = computeDetectionMetrics([
      c({ disposition: "confirmed" }),
      c({ disposition: "confirmed" }),
      c({ disposition: "confirmed" }),
      c({ disposition: "false_positive" }),
      c({ disposition: "benign_explained" }),
      c({ disposition: "inconclusive" }), // excluded from precision
      c({ disposition: null }), // pending, excluded
    ]);
    expect(m.raised).toBe(7);
    expect(m.pending).toBe(1);
    expect(m.inconclusive).toBe(1);
    expect(m.decided).toBe(5); // 3 confirmed + 1 fp + 1 benign
    expect(m.confirmed).toBe(3);
    expect(m.precision).toBe(0.6); // 3/5
    expect(m.nonIssueRate).toBe(0.4); // (1+1)/5
    expect(m.precisionCiLow).not.toBeNull();
    expect(m.precisionCiLow!).toBeLessThan(0.6);
    expect(m.precisionCiHigh!).toBeGreaterThan(0.6);
  });

  it("returns null precision when nothing has been decided", () => {
    const m = computeDetectionMetrics([c({ disposition: null }), c({ disposition: "inconclusive" })]);
    expect(m.precision).toBeNull();
    expect(m.nonIssueRate).toBeNull();
    expect(m.precisionCiLow).toBeNull();
  });

  it("breaks precision down per lead signal, worst-covered first", () => {
    const m = computeDetectionMetrics([
      c({ disposition: "confirmed", leadRuleId: "tank_space_exceeded" }),
      c({ disposition: "confirmed", leadRuleId: "tank_space_exceeded" }),
      c({ disposition: "false_positive", leadRuleId: "location_mismatch" }),
    ]);
    const tank = m.perLeadRule.find((r) => r.ruleId === "tank_space_exceeded")!;
    const loc = m.perLeadRule.find((r) => r.ruleId === "location_mismatch")!;
    expect(tank.precision).toBe(1);
    expect(tank.label).toBe("More Fuel Than Tank Could Hold");
    expect(loc.precision).toBe(0);
    expect(m.perLeadRule[0]!.ruleId).toBe("tank_space_exceeded"); // most decided first
  });

  it("builds a monthly precision trend from disposedAt, ignoring undated", () => {
    const m = computeDetectionMetrics([
      c({ disposition: "confirmed", disposedAt: "2026-05-10T00:00:00Z" }),
      c({ disposition: "false_positive", disposedAt: "2026-05-20T00:00:00Z" }),
      c({ disposition: "confirmed", disposedAt: "2026-06-01T00:00:00Z" }),
      c({ disposition: "confirmed" }), // no date → excluded from trend
    ]);
    expect(m.trend).toHaveLength(2);
    expect(m.trend[0]).toEqual({ period: "2026-05", decided: 2, confirmed: 1, precision: 0.5 });
    expect(m.trend[1]).toEqual({ period: "2026-06", decided: 1, confirmed: 1, precision: 1 });
  });

  it("groups undated/unattributed lead rule under a clear label", () => {
    const m = computeDetectionMetrics([c({ disposition: "confirmed" })]);
    expect(m.perLeadRule[0]!.label).toBe("Unattributed signal");
  });
});
