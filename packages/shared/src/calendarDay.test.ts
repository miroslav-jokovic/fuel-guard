import { describe, it, expect } from "vitest";
import {
  calendarDayOf,
  daysInRange,
  dayRangeInstants,
  isCalendarDay,
  shiftDay,
  todayInZone,
  wallClockInZone,
  wallClockToUtc,
} from "./calendarDay.js";

/**
 * D-PREC5 and D-PREC6, pinned. The numbers in the first block are the ones measured in production on
 * 2026-09-20: a Central-time viewer asking the dashboard for 08/09 → 08/09 was served 104 fills and
 * 11,471 gallons instead of 45 and 4,788, because the browser's midnight was pushed to UTC and cast
 * back to a calendar day one day later.
 */
const CHICAGO = "America/Chicago";
const BERLIN = "Europe/Berlin";

describe("what a calendar day is", () => {
  it("recognises the shape and nothing else", () => {
    expect(isCalendarDay("2026-08-09")).toBe(true);
    expect(isCalendarDay("2026-08-09T00:00:00")).toBe(false);
    expect(isCalendarDay("2026-8-9")).toBe(false);
    expect(isCalendarDay(undefined)).toBe(false);
  });

  it("undecorates a day somebody decorated, and does not pretend to convert an instant", () => {
    expect(calendarDayOf("2026-08-09T23:59:59")).toBe("2026-08-09");
    expect(calendarDayOf("2026-08-09")).toBe("2026-08-09");
  });
});

describe("todayInZone — D-PREC6", () => {
  /*
   * The default dashboard window ran to TOMORROW every evening after 19:00 Central, because
   * `new Date().toISOString().slice(0, 10)` is a UTC day. This is the moment that used to break it.
   */
  it("is still yesterday in Chicago when UTC has already rolled over", () => {
    const at = new Date("2026-09-21T02:00:00.000Z"); // 21:00 on the 20th, Central
    expect(todayInZone(at, CHICAGO)).toBe("2026-09-20");
    expect(at.toISOString().slice(0, 10)).toBe("2026-09-21"); // what the old code answered
  });

  it("is already tomorrow in Berlin when UTC has not rolled over", () => {
    const at = new Date("2026-09-20T23:00:00.000Z"); // 01:00 on the 21st, Berlin
    expect(todayInZone(at, BERLIN)).toBe("2026-09-21");
  });
});

describe("dayRangeInstants — D-PREC5", () => {
  it("covers one Central day and stops at its end, not a day later", () => {
    const r = dayRangeInstants("2026-08-09", "2026-08-09", CHICAGO);
    expect(r.start).toBe("2026-08-09T05:00:00.000Z"); // CDT, UTC-5
    expect(r.endExclusive).toBe("2026-08-10T05:00:00.000Z");
  });

  /*
   * The defect itself, stated as an interval. The old expression produced
   * `2026-08-10T04:59:59.999Z` for a `to` of 08/09, which an RPC taking `date` cast to 08-10 — so
   * the range silently ran to the end of the TENTH.
   */
  it("does not reach into the following day, which is the whole of the bug", () => {
    const r = dayRangeInstants("2026-08-09", "2026-08-09", CHICAGO);
    const aFillJustAfterMidnightCentralOnThe10th = "2026-08-10T05:30:00.000Z";
    expect(aFillJustAfterMidnightCentralOnThe10th < r.endExclusive).toBe(false);
    const aFillLateOnThe9thCentral = "2026-08-10T04:30:00.000Z";
    expect(aFillLateOnThe9thCentral < r.endExclusive).toBe(true);
  });

  it("is a half-open interval, so no sliver of the last second can be dropped", () => {
    const r = dayRangeInstants("2026-08-01", "2026-08-31", CHICAGO);
    // The old inclusive bound was T23:59:59.999 at best and T23:59:59 in two surfaces.
    expect(r.endExclusive).toBe("2026-09-01T05:00:00.000Z");
  });

  // A day is 23 or 25 hours twice a year, and a fixed offset gets exactly one of the two wrong.
  it("makes the spring-forward day 23 hours", () => {
    const r = dayRangeInstants("2026-03-08", "2026-03-08", CHICAGO);
    expect(r.start).toBe("2026-03-08T06:00:00.000Z"); // CST, UTC-6
    expect(r.endExclusive).toBe("2026-03-09T05:00:00.000Z"); // CDT, UTC-5
    expect((Date.parse(r.endExclusive) - Date.parse(r.start)) / 3_600_000).toBe(23);
  });

  it("makes the fall-back day 25 hours", () => {
    const r = dayRangeInstants("2026-11-01", "2026-11-01", CHICAGO);
    expect(r.start).toBe("2026-11-01T05:00:00.000Z");
    expect(r.endExclusive).toBe("2026-11-02T06:00:00.000Z");
    expect((Date.parse(r.endExclusive) - Date.parse(r.start)) / 3_600_000).toBe(25);
  });

  // The mirror image the audit predicted for a viewer east of Greenwich: the OLD code moved `from`
  // a day early. The zone-aware answer starts on the right day in either direction.
  it("starts on the asked-for day for a viewer east of Greenwich", () => {
    const r = dayRangeInstants("2026-08-09", "2026-08-09", BERLIN);
    expect(r.start).toBe("2026-08-08T22:00:00.000Z"); // CEST, UTC+2
    expect(r.endExclusive).toBe("2026-08-09T22:00:00.000Z");
  });
});

describe("the wall-clock pair the DST correctness rests on", () => {
  it("round-trips an instant through a zone's clock", () => {
    const at = new Date("2026-08-09T18:34:56.000Z");
    const wc = wallClockInZone(at, CHICAGO);
    expect(wc).toEqual({ year: 2026, month: 8, day: 9, hour: 13, minute: 34, second: 56 });
    expect(wallClockToUtc(wc, CHICAGO)).toBe(at.getTime());
  });

  /*
   * The second pass is what this proves. Asking for 02:30 on the fall-back night is ambiguous — it
   * happens twice — and a single-pass correction lands an hour out. Resolving to the FIRST
   * occurrence (CDT) is the documented choice.
   */
  it("resolves the repeated hour to its first occurrence", () => {
    const ts = wallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, CHICAGO);
    expect(new Date(ts).toISOString()).toBe("2026-11-01T06:30:00.000Z"); // CDT, UTC-5
  });
});

describe("calendar arithmetic, which needs no zone at all", () => {
  it("shifts across a month, a year and a leap day", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDay("2026-09-21", -30)).toBe("2026-08-22");
  });

  it("counts a range inclusively and never below one day", () => {
    expect(daysInRange("2026-08-09", "2026-08-09")).toBe(1);
    expect(daysInRange("2026-08-01", "2026-08-31")).toBe(31);
    expect(daysInRange("2026-08-31", "2026-08-01")).toBe(1); // reversed: refuse to go negative
  });

  // A shift over a DST boundary must not become 30 days and 23 hours, which is what epoch-millisecond
  // arithmetic on a local Date gives. This is UTC arithmetic on the calendar for exactly that reason.
  it("shifts cleanly across a DST boundary", () => {
    expect(shiftDay("2026-03-07", 2)).toBe("2026-03-09");
    expect(daysInRange("2026-03-07", "2026-03-09")).toBe(3);
  });
});
