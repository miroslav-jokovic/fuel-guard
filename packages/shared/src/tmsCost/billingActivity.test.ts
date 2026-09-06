import { describe, it, expect } from "vitest";
import { bucketBillingActivity, type ActivityBill } from "./billingActivity.js";

/**
 * Weekly revenue and activity (W2). The fixture is July 2026 shaped as production holds it: bills
 * re-dated to `delivery_date`, 1,389,814 billed miles over the month at $3.47 a billed mile.
 *
 * What is pinned is what a reader would be misled by. A week with no bills must not appear as a week
 * the carrier hauled nothing; a load whose bill carries no distance must still count as a load; and
 * the week must start on Monday, because the fuel-spend series already starts there and two
 * different weeks in one product is a defect nobody finds until two figures fail to agree.
 */

const bill = (delivery_date: string, revenue: number, distance: number | null = 1000): ActivityBill => ({
  delivery_date,
  revenue,
  distance,
});

describe("bucketBillingActivity", () => {
  /** 2026-07-06 is a Monday; the 12th is the Sunday that closes its week. */
  it("starts the week on Monday, the way the rest of the product already does", () => {
    const [week] = bucketBillingActivity([bill("2026-07-08", 100), bill("2026-07-12", 100)]);
    expect(week!.from).toBe("2026-07-06");
    expect(week!.to).toBe("2026-07-12");
    expect(week!.loads).toBe(2);
  });

  it("puts a Monday delivery in its own week, not the previous one", () => {
    const weeks = bucketBillingActivity([bill("2026-07-12", 1), bill("2026-07-13", 1)]);
    expect(weeks.map((w) => w.from)).toEqual(["2026-07-06", "2026-07-13"]);
  });

  it("prices the week per BILLED mile — the miles the loads were sold on", () => {
    const [week] = bucketBillingActivity([bill("2026-07-08", 3470, 1000)]);
    expect(week!.billedMiles).toBe(1000);
    expect(week!.revenuePerBilledMile).toBe(3.47);
  });

  /**
   * Dropping a distance-less load would understate activity to protect a rate. The rate is protected
   * anyway — those miles are simply not in the denominator — and the count travels with the row so a
   * reader can see how much of the week the rate speaks for.
   */
  it("counts a load whose bill carries no distance, and says how many there were", () => {
    const [week] = bucketBillingActivity([bill("2026-07-08", 1000, 500), bill("2026-07-09", 500, null)]);
    expect(week!.loads).toBe(2);
    expect(week!.loadsWithoutDistance).toBe(1);
    expect(week!.revenue).toBe(1500);
    // The revenue is the week's whole revenue; only the MILES are short, and the rate says so.
    expect(week!.billedMiles).toBe(500);
    expect(week!.revenuePerBilledMile).toBe(3);
  });

  it("gives no rate at all when a week's bills carry no distance between them", () => {
    const [week] = bucketBillingActivity([bill("2026-07-08", 1000, null)]);
    expect(week!.revenue).toBe(1000);
    expect(week!.billedMiles).toBe(0);
    expect(week!.revenuePerBilledMile).toBeNull();
  });

  /**
   * A week the carrier hauled nothing and a week nobody has swept yet look identical in a zero row,
   * and the zero is the more believable of the two.
   */
  it("omits a period with no bills rather than emitting a zero week", () => {
    const weeks = bucketBillingActivity([bill("2026-07-08", 1), bill("2026-07-22", 1)]);
    expect(weeks.map((w) => w.from)).toEqual(["2026-07-06", "2026-07-20"]);
    expect(weeks).toHaveLength(2);
  });

  it("orders periods oldest first, whatever order the bills arrived in", () => {
    const weeks = bucketBillingActivity([bill("2026-07-29", 1), bill("2026-07-01", 1), bill("2026-07-15", 1)]);
    expect(weeks.map((w) => w.from)).toEqual(["2026-06-29", "2026-07-13", "2026-07-27"]);
  });

  it("buckets by month when asked, so the same rule serves both periods", () => {
    const months = bucketBillingActivity(
      [bill("2026-07-08", 1000, 500), bill("2026-07-29", 1000, 500), bill("2026-08-03", 500, 250)],
      "month",
    );
    expect(months.map((m) => m.from)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(months[0]!.loads).toBe(2);
    expect(months[0]!.billedMiles).toBe(1000);
  });

  /** July as production holds it: the month's billed miles and its rate per billed mile (§1.5.4). */
  it("reproduces July's measured rate per billed mile", () => {
    const [month] = bucketBillingActivity([bill("2026-07-15", 4_828_189.24, 1_389_814)], "month");
    expect(month!.billedMiles).toBe(1_389_814);
    expect(month!.revenuePerBilledMile).toBe(3.47);
  });

  it("ignores a bill whose delivery date is unreadable rather than bucketing it somewhere", () => {
    const weeks = bucketBillingActivity([bill("not-a-date", 999), bill("2026-07-08", 1)]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.revenue).toBe(1);
  });

  it("has no periods at all when there are no bills", () => {
    expect(bucketBillingActivity([])).toEqual([]);
  });
});
