import { describe, expect, it } from "vitest";
import {
  EFS_TIME_ZONE,
  efsDateTime,
  efsWallClock,
  efsWallClockToUtc,
  nextEfsWallClock,
  parseEfsDateTime,
} from "./efsTime.js";

/**
 * "All of our servers are central time" (EFS guide p10) plus "the timezone is optional" (p11) is a
 * silent-corruption shape: a bare timestamp parsed as UTC lands five or six hours off depending on
 * the month. These tests pin both directions across a DST boundary, because an hour of drift makes
 * every fill on the screen wrong in a way nobody reports as a bug — they just stop trusting the page.
 */

describe("efsWallClock", () => {
  it("reads an instant as a Central-Time clock in CDT (UTC-5)", () => {
    expect(efsWallClock(new Date("2026-08-10T19:30:00Z"))).toEqual({
      year: 2026, month: 8, day: 10, hour: 14, minute: 30, second: 0,
    });
  });

  it("reads an instant as a Central-Time clock in CST (UTC-6)", () => {
    expect(efsWallClock(new Date("2026-01-15T19:30:00Z"))).toEqual({
      year: 2026, month: 1, day: 15, hour: 13, minute: 30, second: 0,
    });
  });

  it("reports midnight as hour 0, never 24", () => {
    expect(efsWallClock(new Date("2026-08-10T05:00:00Z")).hour).toBe(0);
  });

  it("rolls the DATE back, not just the clock, for a late-evening UTC instant", () => {
    // 00:30Z on the 11th is still the 10th in Chicago. Getting this wrong dates a fill to tomorrow.
    expect(efsWallClock(new Date("2026-08-11T00:30:00Z"))).toMatchObject({ day: 10, hour: 19 });
  });
});

describe("efsWallClockToUtc", () => {
  it("round-trips every wall clock it is given", () => {
    for (const iso of [
      "2026-08-10T19:30:00Z", "2026-01-15T19:30:00Z",
      "2026-03-08T12:00:00Z", "2026-11-01T12:00:00Z", "2026-12-31T23:59:00Z",
    ]) {
      const w = efsWallClock(new Date(iso));
      expect(new Date(efsWallClockToUtc(w.year, w.month, w.day, w.hour, w.minute, w.second)).toISOString())
        .toBe(new Date(iso).toISOString());
    }
  });

  it("uses the offset in effect at the ANSWER, not at the first guess (spring forward)", () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 CST→CDT. 04:00 CDT is 09:00Z; a single-pass conversion
    // would use the pre-transition offset and land an hour out.
    expect(new Date(efsWallClockToUtc(2026, 3, 8, 4, 0)).toISOString()).toBe("2026-03-08T09:00:00.000Z");
  });

  it("uses the offset in effect at the ANSWER (fall back)", () => {
    // 2026-11-01: clocks fall 02:00 → 01:00 CDT→CST. 04:00 CST is 10:00Z.
    expect(new Date(efsWallClockToUtc(2026, 11, 1, 4, 0)).toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });
});

describe("nextEfsWallClock", () => {
  it("returns today's occurrence when it is still ahead", () => {
    // 02:40 CDT → the next 02:55 CDT is fifteen minutes away, today.
    expect(new Date(nextEfsWallClock(new Date("2026-08-11T07:40:00Z"), 2, 55)).toISOString())
      .toBe("2026-08-11T07:55:00.000Z");
  });

  it("rolls to tomorrow once the time has passed", () => {
    expect(new Date(nextEfsWallClock(new Date("2026-08-11T08:10:00Z"), 2, 55)).toISOString())
      .toBe("2026-08-12T07:55:00.000Z");
  });

  it("is strictly in the future even when called exactly on the boundary", () => {
    const now = new Date("2026-08-11T07:55:00Z");
    expect(nextEfsWallClock(now, 2, 55)).toBeGreaterThan(now.getTime());
  });

  it("stays EARLY on the spring-forward night, when 02:55 does not exist at all", () => {
    // 2026-03-08 goes 02:00 CST → 03:00 CDT, so there is no 02:55 that night. The conversion resolves
    // backward, to 01:55 CST. That is the direction we want for a session boundary: refreshing sooner
    // than EFS's ~03:00 reset is free, and landing after it means an operator meets InvalidClientId.
    const at = nextEfsWallClock(new Date("2026-03-08T06:00:00Z"), 2, 55);
    expect(at).toBeLessThan(efsWallClockToUtc(2026, 3, 8, 3, 0));
    expect(efsWallClock(new Date(at))).toMatchObject({ hour: 1, minute: 55 });
  });
});

describe("efsDateTime", () => {
  it("emits an explicit -05:00 offset during CDT", () => {
    expect(efsDateTime(new Date("2026-08-10T19:30:15Z"))).toBe("2026-08-10T14:30:15-05:00");
  });

  it("emits an explicit -06:00 offset during CST", () => {
    expect(efsDateTime(new Date("2026-01-15T19:30:15Z"))).toBe("2026-01-15T13:30:15-06:00");
  });

  it("produces a string that parses back to the same instant", () => {
    for (const iso of ["2026-08-10T19:30:15Z", "2026-01-15T19:30:15Z", "2026-11-01T07:30:00Z"]) {
      expect(new Date(efsDateTime(new Date(iso))).toISOString()).toBe(new Date(iso).toISOString());
    }
  });
});

describe("parseEfsDateTime", () => {
  it("treats a BARE timestamp as Central Time, never UTC", () => {
    // The whole hazard in one assertion: naive parsing would answer 14:30Z and be five hours early.
    expect(parseEfsDateTime("2026-08-10T14:30:00")).toBe("2026-08-10T19:30:00.000Z");
  });

  it("applies the winter offset to a bare timestamp", () => {
    expect(parseEfsDateTime("2026-01-15T13:30:00")).toBe("2026-01-15T19:30:00.000Z");
  });

  it("respects an offset when the vendor sends one", () => {
    expect(parseEfsDateTime("2026-08-10T14:30:00-05:00")).toBe("2026-08-10T19:30:00.000Z");
    expect(parseEfsDateTime("2026-08-10T19:30:00Z")).toBe("2026-08-10T19:30:00.000Z");
  });

  it("accepts a space separator and a missing seconds field", () => {
    expect(parseEfsDateTime("2026-08-10 14:30")).toBe("2026-08-10T19:30:00.000Z");
  });

  it("returns null rather than an Invalid Date, so nothing persists NaN", () => {
    for (const bad of [null, undefined, "", "   ", "not a date"]) {
      expect(parseEfsDateTime(bad)).toBeNull();
    }
  });

  it("names the zone it assumes", () => {
    expect(EFS_TIME_ZONE).toBe("America/Chicago");
  });
});
