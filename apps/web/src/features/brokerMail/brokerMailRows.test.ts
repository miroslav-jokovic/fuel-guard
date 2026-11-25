import { describe, expect, it } from "vitest";
import { answeredBy, matchNote, matchesBrokerMailSearch, waitLabel, waitTone, waitedMinutes } from "./brokerMailRows";

describe("the Broker mail page's row rules (BROKER-MAIL-READER-PLAN P2)", () => {
  const NOW = Date.parse("2026-11-25T15:00:00Z");

  it("counts whole minutes waited, never below zero", () => {
    expect(waitedMinutes("2026-11-25T14:37:30Z", NOW)).toBe(22);
    expect(waitedMinutes("2026-11-25T15:01:00Z", NOW)).toBe(0);
    expect(waitedMinutes("not a date", NOW)).toBe(0);
  });

  it("says a wait the way a dispatcher does", () => {
    expect(waitLabel(4)).toBe("4 min");
    expect(waitLabel(65)).toBe("1 h 05 min");
    expect(waitLabel(51 * 60)).toBe("2 d 3 h");
  });

  it("turns amber in the last five minutes before the answer-by time and red at it", () => {
    expect(waitTone(14, 20)).toBe("neutral");
    expect(waitTone(15, 20)).toBe("warning");
    expect(waitTone(20, 20)).toBe("danger");
  });

  it("says why a broker email has no load", () => {
    expect(matchNote({ matchState: "several", matchedRefs: ["PU7788"] })).toBe("PU7788 fits more than one load");
    expect(matchNote({ matchState: "none", matchedRefs: [] })).toBe("No load has this reference");
    expect(matchNote({ matchState: "not_tried", matchedRefs: [] })).toBe("No load reference found");
  });

  it("names who answered from the reader's side", () => {
    expect(answeredBy({ threadState: "answered_by_owner" }, false)).toBe("You replied");
    expect(answeredBy({ threadState: "answered_by_owner" }, true)).toBe("The dispatcher replied");
    expect(answeredBy({ threadState: "answered_by_colleague" }, false)).toBe("A colleague replied");
  });

  it("searches sender, subject and load reference", () => {
    const row = {
      id: "x", receivedAt: "", fromAddress: "anna@chrobinson.com", fromDomain: "chrobinson.com", subject: "RE: ETA?",
      matchState: "one" as const, load: { id: "l", ref: "48213" }, matchedRefs: ["48213"], threadState: "waiting" as const,
      answeredAt: null, addressedDirectly: true, ownerUserId: "u", ownerName: null,
    };
    expect(matchesBrokerMailSearch(row, "chrob")).toBe(true);
    expect(matchesBrokerMailSearch(row, "4821")).toBe(true);
    expect(matchesBrokerMailSearch(row, "tql")).toBe(false);
  });
});
