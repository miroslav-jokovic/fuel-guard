import { describe, expect, it } from "vitest";
import { cardIdentityLabel, cardIdentityText, unlinkedReason } from "./cardIdentityLabel";

/**
 * Step 7.7's reading half.
 *
 * The linker was fixed to stop treating a last-4 as an identity. These are the same correction on
 * the side a person experiences: on this fleet `••••7552` is five different cards on five different
 * trucks, so a row that prints only the masked ref names a GROUP, not a card.
 */

describe("cardIdentityLabel", () => {
  it("shows unit AND driver, not one-or-the-other", () => {
    // THE regression. `driverName ?? unitPrompt` printed whichever came first and hid the other; on a
    // fleet with duplicate last-4s the hidden field is often the only discriminator.
    const label = cardIdentityLabel({ maskedRef: "••••7552", unitPrompt: "716", driverName: "ISMAEL GARCIA" });

    expect(label.qualifier).toContain("Unit 716");
    expect(label.qualifier).toContain("ISMAEL GARCIA");
    expect(label.unidentified).toBe(false);
  });

  it("leads with the unit, because that is how a fleet talks about a card", () => {
    const label = cardIdentityLabel({ maskedRef: "••••7552", unitPrompt: "716", driverName: "ISMAEL GARCIA" });
    expect(label.qualifier.indexOf("Unit 716")).toBeLessThan(label.qualifier.indexOf("ISMAEL GARCIA"));
  });

  it("copes with either half missing", () => {
    expect(cardIdentityLabel({ maskedRef: "••••7552", unitPrompt: "716" }).qualifier).toBe("Unit 716");
    expect(cardIdentityLabel({ maskedRef: "••••7552", driverName: "MITCHELL NEWKIRK" }).qualifier)
      .toBe("MITCHELL NEWKIRK");
  });

  it("says so out loud when nothing distinguishes the card", () => {
    // 37 of 197 live production cards have neither. Rendering just "••••7552" for those reads like an
    // identity, and on this fleet it is not one.
    const label = cardIdentityLabel({ maskedRef: "••••7552", unitPrompt: null, driverName: null });

    expect(label.unidentified).toBe(true);
    expect(label.qualifier).toBe("");
    expect(cardIdentityText({ maskedRef: "••••7552" })).toContain("no unit or driver");
  });

  it("treats blank strings as missing, not as a qualifier", () => {
    // Both fields are vendor free text and arrive as "" more often than as null.
    expect(cardIdentityLabel({ maskedRef: "••••7552", unitPrompt: "  ", driverName: "" }).unidentified).toBe(true);
  });
});

describe("unlinkedReason", () => {
  it("is silent for a linked card", () => {
    expect(unlinkedReason({ fuelCardId: "fc-1", linkStatus: "linked" })).toBeNull();
  });

  it("is silent when an older API sends no link evidence", () => {
    // An absent explanation must not render as "unknown problem" — the deploy that has not shipped
    // 0195 yet is a normal state, not a fault to report on every row.
    expect(unlinkedReason({ fuelCardId: null })).toBeNull();
  });

  it("names a different next action for each way linking can fail", () => {
    // The whole reason the linker distinguishes four statuses: each sends somebody somewhere else.
    const reasons = (["ambiguous", "unconfirmed", "no_candidate", "unidentifiable"] as const).map((s) =>
      unlinkedReason({ fuelCardId: null, linkStatus: s, linkCandidates: 5 }),
    );

    expect(reasons.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    expect(new Set(reasons).size).toBe(4);
  });

  it("counts the candidates it could not tell apart", () => {
    // Step 7.7's Verify: a row that still cannot be linked names what it could not choose between.
    expect(unlinkedReason({ fuelCardId: null, linkStatus: "ambiguous", linkCandidates: 5 }))
      .toContain("5 fuel cards");
  });
});
