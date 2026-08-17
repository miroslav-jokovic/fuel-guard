import { describe, expect, it } from "vitest";
import { landingNotice, type MileageOverrideOutcome } from "./useUnitMileage";

/**
 * The four landings, as an operator reads them.
 *
 * `overrideLastMileage` returns nothing at all (`docs/37` §3), so every sentence on that screen is
 * derived from a re-read rather than from a response. Three of these four are cases nobody will be
 * watching the screen for — they have to survive being written once and read at the worst possible
 * moment — which is why the wording is asserted rather than left to the template.
 */

const base: MileageOverrideOutcome = {
  landing: "landed", before: 258536, after: 258900, requested: 258900,
  unit: "688", code: "ODRD", dispatched: true,
};

describe("landingNotice", () => {
  it("confirms a landing by naming the value EFS now holds, not the value we sent", () => {
    // The distinction is the whole point: `after` came back from EFS, `requested` came from the
    // operator. Reporting the request as the outcome is the H1 failure in one sentence.
    const n = landingNotice(base);
    expect(n.tone).toBe("success");
    expect(n.title).toContain("258,900");
    expect(n.title).toContain("688");
    expect(n.detail).toContain("reading the value back");
  });

  it("says plainly that nothing changed at the pump when the write did not land", () => {
    const n = landingNotice({ ...base, landing: "not_landed", after: 258536 });
    expect(n.tone).toBe("error");
    // Must not read as a transient error an operator would shrug at and retry blindly.
    expect(n.detail).toContain("258,536");
    expect(n.detail).toContain("nothing about this truck has changed");
  });

  it("explains the third value rather than calling it a failure", () => {
    /**
     * The ELD feed writes this reading too, so a value that is neither the old one nor ours is
     * evidence something else wrote after us — NOT evidence of failure. Calling it one would send
     * an operator to repeat a write that may well have worked.
     */
    const n = landingNotice({ ...base, landing: "indeterminate", after: 259100 });
    expect(n.tone).toBe("warning");
    expect(n.detail).toContain("259,100");
    expect(n.detail).toContain("ELD feed");
    expect(n.detail).toContain("Look it up again");
  });

  it("reports a skipped write as neither success nor failure", () => {
    // The API skips the dispatch when EFS already holds the value, because a re-read afterwards
    // would show it whether or not the vendor acted. Reporting `landed` there would be unfounded.
    const n = landingNotice({ ...base, landing: "already_current", before: 258900, after: 258900, dispatched: false });
    expect(n.tone).toBe("info");
    expect(n.detail).toContain("Nothing was sent");
  });

  it("never claims a reading EFS does not have", () => {
    // `null` means EFS holds nothing for the unit — rendering that as "0 miles" would be a claim
    // about a brand-new truck.
    const n = landingNotice({ ...base, landing: "not_landed", before: null, after: null });
    expect(n.detail).not.toContain("0 mi");
    expect(n.detail).toContain("unchanged");
  });
});
