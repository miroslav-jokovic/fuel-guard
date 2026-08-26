import { describe, expect, it } from "vitest";
import { tieOutMiles } from "./tieOut.js";

/**
 * The check that found the missing month, as code.
 *
 * Its whole value is the DISTINCTION it draws: Samsara reporting more miles than our odometer chain is
 * expected — that chain only sees distance between recorded fills — but the same gap can mean two
 * opposite things, and only the fuel separates them. Collapse the two verdicts into one "they
 * disagree" and the check stops being actionable, which is the failure mode to guard against.
 */
describe("tieOutMiles", () => {
  it("calls readings within a tenth of each other agreement", () => {
    const t = tieOutMiles({ samsaraMiles: 103_000, odometerMiles: 100_000, purchasedGallons: 14_500 });
    expect(t.verdict).toBe("agree");
    expect(t.concern).toBeNull();
  });

  it("names MISSING FUEL when the extra miles cannot have been driven on the fuel on file", () => {
    // 2026 Q2's real figures. The ratio alone says only "they disagree"; the implied 10.5 mpg is what
    // says WHICH source is wrong, and it was the fuel — a 31-day hole worth about $1.03M.
    const t = tieOutMiles({ samsaraMiles: 4_611_351, odometerMiles: 2_754_740, purchasedGallons: 439_153 });
    expect(t.verdict).toBe("fuel_missing");
    expect(t.ratio).toBeCloseTo(1.67, 1);
    expect(t.impliedMpg).toBeCloseTo(10.5, 1);
    expect(t.concern).toContain("The miles are real and the FUEL is missing");
  });

  it("names a SHORT ODOMETER CHAIN when the fuel supports the extra miles", () => {
    // Same 1.66 ratio, but with the fuel that month actually present: 4.6M miles on 665,577 gallons is
    // 6.9 mpg, which is this fleet exactly. Nothing is missing — our chain simply cannot see miles
    // driven outside the span between two recorded fills.
    const t = tieOutMiles({ samsaraMiles: 4_611_351, odometerMiles: 2_754_740, purchasedGallons: 665_577 });
    expect(t.verdict).toBe("odometer_short");
    expect(t.impliedMpg).toBeCloseTo(6.9, 1);
    expect(t.concern).toContain("Samsara's figure is the one to file on");
  });

  it("separates those two on the FUEL alone, at the same ratio", () => {
    // The property that makes the check worth having: identical mileage disagreement, opposite verdict.
    const a = tieOutMiles({ samsaraMiles: 4_611_351, odometerMiles: 2_754_740, purchasedGallons: 439_153 });
    const b = tieOutMiles({ samsaraMiles: 4_611_351, odometerMiles: 2_754_740, purchasedGallons: 665_577 });
    expect(a.ratio).toBe(b.ratio);
    expect(a.verdict).not.toBe(b.verdict);
  });

  it("flags Samsara reporting FEWER miles, which the odometer chain cannot honestly produce", () => {
    // Our miles are a lower bound on Samsara's by construction. Below it means the telematics side is
    // short — a gateway offline, or trucks missing from the report — not that we over-counted.
    const t = tieOutMiles({ samsaraMiles: 1_000_000, odometerMiles: 2_754_740, purchasedGallons: 400_000 });
    expect(t.verdict).toBe("samsara_short");
    expect(t.concern).toContain("Something is short on the telematics side");
  });

  it("refuses to compare when one reading is absent", () => {
    expect(tieOutMiles({ samsaraMiles: 0, odometerMiles: 100, purchasedGallons: 10 }).verdict).toBe("unmeasurable");
    expect(tieOutMiles({ samsaraMiles: 100, odometerMiles: 0, purchasedGallons: 10 }).verdict).toBe("unmeasurable");
  });

  it("still reports the ratio when there is no fuel to judge it by", () => {
    // Without fuel the two "Samsara is higher" cases cannot be told apart, so it takes the safer of
    // the two rather than asserting a hole in a feed it cannot see.
    const t = tieOutMiles({ samsaraMiles: 200_000, odometerMiles: 100_000, purchasedGallons: 0 });
    expect(t.verdict).toBe("odometer_short");
    expect(t.impliedMpg).toBeNull();
    expect(t.concern).toContain("no fuel to check");
  });
});
