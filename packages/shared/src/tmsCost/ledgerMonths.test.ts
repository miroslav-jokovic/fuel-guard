import { describe, it, expect } from "vitest";
import { assessLedgerMonths, ledgerMonthsReason, ledgerMonthWhy, type LedgerMonthInput } from "./ledgerMonths.js";
import type { LedgerAccount, LedgerTotalRow } from "./incomeStatement.js";

/**
 * The acceptance fixture is production as measured on 2026-09-03: every month from 2025-12 to
 * 2026-07 swept at 2026-08-28 21:02 UTC — long after each had ended — and August swept by the same
 * run, four days before it ended, holding eleven lines and $8,430.00 of expense with no revenue.
 *
 * That one row is the whole point of the file. It is what the finance page opened on that morning,
 * and every figure computed from it was arithmetically correct.
 */

const SWEEP = "2026-08-28 21:02:56.551+00";

const ACCOUNTS: LedgerAccount[] = [
  { glid: "40000000", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "50000000", descr: "Driver Pay", type_id: "Operating Expenses" },
  { glid: "60000000", descr: "Office Salaries", type_id: "General & Admin Expenses" },
  { glid: "20000000", descr: "Accounts Payable", type_id: "Current Liabilities" },
];

/** A revenue line (credit, so negative, as the ledger posts it) and an expense line. */
const rev = (post_module: string, amount: number): LedgerTotalRow => ({ glid: "40000000", post_module, net_amount: -amount, line_count: 1 });
const exp = (post_module: string, amount: number): LedgerTotalRow => ({ glid: "50000000", post_module, net_amount: amount, line_count: 1 });

/** A month as BILL and SET lead it in production, with the small modules alongside. */
const fullMonth = (): LedgerTotalRow[] => [rev("BILL", 4_942_650), rev("DRS", 49_774), exp("SET", 1_616_119), exp("FUEL", 1_140_650), exp("GJ", 607_311), exp("RJ", 171_345)];

const month = (m: string, periodEnd: string, sweptAt: string | null, rows: LedgerTotalRow[] = fullMonth()): LedgerMonthInput => ({ month: m, periodEnd, sweptAt, rows });

const july = month("2026-07", "2026-08-01", SWEEP);
const august = month("2026-08", "2026-09-01", SWEEP);
const september = month("2026-09", "2026-10-01", null, []);

describe("assessLedgerMonths", () => {
  it("accepts a month whose newest sweep ran after the month was over", () => {
    const [m] = assessLedgerMonths([july], ACCOUNTS);
    expect(m!.complete).toBe(true);
    expect(m!.shortfall).toBeNull();
  });

  /**
   * August 2026, exactly as production held it. The sweep ran on the 28th, so what is staged is
   * four days short of a month — real rows, and not the month.
   */
  it("refuses a month that was swept while it was still running", () => {
    const [m] = assessLedgerMonths([august], ACCOUNTS);
    expect(m!.complete).toBe(false);
    expect(m!.shortfall).toBe("partial");
  });

  it("separates a month nothing has swept from one swept too early", () => {
    const [m] = assessLedgerMonths([september], ACCOUNTS);
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
    const boundary = assessLedgerMonths([month("2026-08", "2026-09-01", "2026-09-01 00:30:00+00")], ACCOUNTS);
    expect(boundary[0]!.complete).toBe(false);
    const nextDay = assessLedgerMonths([month("2026-08", "2026-09-01", "2026-09-02 00:30:00+00")], ACCOUNTS);
    expect(nextDay[0]!.complete).toBe(true);
  });

  it("judges each month on its own sweep, not on the newest one anywhere", () => {
    const all = assessLedgerMonths([july, august], ACCOUNTS);
    expect(all.map((m) => m.complete)).toEqual([true, false]);
  });
});

/**
 * Production as measured on 2026-10-10. The 10-09 sweep ran nine days after September ended, so
 * September passes the date test — and it holds eight recurring-journal lines and nothing else,
 * because McLeod's accountant had not posted it yet. Q10, ruled 2026-10-10.
 */
describe("assessLedgerMonths — a month swept after it ended but not posted yet (Q10)", () => {
  const LATE = "2026-10-09 18:59:00+00";
  const jul = month("2026-07", "2026-08-01", LATE);
  const aug = month("2026-08", "2026-09-01", LATE);
  const sep = month("2026-09", "2026-10-01", LATE, [exp("RJ", 2_543), exp("RJ", 24_403)]);

  it("refuses September 2026 as production held it, naming the modules McLeod has not posted", () => {
    const [, , m] = assessLedgerMonths([jul, aug, sep], ACCOUNTS);
    expect(m!.complete).toBe(false);
    expect(m!.shortfall).toBe("unposted");
    expect(m!.missingModules).toEqual(["BILL", "SET"]);
  });

  /**
   * The literal reading of Q10 — every module every earlier month carried — refuses this January:
   * December 2025 carried a $100.00 DED line on a revenue account and January did not. A module
   * that carried a few dollars once is not what makes a month a month.
   */
  it("accepts January 2026 although December carried a $100 DED revenue line January did not", () => {
    const dec = month("2025-12", "2026-01-01", LATE, [...fullMonth(), rev("DED", 100)]);
    const jan = month("2026-01", "2026-02-01", LATE);
    expect(assessLedgerMonths([dec, jan], ACCOUNTS).map((m) => m.complete)).toEqual([true, true]);
  });

  it("refuses a month that billed but lost its leading expense module", () => {
    const billedOnly = month("2026-09", "2026-10-01", LATE, [rev("BILL", 5_980_000), exp("RJ", 26_946)]);
    const [, m] = assessLedgerMonths([aug, billedOnly], ACCOUNTS);
    expect(m!.shortfall).toBe("unposted");
    expect(m!.missingModules).toEqual(["SET"]);
  });

  it("follows the leading expense module from month to month, as December's GJ became January's SET", () => {
    const dec = month("2025-12", "2026-01-01", LATE, [rev("BILL", 3_240_532), exp("GJ", 1_203_770), exp("SET", 960_284)]);
    const jan = month("2026-01", "2026-02-01", LATE, [rev("BILL", 3_273_364), exp("GJ", 532_363), exp("SET", 905_857)]);
    const febNoGj = month("2026-02", "2026-03-01", LATE, [rev("BILL", 3_445_878), exp("SET", 1_024_408)]);
    // February is judged against January, whose leading expense was SET — so GJ is not demanded.
    expect(assessLedgerMonths([dec, jan, febNoGj], ACCOUNTS).map((m) => m.complete)).toEqual([true, true, true]);
  });

  it("does not count a module that posted only to the balance sheet", () => {
    const bsOnly = month("2026-09", "2026-10-01", LATE, [
      { glid: "20000000", post_module: "BILL", net_amount: 5_980_000, line_count: 1 },
      exp("SET", 1_550_000),
    ]);
    const [, m] = assessLedgerMonths([aug, bsOnly], ACCOUNTS);
    expect(m!.missingModules).toEqual(["BILL"]);
  });

  it("judges the month after an unposted one against the last complete month", () => {
    const oct = month("2026-10", "2026-11-01", "2026-11-20 00:00:00+00", [exp("RJ", 8_581), exp("GJ", 500_000)]);
    const all = assessLedgerMonths([jul, aug, sep, oct], ACCOUNTS);
    expect(all[3]!.shortfall).toBe("unposted");
    expect(all[3]!.missingModules).toEqual(["BILL", "SET"]);
  });

  it("judges a month against the months before it whatever order the caller passes them in", () => {
    const all = assessLedgerMonths([sep, aug, jul], ACCOUNTS);
    expect(all.map((m) => m.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(all.map((m) => m.shortfall)).toEqual(["unposted", null, null]);
  });

  it("applies only the date test to the first month, which has nothing before it", () => {
    const [m] = assessLedgerMonths([sep], ACCOUNTS);
    expect(m!.complete).toBe(true);
  });

  it("does not judge against a month that was itself swept too early", () => {
    const early = month("2026-08", "2026-09-01", SWEEP);
    const all = assessLedgerMonths([early, sep], ACCOUNTS);
    expect(all.map((m) => m.shortfall)).toEqual(["partial", null]);
  });
});

describe("ledgerMonthsReason", () => {
  it("says nothing when every month is complete", () => {
    expect(ledgerMonthsReason(assessLedgerMonths([july], ACCOUNTS))).toBeNull();
  });

  /** Named months and the sweep date, because "incomplete" sends a reader looking for which. */
  it("names a partial month and the date it was swept", () => {
    const reason = ledgerMonthsReason(assessLedgerMonths([july, august], ACCOUNTS))!;
    expect(reason).toContain("2026-08");
    expect(reason).toContain("2026-08-28");
    expect(reason).not.toContain("2026-07");
  });

  it("gives a month nothing has swept its own sentence", () => {
    const reason = ledgerMonthsReason(assessLedgerMonths([august, september], ACCOUNTS))!;
    expect(reason).toContain("swept before the month ended");
    expect(reason).toContain("has not reached 2026-09");
  });

  it("says an unposted month is waiting on McLeod's posting and names what is missing", () => {
    const late = "2026-10-09 18:59:00+00";
    const reason = ledgerMonthsReason(
      assessLedgerMonths([month("2026-08", "2026-09-01", late), month("2026-09", "2026-10-01", late, [exp("RJ", 26_946)])], ACCOUNTS),
    )!;
    expect(reason).toContain("2026-09 has not been fully posted in McLeod yet (no BILL, SET lines)");
    expect(reason).not.toContain("2026-08");
  });
});

describe("ledgerMonthWhy", () => {
  it("gives each shortfall its own clause", () => {
    const [partial, absent] = assessLedgerMonths([august, september], ACCOUNTS);
    expect(ledgerMonthWhy(partial!)).toBe("was swept on 2026-08-28, before the month ended");
    expect(ledgerMonthWhy(absent!)).toBe("has not been swept from McLeod yet");
  });
});
