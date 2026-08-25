import { describe, it, expect } from "vitest";
import {
  normalizeWindow, defaultWindow, describeWindow, describeFixes,
  parseYmd, addDays, windowDays, DEFAULT_WINDOW_DAYS,
} from "./spendWindow.js";

/**
 * The window comes out of a URL, so every input below is something a real link can contain: a range
 * typed backwards, a stale bookmark, a hand-edited date that is not a date. The rule the suite enforces
 * is that none of them may produce a window that LOOKS fine and reports nothing — an empty report reads
 * as a fleet that bought no fuel.
 *
 * This module validates the window; it does not pick it. `DateRangeFilter` does that, the same control
 * every other page uses.
 */
const TODAY = "2026-08-25";

describe("parseYmd", () => {
  it("takes a real calendar day", () => {
    expect(parseYmd("2026-08-05")).toBe("2026-08-05");
  });

  it("rejects a day that does not exist rather than rolling it into the next month", () => {
    // `new Date("2026-02-31")` is March 3. A window silently moved a month is worse than one refused.
    expect(parseYmd("2026-02-31")).toBeNull();
    expect(parseYmd("2026-13-01")).toBeNull();
  });

  it("rejects everything that is not a YYYY-MM-DD string", () => {
    for (const v of ["", "yesterday", "08/05/2026", "2026-8-5", 20260805, null, undefined, ["2026-08-05"]]) {
      expect(parseYmd(v)).toBeNull();
    }
  });
});

describe("date arithmetic", () => {
  it("counts an inclusive span, so one day is one day", () => {
    expect(windowDays("2026-08-05", "2026-08-05")).toBe(1);
    expect(windowDays("2026-08-05", "2026-08-12")).toBe(8);
  });

  it("crosses a month and a year boundary without drifting", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(windowDays("2025-12-31", "2026-01-01")).toBe(2);
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("defaults to a 90-day window ending today", () => {
    expect(defaultWindow(TODAY)).toEqual({ from: "2026-05-28", to: TODAY });
    expect(windowDays(defaultWindow(TODAY).from, defaultWindow(TODAY).to)).toBe(DEFAULT_WINDOW_DAYS);
  });
});

describe("normalizeWindow", () => {
  it("passes a sound window through untouched and says nothing was changed", () => {
    const r = normalizeWindow("2026-08-05", "2026-08-12", TODAY);
    expect(r.window).toEqual({ from: "2026-08-05", to: "2026-08-12" });
    expect(r.fixes).toEqual([]);
    expect(r.usedDefault).toBe(false);
    expect(describeFixes(r.fixes)).toBeNull();
  });

  it("falls back to the default only when NEITHER end was given", () => {
    const r = normalizeWindow(undefined, undefined, TODAY);
    expect(r.window).toEqual(defaultWindow(TODAY));
    expect(r.usedDefault).toBe(true);
    expect(r.fixes).toEqual([]); // absent is normal, not a mistake
  });

  // A window the picker produced must survive untouched, or the control appears to fight the reader.
  it("leaves a range the date picker produced exactly as picked", () => {
    const r = normalizeWindow("2026-07-01", "2026-07-31", TODAY);
    expect(r.window).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(r.fixes).toEqual([]);
  });

  it("accepts a single-day window, which is what clicking one date twice produces", () => {
    const r = normalizeWindow("2026-08-12", "2026-08-12", TODAY);
    expect(r.window).toEqual({ from: "2026-08-12", to: "2026-08-12" });
    expect(r.fixes).toEqual([]);
  });

  it("swaps a range typed backwards instead of reporting an empty fleet", () => {
    const r = normalizeWindow("2026-08-12", "2026-08-05", TODAY);
    expect(r.window).toEqual({ from: "2026-08-05", to: "2026-08-12" });
    expect(r.fixes).toContain("swapped");
    expect(describeFixes(r.fixes)).toContain("swapped");
  });

  it("pulls a future end back to today", () => {
    const r = normalizeWindow("2026-08-05", "2031-01-01", TODAY);
    expect(r.window.to).toBe(TODAY);
    expect(r.fixes).toContain("clamped-future");
  });

  it("handles a window entirely in the future without inverting itself", () => {
    const r = normalizeWindow("2030-01-01", "2030-02-01", TODAY);
    expect(r.window.from <= r.window.to).toBe(true);
    expect(r.window.to).toBe(TODAY);
  });

  it("reports an unparseable date rather than pretending it was absent", () => {
    const r = normalizeWindow("not-a-date", "2026-08-12", TODAY);
    expect(r.fixes).toContain("from-invalid");
    expect(r.window.to).toBe("2026-08-12");
    expect(r.window.from <= r.window.to).toBe(true);
  });

  it("bounds the window when only an end date is given, rather than widening it", () => {
    const r = normalizeWindow(undefined, "2026-08-12", TODAY);
    expect(r.window.to).toBe("2026-08-12");
    expect(windowDays(r.window.from, r.window.to)).toBe(DEFAULT_WINDOW_DAYS);
    expect(r.usedDefault).toBe(false);
  });

  it("runs to today when only a start date is given", () => {
    const r = normalizeWindow("2026-08-12", undefined, TODAY);
    expect(r.window).toEqual({ from: "2026-08-12", to: TODAY });
  });

  it("never returns a reversed or future window, whatever it is handed", () => {
    const nasty: Array<[unknown, unknown]> = [
      ["2031-01-01", "2000-01-01"], ["", ""], [null, "2026-08-05"], ["2026-02-31", "2026-13-40"],
      [[], {}], ["2026-08-25", "2026-08-25"], ["9999-12-31", "9999-12-31"],
    ];
    for (const [a, b] of nasty) {
      const r = normalizeWindow(a, b, TODAY);
      expect(r.window.from <= r.window.to, `reversed for ${JSON.stringify([a, b])}`).toBe(true);
      expect(r.window.to <= TODAY, `future for ${JSON.stringify([a, b])}`).toBe(true);
      expect(parseYmd(r.window.from)).not.toBeNull();
      expect(parseYmd(r.window.to)).not.toBeNull();
    }
  });
});

describe("describeWindow", () => {
  it("reads as a range, in UTC so it cannot drift a day by browser locale", () => {
    expect(describeWindow({ from: "2026-08-05", to: "2026-08-12" })).toBe("Aug 5 – Aug 12");
  });

  it("collapses a single day to one date", () => {
    expect(describeWindow({ from: "2026-08-12", to: "2026-08-12" })).toBe("Aug 12");
  });
});
