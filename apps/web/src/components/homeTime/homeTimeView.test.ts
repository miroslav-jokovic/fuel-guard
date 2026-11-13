import { describe, expect, it } from "vitest";
import { HOME_TIME_CHIPS } from "@silvicom/shared";
import { fromWallTime, homeTimeChipTone, homeTimeChipWords, spanWords, toWallTime } from "./homeTimeView";

/**
 * How home time is worded, and how the form's clock is read (HOME-TIME-PLAN §3.3, §3.4). The clock is
 * the CARRIER's: these run on a machine in any zone and must read the same.
 */
const ZONE = "America/Chicago";
const NOW = new Date("2026-11-13T15:00:00Z"); // 09:00 Central
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

describe("spanWords", () => {
  it("says minutes under an hour, hours under a day, then days and hours", () => {
    expect(spanWords(40 * 60_000)).toBe("40 min");
    expect(spanWords(18 * 3_600_000)).toBe("18 h");
    expect(spanWords(28 * 3_600_000)).toBe("1 d 4 h");
    expect(spanWords(48 * 3_600_000)).toBe("2 d");
  });

  it("is never negative: the caller says 'in' or 'ago'", () => {
    expect(spanWords(-28 * 3_600_000)).toBe("1 d 4 h");
  });
});

describe("homeTimeChipWords", () => {
  const h = { startAt: hours(-9 * 24), expectedReturnAt: hours(18) };
  const solo = { now: NOW, zone: ZONE };

  it("words each chip the way the plan's table does, for a solo truck", () => {
    expect(homeTimeChipWords("scheduled", { startAt: "2026-11-20T20:00:00Z", expectedReturnAt: hours(400) }, solo)).toBe("Home time from 11/20");
    expect(homeTimeChipWords("home", { ...h, expectedReturnAt: "2026-11-18T14:00:00Z" }, solo)).toBe("Driver home until 11/18");
    expect(homeTimeChipWords("return_due", h, solo)).toBe("Back in 18 h");
    expect(homeTimeChipWords("overdue", { ...h, expectedReturnAt: hours(-28) }, solo)).toBe("Home time overdue 1 d 4 h");
    expect(homeTimeChipWords("truck_limit", h, solo)).toBe("Truck at home 9 days");
  });

  it("names the seat on a team truck", () => {
    const team = { ...solo, who: "Ben Cole" };
    expect(homeTimeChipWords("home", { ...h, expectedReturnAt: "2026-11-18T14:00:00Z" }, team)).toBe("Ben Cole home until 11/18");
    expect(homeTimeChipWords("return_due", h, team)).toBe("Ben Cole back in 18 h");
    expect(homeTimeChipWords("overdue", { ...h, expectedReturnAt: hours(-3) }, team)).toBe("Ben Cole: home time overdue 3 h");
    expect(homeTimeChipWords("scheduled", { startAt: "2026-11-20T20:00:00Z", expectedReturnAt: hours(400) }, team)).toBe("Ben Cole: home time from 11/20");
  });

  it("reads the day on the carrier's clock: 03:00 UTC on the 19th is still the 18th in Chicago", () => {
    expect(homeTimeChipWords("home", { ...h, expectedReturnAt: "2026-11-19T03:00:00Z" }, solo)).toBe("Driver home until 11/18");
  });

  it("colours overdue and the truck limit red, 'back soon' amber, and the rest quiet", () => {
    expect(Object.fromEntries(HOME_TIME_CHIPS.map((c) => [c, homeTimeChipTone(c)]))).toEqual({
      scheduled: "neutral", home: "neutral", return_due: "warning", overdue: "danger", truck_limit: "danger",
    });
  });
});

describe("the form's clock", () => {
  it("shows an instant as the carrier's wall time, and reads a wall time back as the same instant", () => {
    expect(toWallTime("2026-11-18T14:00:00Z", ZONE)).toBe("2026-11-18T08:00");
    expect(fromWallTime("2026-11-18T08:00", ZONE)).toBe("2026-11-18T14:00:00.000Z");
  });

  it("uses the zone's offset on that day, not today's: 08:00 in July is 13:00 UTC", () => {
    expect(fromWallTime("2026-07-06T08:00", ZONE)).toBe("2026-07-06T13:00:00.000Z");
    expect(toWallTime("2026-07-06T13:00:00Z", ZONE)).toBe("2026-07-06T08:00");
  });

  it("is the same instant for a carrier in another zone only when the wall time differs", () => {
    expect(fromWallTime("2026-11-18T08:00", "America/New_York")).toBe("2026-11-18T13:00:00.000Z");
  });

  it("reads an empty or half-typed field as nothing", () => {
    expect(fromWallTime("", ZONE)).toBeNull();
    expect(fromWallTime(null, ZONE)).toBeNull();
    expect(fromWallTime("2026-11-18", ZONE)).toBeNull();
  });
});
