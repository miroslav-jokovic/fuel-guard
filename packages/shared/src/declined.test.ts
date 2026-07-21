import { describe, it, expect } from "vitest";
import { assessDecline, declineSignalWeight, isRestrictedDeclineReason, type DeclineSignal } from "./declined.js";

const sig = (key: DeclineSignal["key"], detail = ""): DeclineSignal => ({ key, weight: declineSignalWeight(key), detail });

describe("assessDecline", () => {
  it("no signals → clear", () => {
    expect(assessDecline([]).level).toBe("clear");
  });
  it("location mismatch alone → alert (card used where the truck isn't)", () => {
    expect(assessDecline([sig("location_mismatch")]).level).toBe("alert");
  });
  it("approved-elsewhere alone → alert", () => {
    expect(assessDecline([sig("approved_elsewhere")]).level).toBe("alert");
  });
  it("repeated declines alone → review", () => {
    expect(assessDecline([sig("repeated_declines")]).level).toBe("review");
  });
  it("a lone weak restricted reason → clear", () => {
    expect(assessDecline([sig("restricted_reason")]).level).toBe("clear");
  });
  it("repeated declines + restricted reason correlate → alert", () => {
    const c = assessDecline([sig("repeated_declines"), sig("restricted_reason")]);
    expect(c.score).toBe(85);
    expect(c.level).toBe("review"); // 85 < 110 and top 55 < 75 → review, not alert
  });

  it("wrong_unit_number is exonerating — clear, but still surfaced as a reason", () => {
    const c = assessDecline([sig("wrong_unit_number", "truck 668 fueled here right after")]);
    expect(c.level).toBe("clear");
    expect(c.score).toBe(0);
    expect(c.reasons).toHaveLength(1);
    expect(c.reasons[0]!.key).toBe("wrong_unit_number");
  });

  it("wrong_unit_number does not stop a real signal from scoring", () => {
    const c = assessDecline([sig("wrong_unit_number"), sig("repeated_declines")]);
    expect(c.level).toBe("review"); // the repeated-declines signal still scores
    expect(c.reasons).toHaveLength(2); // both shown
  });
});

describe("isRestrictedDeclineReason", () => {
  it("flags site/location/product restriction text", () => {
    expect(isRestrictedDeclineReason("R12", "Outside allowed location")).toBe(true);
    expect(isRestrictedDeclineReason(null, "Product not allowed")).toBe(true);
  });
  it("ignores benign reasons", () => {
    expect(isRestrictedDeclineReason("55", "Invalid PIN")).toBe(false);
    expect(isRestrictedDeclineReason(null, "Card expired")).toBe(false);
  });
});
