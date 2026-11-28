import { describe, expect, it } from "vitest";
import type { FollowUpLine } from "@silvicom/shared";
import { sortRows } from "@silvicom/ui";
import { agoLabel, driverLabel, followUpListSort, followUpSortValue, ruleCountText, stateBadge, unitLabel, warningsByDay } from "./followUpRows";

/** How a follow-up line reads (WARNING-DESK-PLAN §4). */
const line = (o: Partial<FollowUpLine> = {}): FollowUpLine => ({
  id: "00000000-0000-4000-8000-0000000000f1", ruleKey: "atis", ruleLabel: "Trailer tire losing air (ATIS lamp)", windowDays: 7,
  category: "maintenance", severity: "normal", status: "new", outcome: null, subjectKind: "trailer", subjectName: "R535973", inRoster: true,
  truck: { id: null, number: "847" }, trailer: { id: null, number: "R535973" }, driver: { id: "d", name: "Angel Perez", phone: null, source: "trailer_pairing" },
  warningCount: 5, firstAt: "2026-11-24T10:00:00Z", lastAt: "2026-11-26T10:00:00Z", contactedAt: null, closedAt: null, mine: false,
  looksFixed: false, warnedAgain: false, version: 1, ...o,
});

describe("stateBadge", () => {
  it("lets 'warned again after the call' outrank the status, then 'looks fixed'", () => {
    expect(stateBadge(line({ status: "called", warnedAgain: true, looksFixed: true })).text).toBe("Warned again after the call");
    expect(stateBadge(line({ status: "called", looksFixed: true })).text).toBe("Looks fixed — confirm");
    expect(stateBadge(line({ status: "called" })).text).toBe("Driver called");
    expect(stateBadge(line({ status: "sent_to_shop" })).text).toBe("Sent to shop");
    expect(stateBadge(line()).text).toBe("New");
    expect(stateBadge(line({ status: "closed", outcome: "not_a_problem" })).text).toBe("Closed — not a problem");
  });
});

describe("unitLabel and driverLabel", () => {
  it("names the trailer and its truck, and which record named the driver", () => {
    expect(unitLabel(line())).toBe("Trailer R535973 · truck 847");
    expect(driverLabel(line())).toBe("Angel Perez (trailer pairing)");
  });

  it("says when Samsara names a unit the roster does not know", () => {
    expect(unitLabel(line({ subjectKind: "truck", trailer: null, truck: null, subjectName: "783 - OLD", inRoster: false }))).toBe("783 - OLD (not in roster)");
    expect(driverLabel(line({ driver: { id: null, name: "J. Doe", phone: null, source: "samsara" } }))).toBe("J. Doe (from Samsara, not in roster)");
  });
});

describe("ruleCountText", () => {
  it("reads a rule's numbers as one sentence", () => {
    expect(ruleCountText({ thresholdCount: 3, windowDays: 7, minActiveHours: 0 })).toBe("3 times in 7 days");
    expect(ruleCountText({ thresholdCount: 1, windowDays: 1, minActiveHours: 0 })).toBe("The first time");
    expect(ruleCountText({ thresholdCount: 1, windowDays: 30, minActiveHours: 48 })).toBe("Not cleared after 2 days");
  });
});

describe("agoLabel", () => {
  it("rounds to minutes, hours, then days", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(agoLabel("2026-11-26T11:45:00Z", now)).toBe("15 min ago");
    expect(agoLabel("2026-11-26T10:00:00Z", now)).toBe("2 h ago");
    expect(agoLabel("2026-11-23T12:00:00Z", now)).toBe("3 days ago");
  });
});

/** The list opens newest first and a header click overrides it (D-WD18; contract §5.3). */
describe("followUpListSort", () => {
  it("opens open lines by their newest warning and closed lines by their close, newest first", () => {
    expect(followUpListSort({ key: null, dir: "asc" }, false)).toEqual({ key: "lastAt", dir: "desc" });
    expect(followUpListSort({ key: null, dir: "asc" }, true)).toEqual({ key: "closedAt", dir: "desc" });
  });

  it("steps aside for a clicked header", () => {
    expect(followUpListSort({ key: "unit", dir: "asc" }, false)).toEqual({ key: "unit", dir: "asc" });
  });

  it("puts the 6:23 PM warning above the 3:31 PM high-severity one, as the owner asked on release day", () => {
    const redLight = line({ id: "a", severity: "high", lastAt: "2026-11-27T21:31:36Z" });
    const following = line({ id: "b", lastAt: "2026-11-28T00:23:57Z" });
    const sorted = sortRows([redLight, following], followUpListSort({ key: null, dir: "asc" }, false), followUpSortValue);
    expect(sorted.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("warningsByDay", () => {
  it("groups warnings by calendar day and keeps the order they came in (newest first)", () => {
    const groups = warningsByDay([
      { id: "3", happenedAt: "2026-11-27T13:00:00Z" },
      { id: "2", happenedAt: "2026-11-27T12:00:00Z" },
      { id: "1", happenedAt: "2026-11-25T12:00:00Z" },
    ]);
    expect(groups.map((g) => [g.label, g.warnings.map((w) => w.id)])).toEqual([
      ["11/27/2026", ["3", "2"]],
      ["11/25/2026", ["1"]],
    ]);
  });

  it("answers nothing for no warnings", () => {
    expect(warningsByDay([])).toEqual([]);
  });
});
