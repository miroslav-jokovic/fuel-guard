import { describe, expect, it } from "vitest";
import {
  closeReasonUnavailable,
  leadEvidenceFrom,
  qualifyUnavailable,
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
    // `home_time` joined LEAD_REQUIREMENTS in LQ7, so its reason exists by derivation; a requirement that does not is refused.
    expect(isLeadCloseReason("not_qualified:home_time")).toBe(true);
    expect(isLeadCloseReason("not_qualified:height")).toBe(false);
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

  it("counts the evidence the way 0578's functions do: outbound no-answer/voicemail are attempts, reached and wrong-number any direction", () => {
    const e = leadEvidenceFrom([
      { direction: "outbound", outcome: "no_answer" }, { direction: "outbound", outcome: "voicemail" },
      { direction: "inbound", outcome: "no_answer" }, { direction: "outbound", outcome: "reached" },
      { direction: "inbound", outcome: null }, { direction: "outbound", outcome: "wrong_number" },
    ], 2);
    expect(e).toEqual({ reached: 1, wrong_number: 1, attempts: 2, same_person: 2 });
  });

  it("says why a reason is not available yet, in the database's words (RL055–RL057), and nothing for the free reasons", () => {
    const none = { reached: 0, wrong_number: 0, attempts: 2, same_person: 0 };
    expect(closeReasonUnavailable("not_interested", none)).toMatch(/Reached on record/);
    expect(closeReasonUnavailable("wrong_number", none)).toMatch(/Wrong number on record/);
    expect(closeReasonUnavailable("unreachable", none)).toBe("Needs 3 outbound attempts with no answer on record; 2 recorded.");
    expect(closeReasonUnavailable("duplicate", none)).toMatch(/none shares/);
    for (const r of ["out_of_area", "spam", "not_qualified:class_a"] as const) expect(closeReasonUnavailable(r, none)).toBeNull();
    const all = { reached: 1, wrong_number: 1, attempts: 3, same_person: 1 };
    for (const r of LEAD_CLOSE_REASONS) expect(closeReasonUnavailable(r, all)).toBeNull();
    expect(qualifyUnavailable(none)).toMatch(/Reached/);
    expect(qualifyUnavailable(all)).toBeNull();
  });
});
