import { describe, expect, it } from "vitest";
import { MIN_WINDOW_COVERED, fleetMpgWindowNote, resolveFleetMpgWindow } from "./fleetMpgWindow.js";

/**
 * Which days a fleet MPG may be measured over (D-PREC2).
 *
 * The bug this exists for: the miles come from a collector that reaches ~now and the gallons from a
 * nightly derivation that reaches yesterday at best, so a window past the derivation's reach has
 * miles in its tail and no gallons. On 2026-09-20 that made the dashboard read 8.61 MPG against a
 * true 6.91 — a 25% overstatement, for a week, while `measuredShare` read 0.966 and could not see it.
 */
describe("resolveFleetMpgWindow", () => {
  it("leaves a window alone when the roll-up has passed its end", () => {
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-10-05");
    expect(w).toMatchObject({ from: "2026-09-01", to: "2026-09-30", partial: false, refusal: null });
  });

  it("leaves it alone when the roll-up lands exactly on its end", () => {
    // The boundary is inclusive: a roll-up that has derived the 30th HAS the 30th.
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-09-30");
    expect(w.partial).toBe(false);
    expect(w.to).toBe("2026-09-30");
  });

  it("clamps the END to the roll-up's reach, so both sources cover the same days", () => {
    // The real shape of the outage: asked for thirty days, the gallons stop five days short.
    const w = resolveFleetMpgWindow("2026-08-22", "2026-09-21", "2026-09-15");
    expect(w.to).toBe("2026-09-15");
    expect(w.requestedTo).toBe("2026-09-21");
    expect(w.partial).toBe(true);
    // ⚠ Answered, not refused. Clamping removes the bias; refusing would only decline to report it.
    expect(w.refusal).toBeNull();
    expect(w.fuelThrough).toBe("2026-09-15");
  });

  it("never clamps the START — a missing past is a gap, not a short window", () => {
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-09-20");
    expect(w.from).toBe("2026-09-01");
  });

  it("refuses when the roll-up has never derived a day, and blames the feed rather than the fleet", () => {
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", null);
    expect(w.refusal).toMatch(/roll-up has not produced a single day/i);
    // ⚠ The distinction that matters: NOT "no tractor fuel was purchased". That sentence is what
    // `computeFleetMpg` says when gallons are zero, and it sends a reader to look at their fuel
    // cards instead of at the sweep.
    expect(w.refusal).not.toMatch(/purchased/i);
    expect(w.refusal).toMatch(/not the fleet/i);
  });

  it("refuses when the roll-up stops before the window even opens, and names the day", () => {
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-08-20");
    expect(w.refusal).toMatch(/2026-08-20/);
    expect(w.refusal).toMatch(/stalled/i);
  });

  it("refuses when the clamp would answer a materially different question", () => {
    // 30 days asked for, 6 derived — 20%, well under the floor. The figure would be accurate and
    // about a week nobody asked about, which is worse than no figure.
    const w = resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-09-06");
    expect(w.partial).toBe(true);
    expect(w.refusal).toMatch(/20% of the period asked for/i);
    // It still reports WHERE the roll-up stopped, so the refusal is actionable rather than blank.
    expect(w.fuelThrough).toBe("2026-09-06");
  });

  it("answers either side of the floor, so the threshold is the thing being tested", () => {
    // 20 of 30 days is 66.7% — above 0.5, answered and partial.
    expect(resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-09-20").refusal).toBeNull();
    // 14 of 30 is 46.7% — below, refused.
    expect(resolveFleetMpgWindow("2026-09-01", "2026-09-30", "2026-09-14").refusal).not.toBeNull();
    expect(MIN_WINDOW_COVERED).toBe(0.5);
  });

  it("consults no clock — the same window resolves the same way whenever it is asked", () => {
    // D-FLEET6. A rule that reached for `new Date()` would answer differently at 23:59 and 00:01,
    // and the series would disagree with the total it was computed beside.
    const a = resolveFleetMpgWindow("2026-01-01", "2026-01-31", "2026-01-20");
    const b = resolveFleetMpgWindow("2026-01-01", "2026-01-31", "2026-01-20");
    expect(a).toEqual(b);
    expect(a.to).toBe("2026-01-20");
  });

  it("handles a single-day window, which is a legal question", () => {
    expect(resolveFleetMpgWindow("2026-09-15", "2026-09-15", "2026-09-15").partial).toBe(false);
    expect(resolveFleetMpgWindow("2026-09-15", "2026-09-15", "2026-09-14").refusal).toMatch(/stalled/i);
  });
});

describe("fleetMpgWindowNote", () => {
  it("names both days, because a reader needs to know what was swapped for what", () => {
    const note = fleetMpgWindowNote({ partial: true, to: "2026-09-15", requestedTo: "2026-09-21" });
    expect(note).toMatch(/2026-09-15/);
    expect(note).toMatch(/2026-09-21/);
  });

  it("is null for a whole window, so a surface can render it unconditionally", () => {
    expect(fleetMpgWindowNote({ partial: false, to: "2026-09-21", requestedTo: "2026-09-21" })).toBeNull();
  });
});
