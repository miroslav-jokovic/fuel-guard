import { describe, expect, it } from "vitest";
import { roadsideFeedState, type RoadsideFeed } from "@silvicom/shared";
import { roadsideFeedSentence } from "./feedFreshness";

const feed = (o: Partial<RoadsideFeed>): RoadsideFeed => ({ fetchedAt: "2026-10-13T14:17:00Z", sourceUpdatedAt: "2026-10-13T03:02:00Z", state: "fresh", ...o });

describe("how current FMCSA's record is (IC1c)", () => {
  it("names the fetch time on the org's clock when fresh, and is not a caution", () => {
    expect(roadsideFeedSentence(feed({}), "America/Chicago")).toEqual({ text: "FMCSA's record as of 10/13/2026 9:17 AM.", late: false });
  });

  it("says which side stopped — our fetch, or FMCSA's publishing — and is a caution either way", () => {
    const ours = roadsideFeedSentence(feed({ state: "ours_late" }), "America/Chicago");
    expect(ours.late).toBe(true);
    expect(ours.text).toContain("since 10/13/2026 9:17 AM");
    const theirs = roadsideFeedSentence(feed({ state: "fmcsa_late" }), "America/Chicago");
    expect(theirs).toEqual({ text: "FMCSA has not published since 10/12/2026 10:02 PM, so this is its record as of then.", late: true });
    expect(roadsideFeedSentence(feed({ fetchedAt: null, sourceUpdatedAt: null, state: "never" })).late).toBe(true);
  });
});

describe("roadsideFeedState — where late begins", () => {
  const NOW = Date.parse("2026-10-15T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  it("calls our fetch late past 36 hours, not at it", () => {
    expect(roadsideFeedState(hoursAgo(36), hoursAgo(40), NOW)).toBe("fresh");
    expect(roadsideFeedState(hoursAgo(36.1), hoursAgo(40), NOW)).toBe("ours_late");
  });

  it("calls FMCSA late past 72 hours when our fetch is current, and never on a source date it did not report", () => {
    expect(roadsideFeedState(hoursAgo(2), hoursAgo(72), NOW)).toBe("fresh");
    expect(roadsideFeedState(hoursAgo(2), hoursAgo(72.1), NOW)).toBe("fmcsa_late");
    expect(roadsideFeedState(hoursAgo(2), null, NOW)).toBe("fresh");
  });

  it("puts our own failure first when both are late, and says never when nothing has succeeded", () => {
    expect(roadsideFeedState(hoursAgo(50), hoursAgo(100), NOW)).toBe("ours_late");
    expect(roadsideFeedState(null, null, NOW)).toBe("never");
    expect(roadsideFeedState("not a date", null, NOW)).toBe("never");
  });
});
