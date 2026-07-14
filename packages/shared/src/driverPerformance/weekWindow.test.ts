import { describe, it, expect } from "vitest";
import { weekWindow, recentWeeks } from "./weekWindow.js";

const TZ = "America/Chicago";

describe("weekWindow", () => {
  it("returns Mon–Sun bounds for a mid-week timestamp (Chicago)", () => {
    const now = Date.UTC(2026, 6, 15, 17, 0, 0); // Wed 2026-07-15 12:00 CDT
    const w = weekWindow(now, TZ);
    expect(w.weekStart).toBe("2026-07-13"); // Monday
    expect(w.weekEnd).toBe("2026-07-19"); // Sunday
    expect(new Date(w.windowStartIso).getTime()).toBe(Date.UTC(2026, 6, 13, 5, 0, 0)); // local midnight = 05:00 UTC (CDT)
    expect(new Date(w.windowEndIso).getTime()).toBe(Date.UTC(2026, 6, 20, 5, 0, 0)); // next Monday 00:00 local
  });

  it("a Sunday belongs to the week that started the prior Monday", () => {
    const now = Date.UTC(2026, 6, 20, 1, 0, 0); // Sun 2026-07-19 20:00 CDT
    const w = weekWindow(now, TZ);
    expect(w.weekStart).toBe("2026-07-13");
    expect(w.weekEnd).toBe("2026-07-19");
  });

  it("weekStartsOn=0 (Sunday) shifts the boundary", () => {
    const now = Date.UTC(2026, 6, 15, 17, 0, 0);
    const w = weekWindow(now, TZ, 0);
    expect(w.weekStart).toBe("2026-07-12"); // Sunday
    expect(w.weekEnd).toBe("2026-07-18");
  });
});

describe("recentWeeks", () => {
  it("returns n consecutive prior weeks, current first", () => {
    const now = Date.UTC(2026, 6, 15, 17, 0, 0);
    const weeks = recentWeeks(now, TZ, 3);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-07-13", "2026-07-06", "2026-06-29"]);
  });
});
