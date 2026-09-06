import { describe, it, expect } from "vitest";
import {
  MIN_MEASURED_SHARE,
  MPG_PLAUSIBLE_MAX,
  PLAUSIBLE_FLEET_MPG,
  computeFleetMpg,
  computeSubjectMpg,
  reportableMpg,
  mileageDivergence,
  type FleetMpgInputs,
  type SubjectFill,
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

/**
 * The per-SUBJECT entry point (M4, D-MPG3) — a driver's or a truck's figure, over its own fills.
 *
 * The cases below are all versions of one question: can this be got wrong in a way that still looks
 * right? Three ways it could, and each has a test:
 *
 *   • **the −1.31%/−2.41% bias** — weighting `computed_mpg` by `gallons` when the scorer divided by
 *     `gallons + intermediateGallons`. The first test constructs a subject where the two differ and
 *     pins the answer the biased arithmetic cannot produce;
 *   • **dropping the fill that has no span** — which reads HIGH by exactly the fuel dropped, the
 *     mirror image of the same error;
 *   • **printing a figure over a third of the subject's fuel** — plausible, and wrong.
 */
const fill = (miles: number | null, mpg: number | null, gallons: number): SubjectFill => ({ miles, mpg, gallons });

describe("computeSubjectMpg", () => {
  it("recovers the gallons each span actually burned rather than multiplying an MPG back out", () => {
    // Truck fuels 20 gal (no span — first fill of the window), then drives 700 miles and buys
    // another 100. Between them it topped up 40 gal with no odometer, so the scorer stored
    // `computed_mpg = 700 ÷ (100 + 40) = 5.0` on the closing fill.
    //
    // Truth: 700 miles on the 140 gallons that span consumed = 5.00 MPG. Method A weights that 5.0
    // by `gallons` alone, so it implies 5.0 × 100 = 500 miles for a span that covered 700 — short by
    // exactly the intermediate share, which is the −1.31% / −2.41% of §1.4 in miniature.
    const r = computeSubjectMpg([fill(null, null, 20), fill(700, 5, 100), fill(null, null, 40)]);
    expect(r.miles).toBe(700);
    expect(r.gallonsWithMiles).toBe(140); // 700 ÷ 5 — the intermediate 40 gal are in the span
    expect(r.mpg).toBe(5);
    expect(r.milesSource).toBe("fill_interval");
  });

  it("keeps the fuel of a fill it cannot measure in the denominator's denominator, not in the ratio", () => {
    // The opening fill's 20 gallons have no span behind them: they are real fuel and they are not
    // measured. Dropping them from `gallons` would claim full coverage over seven eighths of the fuel.
    const r = computeSubjectMpg([fill(null, null, 20), fill(700, 5, 100), fill(null, null, 40)]);
    expect(r.gallons).toBe(160);
    expect(r.fills).toBe(3);
    expect(r.fillsMeasured).toBe(1);
    expect(r.measuredShare).toBe(0.875); // 140 ÷ 160
  });

  it("drops a fill whose stored MPG is outside the per-fill band, and says how much fuel that cost", () => {
    // 250 MPG is a blank or mistyped odometer, not a driving result. Its span must not enter the
    // numerator; its gallons stay in the total, so the coverage figure shows what was lost.
    const r = computeSubjectMpg([fill(1400, 7, 200), fill(2500, MPG_PLAUSIBLE_MAX + 210, 10)]);
    expect(r.miles).toBe(1400);
    expect(r.mpg).toBe(7);
    expect(r.gallons).toBe(210);
    expect(r.fillsMeasured).toBe(1);
  });

  it("withholds the figure below the SAME coverage floor the fleet number uses", () => {
    // D-MPG4's argument does not weaken when the subject gets smaller: a driver's MPG over a third
    // of their fuel reads entirely plausibly and is wrong.
    const r = computeSubjectMpg([fill(700, 7, 100), fill(null, null, 400)]);
    expect(r.measuredShare).toBeLessThan(MIN_MEASURED_SHARE);
    expect(r.mpg).toBeNull();
    expect(r.reason).toMatch(/20% of this fuel/);
  });

  it("says there are no spans rather than reporting a subject that covered no distance", () => {
    const r = computeSubjectMpg([fill(null, null, 100), fill(null, null, 60)]);
    expect(r.mpg).toBeNull();
    expect(r.miles).toBe(0);
    expect(r.reason).toMatch(/not a fill that covered no distance/);
  });

  it("has nothing to divide when there are no fills at all", () => {
    const r = computeSubjectMpg([]);
    expect(r.mpg).toBeNull();
    expect(r.measuredShare).toBeNull();
    expect(r.reason).toMatch(/nothing to divide/);
  });

  it("uses the per-FILL band on its own result, not the fleet band", () => {
    // A subject CAN honestly be outside 3–12 (a truck that idled a fortnight, a light run), and
    // withholding those would delete real figures. Outside 1–40 the odometer is the fault.
    const r = computeSubjectMpg([fill(280, 14, 20)]);
    expect(r.mpg).toBe(14);
    expect(r.mpg).toBeGreaterThan(PLAUSIBLE_FLEET_MPG.high);
  });
});

/**
 * The measurement beside the verdict (M5).
 *
 * `mpg` answers "may this be printed as the fleet's efficiency"; `ratio` answers "what did these two
 * totals divide to". The spend report needs both — the second to explain the first's refusal, and to
 * keep `implied miles = gallons × MPG` an identity rather than an approximation.
 */
describe("computeFleetMpg — the division beside the verdict", () => {
  it("reports the division even when the figure is withheld, so a refusal can be explained", () => {
    // June 2026's contaminated mileage: 4,427,362 miles against 51,678 gallons reads 85.7 MPG. The
    // bridge's sentence quotes that number, and it is the number that makes the refusal believable.
    const r = computeFleetMpg(inputs({ miles: 4_427_362, gallons: 51_678, gallonsWithMiles: 51_678 }));
    expect(r.mpg).toBeNull();
    expect(r.ratio).toBeCloseTo(85.67, 2);
    expect(r.reason).toMatch(/85\.7 MPG/);
  });

  it("leaves the division UNROUNDED, because an implied-miles identity is built on it", () => {
    // `gallons × mpg` has to reproduce the miles exactly, or the spend report's volume split is off
    // by the rounding on every period.
    const r = computeFleetMpg(inputs({ miles: 433_541.2, gallons: 57_695.77, gallonsWithMiles: 56_247.42 }));
    expect(r.ratio).toBe(433_541.2 / 56_247.42);
    expect(r.mpg).toBe(7.71); // …and the printable figure is still two places
  });

  it("has no division to report when there is nothing to divide by", () => {
    expect(computeFleetMpg(inputs({ gallons: 0, gallonsWithMiles: 0 })).ratio).toBeNull();
  });

  it("gates the coverage floor on the SAME rounded share it reports", () => {
    // A share that displays as 60% and is withheld anyway is the gap D-MPG4 exists to close: the
    // number the reader sees has to be the number the rule used.
    const edge = computeFleetMpg(inputs({ gallons: 10_000, gallonsWithMiles: 5_998, miles: 42_000 }));
    expect(edge.measuredShare).toBe(0.6);
    expect(edge.mpg).not.toBeNull();
  });
});

describe("reportableMpg", () => {
  it("hands back the figure only when the module said it may be shown", () => {
    expect(reportableMpg({ mpg: 7.5, mpgUsable: true })).toBe(7.5);
    // The division is still there for explaining; it is not an answer.
    expect(reportableMpg({ mpg: 85.7, mpgUsable: false })).toBeNull();
    expect(reportableMpg({ mpg: null, mpgUsable: false })).toBeNull();
  });
});
