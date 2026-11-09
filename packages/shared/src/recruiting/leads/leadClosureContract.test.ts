import { describe, expect, it } from "vitest";
import {
  LEAD_CLOSE_REASONS,
  LEAD_LOST_REASONS,
  LEAD_NOT_QUALIFIED_REASONS,
  isLeadCloseReason,
  leadCloseReasonLabel,
  leadCloseSchema,
  requirementOfReason,
  statusAfterClose,
} from "./leadClosureContract.js";
import { LEAD_REQUIREMENTS } from "./leadMatch.js";

describe("leadClosureContract (LQ5a)", () => {
  it("derives one not_qualified reason per requirement, in the requirements' order", () => {
    expect(LEAD_NOT_QUALIFIED_REASONS).toEqual(LEAD_REQUIREMENTS.map((r) => `not_qualified:${r}`));
    expect(LEAD_CLOSE_REASONS).toEqual([...LEAD_NOT_QUALIFIED_REASONS, ...LEAD_LOST_REASONS]);
    expect(new Set(LEAD_CLOSE_REASONS).size).toBe(LEAD_CLOSE_REASONS.length);
  });

  it("a not_qualified reason closes as not_qualified and names its requirement; the rest close as lost", () => {
    for (const r of LEAD_NOT_QUALIFIED_REASONS) {
      expect(statusAfterClose(r)).toBe("not_qualified");
      expect(requirementOfReason(r)).toBe(r.slice("not_qualified:".length));
    }
    for (const r of LEAD_LOST_REASONS) {
      expect(statusAfterClose(r)).toBe("lost");
      expect(requirementOfReason(r)).toBeNull();
    }
  });

  it("recognises only the list", () => {
    expect(LEAD_CLOSE_REASONS.every(isLeadCloseReason)).toBe(true);
    expect(isLeadCloseReason("not_qualified:home_time")).toBe(false);
    expect(isLeadCloseReason("ghosted")).toBe(false);
    expect(isLeadCloseReason(null)).toBe(false);
  });

  it("the close body takes a listed reason and trims an optional note to null", () => {
    expect(leadCloseSchema.parse({ reason: "spam" })).toEqual({ reason: "spam", note: null });
    expect(leadCloseSchema.parse({ reason: "not_qualified:class_a", note: "  straight truck only  " })).toEqual({
      reason: "not_qualified:class_a", note: "straight truck only",
    });
    expect(leadCloseSchema.safeParse({ reason: "ghosted" }).success).toBe(false);
    expect(leadCloseSchema.safeParse({ reason: "spam", note: "x".repeat(2001) }).success).toBe(false);
  });

  it("every reason has office words, and none is the raw key", () => {
    for (const r of LEAD_CLOSE_REASONS) {
      const label = leadCloseReasonLabel(r);
      expect(label.length).toBeGreaterThanOrEqual(3);
      expect(label).not.toBe(r);
      expect(label).not.toMatch(/_/);
    }
    expect(leadCloseReasonLabel("unreachable")).toBe("Unreachable after 3 attempts");
  });
});
