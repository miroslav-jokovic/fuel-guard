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

// ── WP1 additions: proximity + card-assignment signals ────────────────────────────────────────────
describe("WP1 decline signals", () => {
  it("a proximity failure ALONE is an alert — EFS's geofence verdict is honored", () => {
    const c = assessDecline([sig("proximity_failure")]);
    expect(c.level).toBe("alert");
  });
  it("a confirmed card-assignment mismatch alone is an alert (75 ≥ overwhelming)", () => {
    expect(assessDecline([sig("card_assigned_mismatch")]).level).toBe("alert");
  });
  it("an UNVERIFIED card mismatch (45) alone stays clear — corroboration only", () => {
    const unverified: DeclineSignal = { key: "card_assigned_mismatch", weight: 45, detail: "" };
    expect(assessDecline([unverified]).level).toBe("clear");
    // …but it corroborates a real partner into an alert (45 + 75 = 120 ≥ 110, 2 signals)
    expect(assessDecline([unverified, sig("approved_elsewhere")]).level).toBe("alert");
  });
  it("stale assignment / unit typo are exonerating: surfaced, never scored", () => {
    const c = assessDecline([sig("stale_card_assignment"), sig("card_unit_typo")]);
    expect(c.level).toBe("clear");
    expect(c.reasons).toHaveLength(2);
  });
  it("card_not_active alone stays clear (retries escalate via repeated_declines)", () => {
    expect(assessDecline([sig("card_not_active")]).level).toBe("clear");
  });
  it("proximity phrasing routes through the taxonomy, not the old restriction regex", () => {
    // The 0851226257 description does NOT read as a mere restriction…
    expect(isRestrictedDeclineReason("1", "INVALID TRUCKSTOP|Merchant Position Too Far|")).toBe(false);
    // …while a genuine restriction still does (back-compat).
    expect(isRestrictedDeclineReason("1", "INVALID TRUCKSTOP IN53790|Failed restrictions|")).toBe(true);
  });
});
