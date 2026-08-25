import { describe, it, expect } from "vitest";
import {
  normalizeWindow, defaultWindow, matchPreset, describeWindow, describeFixes,
  parseYmd, addDays, windowDays, lastCompleteWeek, startOfMonth, endOfMonth,
  SPEND_PRESETS, MAX_WINDOW_DAYS,
} from "./spendWindow.js";

/**
 * The window comes out of a URL, so every one of these inputs is something a real link can contain:
 * a range typed backwards, a bookmark from before a clock change, a hand-edited date that is not a
 * date. The rule the suite enforces is that none of them may produce a window that LOOKS fine and
 * reports nothing — an empty report reads as a fleet that bought no fuel.
 */
const TODAY = "2026-08-25"; // a Tuesday

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
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });

  it("finds month edges", () => {
    expect(startOfMonth("2026-08-25")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-25")).toBe("2026-08-31");
  });

  it("gives the last COMPLETE week, never a partial current one", () => {
    // Tuesday 2026-08-25 → the week that ENDED Sunday 2026-08-23.
    expect(lastCompleteWeek(TODAY)).toEqual({ from: "2026-08-17", to: "2026-08-23" });
  });

  it("does not return the week in progress when asked on a Monday", () => {
    // Monday 2026-08-24 → still the week ending Sunday the 23rd.
    expect(lastCompleteWeek("2026-08-24")).toEqual({ from: "2026-08-17", to: "2026-08-23" });
  });

  it("returns the week just gone when asked on a Sunday", () => {
    // Sunday 2026-08-23 is itself the last day of a complete week, but that week is TODAY's, so the
    // answer is the one before it — a report run on Sunday must not cover Sunday only.
    expect(lastCompleteWeek("2026-08-23")).toEqual({ from: "2026-08-10", to: "2026-08-16" });
  });
});

describe("presets", () => {
  it("every preset resolves to a window that ends no later than today", () => {
    for (const p of SPEND_PRESETS) {
      const w = p.resolve(TODAY);
      expect(w.to <= TODAY, `${p.key} ends ${w.to}`).toBe(true);
      expect(w.from <= w.to, `${p.key} is reversed`).toBe(true);
    }
  });

  it("counts the inclusive span the label promises", () => {
    const d7 = SPEND_PRESETS.find((p) => p.key === "d7")!.resolve(TODAY);
    expect(windowDays(d7.from, d7.to)).toBe(7);
    const d30 = SPEND_PRESETS.find((p) => p.key === "d30")!.resolve(TODAY);
    expect(windowDays(d30.from, d30.to)).toBe(30);
  });

  it("names the window when it matches a preset, so the bar need not print two dates", () => {
    expect(matchPreset(defaultWindow(TODAY), TODAY)?.key).toBe("d90");
    expect(matchPreset(lastCompleteWeek(TODAY), TODAY)?.key).toBe("week");
  });

  it("names nothing for a window the reader built by hand", () => {
    expect(matchPreset({ from: "2026-08-05", to: "2026-08-12" }, TODAY)).toBeNull();
  });

  it("gives last month as a whole month, not a rolling 30 days", () => {
    expect(SPEND_PRESETS.find((p) => p.key === "lastmonth")!.resolve(TODAY))
      .toEqual({ from: "2026-07-01", to: "2026-07-31" });
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

  // The regression that started all of this: a window that parses but is nonsense used to sail through.
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

  it("shortens a window long enough to span a contract change", () => {
    const r = normalizeWindow("2000-01-01", TODAY, TODAY);
    expect(windowDays(r.window.from, r.window.to)).toBe(MAX_WINDOW_DAYS);
    expect(r.fixes).toContain("clamped-span");
  });

  it("reports an unparseable date rather than pretending it was absent", () => {
    const r = normalizeWindow("not-a-date", "2026-08-12", TODAY);
    expect(r.fixes).toContain("from-invalid");
    expect(r.window.to).toBe("2026-08-12");
    expect(r.window.from <= r.window.to).toBe(true);
  });

  it("bounds the window when only an end date is given, rather than widening it", () => {
    // Someone who set an end date meant to bound the period, not to open it up to the full default.
    const r = normalizeWindow(undefined, "2026-08-12", TODAY);
    expect(r.window.to).toBe("2026-08-12");
    expect(windowDays(r.window.from, r.window.to)).toBe(90);
    expect(r.usedDefault).toBe(false);
  });

  it("runs to today when only a start date is given", () => {
    const r = normalizeWindow("2026-08-12", undefined, TODAY);
    expect(r.window).toEqual({ from: "2026-08-12", to: TODAY });
  });

  it("accepts a single-day window", () => {
    const r = normalizeWindow("2026-08-12", "2026-08-12", TODAY);
    expect(r.window).toEqual({ from: "2026-08-12", to: "2026-08-12" });
    expect(r.fixes).toEqual([]);
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
      expect(windowDays(r.window.from, r.window.to)).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
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
