import { describe, it, expect } from "vitest";
import { buildTruckFuelState } from "./truckState.js";

const H = 3_600_000;
const now = Date.parse("2026-07-15T14:00:00Z");
const fresh = (value: number) => ({ time: "2026-07-15T13:45:00Z", value }); // 15 min old
const cfg = { reservePct: 20, mpgSafetyFactor: 0.9 };
const base = {
  fuelSamples: [fresh(61), fresh(59), fresh(60)], // latest reading 60% = 120 gal of 200
  tankCapacityGal: 200,
  observedMaxFillGal: null,
  baselineMpg: 6.5,
  hos: { driveRemainingMs: 10 * H, shiftRemainingMs: 12 * H, cycleRemainingMs: 40 * H, timeUntilBreakMs: 8 * H },
  isReefer: false,
  loadGrossLb: 72000,
  lastFillTimeMs: null,
  nowMs: now,
};

describe("buildTruckFuelState", () => {
  it("composes gallons, reserve, ranges; reachable = min(fuel, HOS)", () => {
    const st = buildTruckFuelState(base, cfg);
    expect(st.gallonsOnHand).toBeCloseTo(120, 0); // 60% of 200
    expect(st.fillTargetGal).toBeCloseTo(200, 0); // fill target 100% of tank by default
    expect(st.reserveGal).toBeCloseTo(40, 0); // 20% of the TANK
    expect(st.reachableMiles).toBe(Math.min(st.fuelRangeMiles!, st.hosReachableMiles!));
    expect(st.confidence.fuelPresent && st.confidence.hosPresent && st.confidence.mpgPresent).toBe(true);
    expect(st.flags).toEqual([]);
  });
  it("reserve is a share of the tank, not of a usable fraction", () => {
    // Before FP4: reserve = 20% of (200 × 0.95) = 38 gal — 19% on the gauge. Now: 20% of the tank = 40 gal, and
    // the fill target moves the top of the tank without moving the floor.
    const top = buildTruckFuelState(base, { ...cfg, fillTargetPct: 100 });
    const early = buildTruckFuelState(base, { ...cfg, fillTargetPct: 95 });
    expect(top.reserveGal).toBeCloseTo(40, 6);
    expect(early.reserveGal).toBeCloseTo(40, 6);
    expect(top.fillTargetGal).toBeCloseTo(200, 6);
    expect(early.fillTargetGal).toBeCloseTo(190, 6);
    expect(top.aboveReserveGal).toBeCloseTo(80, 6); // 120 on hand − 40
  });
  it("HOS binds when the shift clock is short", () => {
    const st = buildTruckFuelState({ ...base, hos: { ...base.hos, shiftRemainingMs: 1 * H } }, cfg);
    expect(st.hosReachableMiles).toBeCloseTo(55, 0);
    expect(st.reachableMiles).toBe(st.hosReachableMiles); // HOS is the binding constraint
  });
  it("weight-legal fill is NOT zero when the load is unknown (null) — else the truck can never fuel", () => {
    const st = buildTruckFuelState({ ...base, loadGrossLb: null }, cfg);
    expect(st.weightLegalFillGal).toBeGreaterThanOrEqual(st.fillTargetGal); // falls back to the tank itself, so a 100% target is exactly reachable
    expect(st.flags).toContain("load_weight_unknown");            // ...but we flag that fills are uncapped
  });
  it("does NOT flag load_weight_unknown when a load weight is provided", () => {
    const st = buildTruckFuelState({ ...base, loadGrossLb: 72000 }, cfg);
    expect(st.flags).not.toContain("load_weight_unknown");
  });
  it("weight-legal fill binds for a genuinely heavy load", () => {
    const st = buildTruckFuelState({ ...base, loadGrossLb: 79900 }, cfg); // 100 lb under max -> ~14 gal room
    expect(st.weightLegalFillGal).toBeLessThan(20);
  });

    it("reefer shortens fuel range vs an identical dry van", () => {
    const dry = buildTruckFuelState(base, cfg).fuelRangeMiles!;
    const reefer = buildTruckFuelState({ ...base, isReefer: true }, cfg).fuelRangeMiles!;
    expect(reefer).toBeLessThan(dry);
  });
  it("flags a below-reserve, stale, post-fill, mpg-less, hos-less truck (never silent)", () => {
    const st = buildTruckFuelState(
      { ...base, fuelSamples: [{ time: "2026-07-15T10:00:00Z", value: 5 }], baselineMpg: null,
        hos: { driveRemainingMs: null, shiftRemainingMs: null, cycleRemainingMs: null, timeUntilBreakMs: null },
        lastFillTimeMs: Date.parse("2026-07-15T09:30:00Z") },
      cfg,
    );
    expect(st.belowReserve).toBe(true);
    expect(st.flags).toContain("below_reserve");
    expect(st.flags).toContain("stale_fuel_reading");
    expect(st.flags).toContain("post_fill_reading_distrusted");
    expect(st.flags).toContain("no_baseline_mpg");
    expect(st.flags).toContain("no_hos");
  });
});
