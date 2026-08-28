import { describe, it, expect } from "vitest";
import { ymd, exclusiveEnd, lastFullMonth, trailingDays } from "./dateWindow";

describe("exclusiveEnd — the picker's inclusive day becomes the API's exclusive bound", () => {
  it("advances an ordinary day by one", () => {
    expect(exclusiveEnd("2026-06-15")).toBe("2026-06-16");
  });

  // The regression this module exists for: a hand-picked "Jun 1 – Jun 30" used to reach the API
  // as to=2026-06-30, and `.lt("occurred_at", "2026-06-30")` dropped June 30 without a word.
  it("carries a month end over, so a full-June pick covers all of June", () => {
    expect(exclusiveEnd("2026-06-30")).toBe("2026-07-01");
  });

  it("carries a year end over", () => {
    expect(exclusiveEnd("2026-12-31")).toBe("2027-01-01");
  });

  it("handles a leap day", () => {
    expect(exclusiveEnd("2028-02-29")).toBe("2028-03-01");
    expect(exclusiveEnd("2026-02-28")).toBe("2026-03-01");
  });

  it("tolerates a full ISO timestamp by reading only its calendar day", () => {
    expect(exclusiveEnd("2026-06-30T17:45:00Z")).toBe("2026-07-01");
  });

  it("returns a malformed value untouched rather than inventing a date", () => {
    expect(exclusiveEnd("not-a-date")).toBe("not-a-date");
  });
});

describe("ymd — the user's calendar day, not a UTC round trip", () => {
  it("reads the local date parts", () => {
    // Late-evening local time is the case where toISOString() would roll a US date forward.
    expect(ymd(new Date(2026, 5, 30, 23, 30))).toBe("2026-06-30");
  });

  it("pads single-digit months and days", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("lastFullMonth — a finished period, stated inclusively", () => {
  it("returns the previous calendar month's first and last day", () => {
    const w = lastFullMonth(new Date(2026, 7, 28)); // 2026-08-28
    expect(w).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("crosses a year boundary", () => {
    expect(lastFullMonth(new Date(2026, 0, 9))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("picks up February's real length", () => {
    expect(lastFullMonth(new Date(2028, 2, 3))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  // The API's own month-alignment check reads the exclusive form: both ends must land on the 1st.
  it("is month-aligned once its end is made exclusive", () => {
    const w = lastFullMonth(new Date(2026, 7, 28));
    expect(w.from.slice(8, 10)).toBe("01");
    expect(exclusiveEnd(w.to).slice(8, 10)).toBe("01");
  });
});

describe("trailingDays", () => {
  it("counts back from today and includes today", () => {
    expect(trailingDays(90, new Date(2026, 7, 28))).toEqual({ from: "2026-05-30", to: "2026-08-28" });
  });

  it("crosses a year boundary", () => {
    expect(trailingDays(10, new Date(2026, 0, 5))).toEqual({ from: "2025-12-26", to: "2026-01-05" });
  });
});
