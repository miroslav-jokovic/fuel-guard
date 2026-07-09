import { describe, it, expect } from "vitest";
import { resolveTankFuel } from "./tankFuel.js";
import type { TankReading } from "../samsara.js";

const R = (time: string, percent: number): TankReading => ({ time, percent });

describe("resolveTankFuel (S4 — tank & fuel level module)", () => {
  it("returns nulls (and the tank-rise after-% for display) when there are no fuel readings", () => {
    expect(resolveTankFuel([], "2026-06-30T14:00:00Z", 100, 150, 88)).toEqual({
      pctBefore: null,
      pctAfter: 88, // tank-rise event still supplies the displayed after-level
      observedRiseGal: null,
      shortGal: null,
    });
  });

  it("computes before %, plateau-peak after %, observed rise and short from the FULL capacity", () => {
    const readings = [
      R("2026-06-30T13:30:00Z", 20), // before
      R("2026-06-30T14:30:00Z", 85), // after (plateau)
      R("2026-06-30T15:30:00Z", 90), // higher plateau peak within 3h
      R("2026-06-30T19:00:00Z", 60), // outside the 3h plateau window → ignored
    ];
    const r = resolveTankFuel(readings, "2026-06-30T14:00:00Z", 100, 150, null);
    expect(r.pctBefore).toBe(20);
    expect(r.pctAfter).toBe(90); // plateau peak, no tank-rise override
    // observed rise = (90-20)/100 * 150 = 105 gal; billed 100 → no shortfall (0)
    expect(r.observedRiseGal).toBe(105);
    expect(r.shortGal).toBe(0);
  });

  it("flags a shortfall when the observed rise is far below the billed gallons", () => {
    const readings = [R("2026-06-30T13:30:00Z", 20), R("2026-06-30T14:30:00Z", 40)];
    const r = resolveTankFuel(readings, "2026-06-30T14:00:00Z", 100, 150, null);
    // observed = (40-20)/100*150 = 30 gal; billed 100 → short 70
    expect(r.observedRiseGal).toBe(30);
    expect(r.shortGal).toBe(70);
  });

  it("prefers the tank-rise event's after-% for the DISPLAYED level but keeps rise/short from the plateau", () => {
    const readings = [R("2026-06-30T13:30:00Z", 20), R("2026-06-30T14:30:00Z", 85)];
    const r = resolveTankFuel(readings, "2026-06-30T14:00:00Z", 100, 150, 92);
    expect(r.pctAfter).toBe(92); // tank-rise event value shown
    expect(r.observedRiseGal).toBe(Math.round(((85 - 20) / 100) * 150 * 10) / 10); // plateau 85, not 92
  });

  it("returns null short/rise when tank capacity is unknown (check is not measurable)", () => {
    const readings = [R("2026-06-30T13:30:00Z", 20), R("2026-06-30T14:30:00Z", 85)];
    const r = resolveTankFuel(readings, "2026-06-30T14:00:00Z", 100, null, null);
    expect(r.observedRiseGal).toBeNull();
    expect(r.shortGal).toBeNull();
    expect(r.pctBefore).toBe(20);
  });

  it("yields NO before-level when there is no trusted fill anchor (matchedAt null)", () => {
    const readings = [R("2026-06-30T11:30:00Z", 59), R("2026-06-30T14:30:00Z", 85)];
    // No tank-rise event and no matched stop → matchedAt null. Must not read a wrong-time level.
    const r = resolveTankFuel(readings, null, 124.61, 240, 85);
    expect(r.pctBefore).toBeNull();
    expect(r.observedRiseGal).toBeNull();
    expect(r.pctAfter).toBe(85); // tank-rise after-% still displayed
  });

  it("yields NO before-level when the anchor is untrusted (weak match), even if a reading exists", () => {
    // A noon-ish reading looks like 59% full, but the anchor is not a trusted physical fill moment.
    const readings = [R("2026-06-30T11:30:00Z", 59), R("2026-06-30T14:30:00Z", 85)];
    const r = resolveTankFuel(readings, "2026-06-30T12:00:00Z", 124.61, 240, null, false);
    expect(r.pctBefore).toBeNull(); // the tank-space check stays silent
  });

  it("still computes the before-level for a trusted anchor (explicit trusted=true)", () => {
    const readings = [R("2026-06-30T13:30:00Z", 20), R("2026-06-30T14:30:00Z", 85)];
    const r = resolveTankFuel(readings, "2026-06-30T14:00:00Z", 100, 150, null, true);
    expect(r.pctBefore).toBe(20);
  });
});
