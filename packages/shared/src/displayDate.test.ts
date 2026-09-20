import { describe, expect, it } from "vitest";

import { formatDisplayDate, formatDisplayDateTime, formatDisplayDayShort } from "./displayDate.js";

/**
 * The two cases that matter are the two the 13 deleted copies got wrong: the ordering (which they
 * handed to the viewer's browser) and the calendar-day frame (which they read in local time and so
 * printed a day early). Everything else here is the shape of the string.
 */
describe("formatDisplayDate", () => {
  it("renders a calendar day as MM/DD/YYYY", () => {
    expect(formatDisplayDate("2026-09-20")).toBe("09/20/2026");
  });

  it("zero-pads both halves so a column of dates is one width", () => {
    expect(formatDisplayDate("2026-01-05")).toBe("01/05/2026");
    expect(formatDisplayDate("2026-12-31")).toBe("12/31/2026");
  });

  /**
   * The off-by-one this module exists to end. `new Date("2026-09-20")` is UTC midnight, and every US
   * timezone renders that as the 19th — which is what `MaintenanceSpendPage`, `BillingPage`,
   * `RecallAuditPage` and `OdometerPage` each shipped. Asserted against a pinned negative-offset zone
   * so the test fails on CI (UTC) as loudly as it would on the owner's laptop.
   */
  it("does not shift a calendar day backwards in a negative-offset timezone", () => {
    // `process` is reached through `globalThis` because this package's tsconfig carries no node types.
    // Asserted rather than optional-chained: a missing `process` would make every assertion below
    // vacuous, and a test that certifies nothing when its precondition is absent is worse than none.
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    expect(env, "this test needs process.env.TZ to pin a timezone").toBeDefined();
    const wasTz = env!.TZ;
    env!.TZ = "America/Chicago";
    try {
      // The trap itself, named — if this line ever stops being true, the TZ pin stopped working and
      // the assertion under it is no longer testing anything.
      expect(new Date("2026-09-20").getDate()).toBe(19);
      expect(formatDisplayDate("2026-09-20")).toBe("09/20/2026");
    } finally {
      env!.TZ = wasTz;
    }
  });

  /**
   * ⚠ A timestamp handed to the DATE formatter keeps its UTC calendar day. Dozens of call sites pass a
   * `timestamptz` to what is spelled `formatDate`, and the formatter this replaced answered them with
   * `slice(0, 10)` + `timeZone: "UTC"`. The first draft of this module read the same string as an
   * instant instead and moved every midnight-UTC stamp back a day for anyone west of Greenwich.
   */
  it("reads a timestamp as its UTC calendar day, not as a moment in the reader's zone", () => {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    expect(env, "this test needs process.env.TZ to pin a timezone").toBeDefined();
    const wasTz = env!.TZ;
    env!.TZ = "America/Chicago";
    try {
      // The trap, named: as an instant this is the 7th locally, and it must still print as the 8th.
      expect(new Date("2026-08-08T00:00:00.000Z").getDate()).toBe(7);
      expect(formatDisplayDate("2026-08-08T00:00:00.000Z")).toBe("08/08/2026");
    } finally {
      env!.TZ = wasTz;
    }
  });

  it("still reads a genuine moment as a moment when asked for a date AND time", () => {
    expect(formatDisplayDateTime("2026-09-20T14:03:00")).toBe("09/20/2026 2:03 PM");
  });

  it("accepts a Date and reads it locally", () => {
    expect(formatDisplayDate(new Date(2026, 8, 20))).toBe("09/20/2026");
  });

  it("returns the fallback for an absent value and lets a caller choose it", () => {
    expect(formatDisplayDate(null)).toBe("—");
    expect(formatDisplayDate(undefined)).toBe("—");
    expect(formatDisplayDate("")).toBe("—");
    expect(formatDisplayDate(null, "")).toBe("");
  });

  it("returns an unparseable string unchanged rather than claiming there is no date", () => {
    expect(formatDisplayDate("not a date")).toBe("not a date");
  });
});

describe("formatDisplayDateTime", () => {
  it("renders MM/DD/YYYY with a 12-hour clock", () => {
    expect(formatDisplayDateTime(new Date(2026, 8, 20, 14, 3))).toBe("09/20/2026 2:03 PM");
  });

  it("renders midnight and noon as 12, not 0", () => {
    expect(formatDisplayDateTime(new Date(2026, 8, 20, 0, 5))).toBe("09/20/2026 12:05 AM");
    expect(formatDisplayDateTime(new Date(2026, 8, 20, 12, 0))).toBe("09/20/2026 12:00 PM");
  });

  it("pads the minute but not the hour", () => {
    expect(formatDisplayDateTime(new Date(2026, 8, 20, 9, 7))).toBe("09/20/2026 9:07 AM");
  });
});

describe("formatDisplayDayShort", () => {
  it("drops the year for dense axes", () => {
    expect(formatDisplayDayShort("2026-09-20")).toBe("09/20");
  });
});
