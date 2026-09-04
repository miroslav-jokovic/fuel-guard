import { describe, it, expect } from "vitest";
import {
  MIN_MEASURED_SHARE,
  PLAUSIBLE_FLEET_MPG,
  computeFleetMpg,
  mileageDivergence,
  type FleetMpgInputs,
} from "./fleetEfficiency.js";

/**
 * The one definition of fleet MPG (M1, D-MPG1).
 *
 * Every case below is a way the number could be wrong while looking right — which is the whole
 * problem this module exists for. The two pages that disagreed by 10.7% were each internally
 * consistent; nothing about either figure said "this is over 60% of the fleet" or "these miles were
 * spread across days by drive-second weight". So the assertions are as much about what travels WITH
 * the number as about the division.
 */
const base: FleetMpgInputs = {
  miles: 700,
  milesSource: "measured",
  gallons: 100,
  gallonsWithMiles: 100,
  trucksMeasured: 10,
  trucksUnmeasured: 0,
};
const inputs = (over: Partial<FleetMpgInputs> = {}): FleetMpgInputs => ({ ...base, ...over });

describe("computeFleetMpg", () => {
  it("divides the miles by the fuel that has miles behind it, not by all the fuel", () => {
    // The failure this prevents: a 90%-covered fleet divided by 100% of its gallons reads 10% low,
    // and reads entirely plausibly. Here 700 miles came from the 90 gallons that could be measured.
    const r = computeFleetMpg(inputs({ gallons: 100, gallonsWithMiles: 90 }));
    expect(r.mpg).toBe(7.78); // 700 ÷ 90, not 700 ÷ 100 = 7.00
    expect(r.measuredShare).toBe(0.9);
  });

  it("reproduces the spend report's July 2026 figure from the real totals", () => {
    // Measured on production 2026-09-04: 1,549,941.7 allocated miles over 221,944.6 gallons with
    // miles, out of 226,305.1 gallons — the Spend trend tab's 6.98.
    const r = computeFleetMpg({
      miles: 1_549_941.7,
      milesSource: "allocated",
      gallons: 226_305.1,
      gallonsWithMiles: 221_944.6,
      trucksMeasured: 190,
      trucksUnmeasured: 4,
    });
    expect(r.mpg).toBe(6.98);
    expect(r.milesSource).toBe("allocated");
  });

  it("carries the provenance of the miles, and carries it even when it withholds the number", () => {
    // `milesSource` is part of the answer, not metadata a surface may drop: a figure built on miles
    // spread across days is not the same claim as one built on two odometer readings.
    expect(computeFleetMpg(inputs({ milesSource: "fill_interval" })).milesSource).toBe("fill_interval");
    const withheld = computeFleetMpg(inputs({ milesSource: "allocated", gallons: 0, gallonsWithMiles: 0 }));
    expect(withheld.mpg).toBeNull();
    expect(withheld.milesSource).toBe("allocated");
  });

  it("withholds the figure below the coverage floor, and says both percentages", () => {
    const r = computeFleetMpg(inputs({ gallons: 100, gallonsWithMiles: 50 }));
    expect(r.mpg).toBeNull();
    expect(r.reason).toContain("50%");
    expect(r.reason).toContain("60%");
    // The inputs still come back — a surface that wants to say "over half the fleet" still can.
    expect(r.measuredShare).toBe(0.5);
    expect(r.gallonsWithMiles).toBe(50);
  });

  it("reports the figure exactly at the floor — the floor is a minimum, not a gap", () => {
    const r = computeFleetMpg(inputs({ miles: 420, gallons: 100, gallonsWithMiles: 60 }));
    expect(r.measuredShare).toBe(MIN_MEASURED_SHARE);
    expect(r.mpg).toBe(7);
  });

  it("withholds an impossible MPG and blames the distance, not the fuel", () => {
    // Fuel is a purchase with a receipt; miles are a measurement. When they imply 14 MPG it is the
    // odometer that is wrong, and saying so is the difference between a lead and a mystery.
    const r = computeFleetMpg(inputs({ miles: 1_400 }));
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/outside what a tractor can do/);
    expect(r.reason).toMatch(/distance is wrong rather than the fuel/);
    expect(computeFleetMpg(inputs({ miles: 100 })).mpg).toBeNull(); // 1.0 MPG, below the band
    expect(computeFleetMpg(inputs({ miles: PLAUSIBLE_FLEET_MPG.high * 100 })).mpg).toBe(12); // the edge is inside
  });

  it("distinguishes no fuel, no measured fuel and no distance — three different things", () => {
    const noFuel = computeFleetMpg(inputs({ gallons: 0, gallonsWithMiles: 0 }));
    const noMeasuredFuel = computeFleetMpg(inputs({ gallons: 100, gallonsWithMiles: 0 }));
    const noDistance = computeFleetMpg(inputs({ miles: 0 }));
    expect(noFuel.reason).toMatch(/No tractor fuel was purchased/);
    expect(noMeasuredFuel.reason).toMatch(/no fuel in this period has a measured distance/i);
    expect(noDistance.reason).toMatch(/not trucks that stood still/);
    // None of them is a zero. A zero here would enter a cost-per-mile as a measurement.
    expect([noFuel.mpg, noMeasuredFuel.mpg, noDistance.mpg]).toEqual([null, null, null]);
  });

  it("clamps measured gallons to the period's gallons rather than reporting over-coverage", () => {
    // `gallonsWithMiles > gallons` is not rounding — it means the numerator and denominator were read
    // over different windows. A measured share above 1 would read as extra confidence.
    const r = computeFleetMpg(inputs({ gallons: 100, gallonsWithMiles: 130 }));
    expect(r.measuredShare).toBe(1);
    expect(r.gallonsWithMiles).toBe(100);
  });

  it("reports truck coverage without gating on it", () => {
    // A fleet where most trucks are new and barely fuelled is not the same failure as one where most
    // of the FUEL is unaccounted for. The first still has a usable MPG; only the second does not.
    const r = computeFleetMpg(inputs({ trucksMeasured: 2, trucksUnmeasured: 8 }));
    expect(r.truckCoverage).toBe(0.2);
    expect(r.mpg).toBe(7);
    expect(r.trucksUnmeasured).toBe(8);
  });

  it("has no truck coverage to report when no trucks were named, rather than claiming zero", () => {
    const r = computeFleetMpg(inputs({ trucksMeasured: 0, trucksUnmeasured: 0 }));
    expect(r.truckCoverage).toBeNull();
    expect(r.mpg).toBe(7);
  });

  it("survives a non-finite input without inventing a number", () => {
    const r = computeFleetMpg(inputs({ miles: Number.NaN }));
    expect(r.mpg).toBeNull();
    expect(Number.isFinite(r.miles)).toBe(true);
  });
});

describe("mileageDivergence", () => {
  it("reproduces the two months the plan measured", () => {
    // 2026-07: allocated miles agreed with Samsara's IFTA miles to within a tenth of a percent.
    expect(mileageDivergence(1_549_942, 1_551_133)).toBe(-0.0008);
    // 2026-08: they did not — and nothing in the product compared them for five weeks.
    expect(mileageDivergence(1_696_637, 1_634_889)).toBe(0.0378);
    // The per-fill numerator is low in the same month, which is why the two pages differ by 10%.
    expect(mileageDivergence(1_595_483, 1_634_889)).toBe(-0.0241);
  });

  it("is signed, so a reader can tell which way the feed moved", () => {
    expect(mileageDivergence(110, 100)).toBe(0.1);
    expect(mileageDivergence(90, 100)).toBe(-0.1);
  });

  it("has nothing to say when either side has no distance — an absent feed is not agreement", () => {
    expect(mileageDivergence(0, 100)).toBeNull();
    expect(mileageDivergence(100, 0)).toBeNull();
    expect(mileageDivergence(Number.NaN, 100)).toBeNull();
  });
});
