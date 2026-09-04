import { describe, it, expect } from "vitest";
import { assessLedgerMonths, ledgerMonthsReason } from "./ledgerMonths.js";

/**
 * The acceptance fixture is production as measured on 2026-09-03: every month from 2025-12 to
 * 2026-07 swept at 2026-08-28 21:02 UTC — long after each had ended — and August swept by the same
 * run, four days before it ended, holding eleven lines and $8,430.00 of expense with no revenue.
 *
 * That one row is the whole point of the file. It is what the finance page opened on that morning,
 * and every figure computed from it was arithmetically correct.
 */

const SWEEP = "2026-08-28 21:02:56.551+00";

const july = { month: "2026-07", periodEnd: "2026-08-01", sweptAt: SWEEP };
const august = { month: "2026-08", periodEnd: "2026-09-01", sweptAt: SWEEP };
const september = { month: "2026-09", periodEnd: "2026-10-01", sweptAt: null };

describe("assessLedgerMonths", () => {
  it("accepts a month whose newest sweep ran after the month was over", () => {
    const [m] = assessLedgerMonths([july]);
    expect(m!.complete).toBe(true);
    expect(m!.shortfall).toBeNull();
  });

  /**
   * August 2026, exactly as production held it. The sweep ran on the 28th, so what is staged is
   * four days short of a month — real rows, and not the month.
   */
  it("refuses a month that was swept while it was still running", () => {
    const [m] = assessLedgerMonths([august]);
    expect(m!.complete).toBe(false);
    expect(m!.shortfall).toBe("partial");
  });

  it("separates a month nothing has swept from one swept too early", () => {
    const [m] = assessLedgerMonths([september]);
    expect(m!.complete).toBe(false);
    expect(m!.shortfall).toBe("absent");
  });

  /**
   * `swept_at` is UTC and the entries are booked in US local time, so a sweep at half past midnight
   * UTC on the 1st ran the previous evening where the work happened and cannot have seen the last
   * hours of the month. The comparison is therefore strictly after the exclusive period end, which
   * costs a day of freshness and covers every US timezone.
   */
  it("does not accept a sweep dated the day the month closed", () => {
    const boundary = assessLedgerMonths([
      { month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-09-01 00:30:00+00" },
    ]);
    expect(boundary[0]!.complete).toBe(false);
    const nextDay = assessLedgerMonths([
      { month: "2026-08", periodEnd: "2026-09-01", sweptAt: "2026-09-02 00:30:00+00" },
    ]);
    expect(nextDay[0]!.complete).toBe(true);
  });

  it("judges each month on its own sweep, not on the newest one anywhere", () => {
    const all = assessLedgerMonths([july, august]);
    expect(all.map((m) => m.complete)).toEqual([true, false]);
  });
});

describe("ledgerMonthsReason", () => {
  it("says nothing when every month is complete", () => {
    expect(ledgerMonthsReason(assessLedgerMonths([july]))).toBeNull();
  });

  /** Named months and the sweep date, because "incomplete" sends a reader looking for which. */
  it("names a partial month and the date it was swept", () => {
    const reason = ledgerMonthsReason(assessLedgerMonths([july, august]))!;
    expect(reason).toContain("2026-08");
    expect(reason).toContain("2026-08-28");
    expect(reason).not.toContain("2026-07");
  });

  it("gives a month nothing has swept its own sentence", () => {
    const reason = ledgerMonthsReason(assessLedgerMonths([august, september]))!;
    expect(reason).toContain("swept before the month ended");
    expect(reason).toContain("has not reached 2026-09");
  });
});
