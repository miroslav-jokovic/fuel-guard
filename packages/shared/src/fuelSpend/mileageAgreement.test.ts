import { describe, it, expect } from "vitest";
import {
  MILEAGE_AGREEMENT_TOLERANCE,
  assessMileageAgreement,
  type MonthlyMileage,
} from "./mileageAgreement.js";

/**
 * The check that would have caught the 2026-07-28 mileage step the week it happened (M5, plan Q3).
 *
 * The first two cases are not invented: they are the months §1.4 of the plan measured on production,
 * and they are pinned here so the numbers that motivated the whole programme cannot quietly stop
 * being true. The rest are the ways a check like this fails quietly — reading an absent feed as
 * agreement, reporting the newest month instead of the worst, losing the sign so a reader cannot
 * tell which source moved.
 */
const month = (m: string, miles: number, referenceMiles: number): MonthlyMileage => ({ month: m, miles, referenceMiles });

/** Production, 2026-09-04: allocated `fuel_spend_days.miles` against Samsara's IFTA taxable miles. */
const JULY = month("2026-07", 1_549_942, 1_551_133);
const AUGUST = month("2026-08", 1_696_637, 1_634_889);

describe("assessMileageAgreement", () => {
  it("passes July 2026 and catches August, which is the whole reason it exists", () => {
    const a = assessMileageAgreement([JULY, AUGUST]);
    expect(a.months[0]).toMatchObject({ verdict: "agrees", divergence: -0.0008 });
    expect(a.months[1]).toMatchObject({ verdict: "diverges", divergence: 0.0378 });
    expect(a.verdict).toBe("diverges");
    expect(a.worst!.month).toBe("2026-08");
    expect(a.concern).toMatch(/3\.8% above the jurisdiction miles/);
    expect(a.concern).toMatch(/August 2026/);
  });

  it("says nothing at all when every month agrees", () => {
    // Silence is the pass. A line reading "the miles agree" on every report is a line nobody sees on
    // the day it changes.
    const a = assessMileageAgreement([JULY, month("2026-06", 1_500_000, 1_499_000)]);
    expect(a.verdict).toBe("agrees");
    expect(a.concern).toBeNull();
    expect(a.worst!.month).toBe("2026-07"); // still reported, so a climbing figure is visible early
  });

  it("reports the WORST month, not the most recent one", () => {
    // A check that always spoke about the newest month would go quiet the moment a drift settled.
    const a = assessMileageAgreement([AUGUST, month("2026-09", 1_000_000, 1_002_000)]);
    expect(a.worst!.month).toBe("2026-08");
  });

  it("keeps the sign, so a reader knows WHICH source is the higher one", () => {
    const above = assessMileageAgreement([month("2026-05", 105_000, 100_000)]);
    const below = assessMileageAgreement([month("2026-05", 95_000, 100_000)]);
    expect(above.concern).toMatch(/5\.0% above/);
    expect(below.concern).toMatch(/5\.0% below/);
  });

  it("treats an absent feed as UNMEASURABLE, never as agreement", () => {
    // The failure this prevents: the check going quiet through exactly the outage it exists to catch.
    const a = assessMileageAgreement([month("2026-08", 1_696_637, 0)]);
    expect(a.months[0]!.verdict).toBe("unmeasurable");
    expect(a.verdict).toBe("unmeasurable");
    expect(a.worst).toBeNull();
    expect(a.concern).toMatch(/nothing standing beside it/);
  });

  it("has nothing to say about no months at all", () => {
    // A one-week report holds no whole calendar month, and that is not a finding.
    expect(assessMileageAgreement([])).toMatchObject({ verdict: "unmeasurable", worst: null, concern: null });
  });

  it("puts the threshold where the measurements put it", () => {
    // Measured on this fleet: the two sources agreed to 0.08% in July, the odometer ran 0.62% from
    // the allocation over three matched days, and the August break was 3.78%.
    const inside = assessMileageAgreement([month("2026-05", 100_000 * (1 + MILEAGE_AGREEMENT_TOLERANCE), 100_000)]);
    expect(inside.verdict).toBe("agrees"); // the tolerance itself is inside
    const outside = assessMileageAgreement([month("2026-05", 100_000 * (1 + MILEAGE_AGREEMENT_TOLERANCE) + 100, 100_000)]);
    expect(outside.verdict).toBe("diverges");
  });
});
