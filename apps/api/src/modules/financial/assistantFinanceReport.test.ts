import { beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerMonthWhy, type FleetColumn, type LedgerMonth } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's finance tools (F21 R6a). The header promises two things, and this file pins both:
 *  1. it asks the page's functions for exactly what the Fleet report page asks: `from` = the 1st,
 *     `to` = the day after the last month's last day (periodForMonth/periodForQuarter, then the
 *     query layer's `exclusiveEnd`, Q-AI10);
 *  2. every figure it returns is that function's field, copied, never recomputed.
 * So `getFleetReport` / `getIncomeStatement` are spies that record what was asked and answer a
 * fixture whose figures are deliberately NOT derivable from each other (a recomputed rate would differ).
 */
const getFleetReport = vi.fn();
const getIncomeStatement = vi.fn();
const readFinancialSyncedAt = vi.fn();
vi.mock("./fleetReport.js", () => ({ getFleetReport: (...a: unknown[]) => getFleetReport(...a) }));
vi.mock("./incomeStatement.js", () => ({ getIncomeStatement: (...a: unknown[]) => getIncomeStatement(...a) }));
vi.mock("../mcleod/index.js", () => ({ readFinancialSyncedAt: (...a: unknown[]) => readFinancialSyncedAt(...a) }));

const { assistantFinanceReport, assistantIncomeStatement, resolveFinancePeriod, NO_TRUCK_COST_NOTE, FINANCE_SOURCE } = await import(
  "./assistantFinanceReport.js"
);

const ORG = "org-1";
const NOV_10 = new Date("2026-11-10T15:00:00Z");
/** 22:00 on 10/31 in Chicago, already 11/01 in UTC: "last month" is still September there. */
const LATE_OCT_31_CENTRAL = new Date("2026-11-01T03:00:00Z");
const SWEPT = "2026-11-08T07:02:00Z";

const col = (k: number): FleetColumn => ({
  trucks: 100 + k,
  miles: 1_000_003 + k,
  revenue: 4_828_189.24 + k,
  expenses: 4_058_143.38 + k,
  net: 770_045.86 + k,
  // Not revenue ÷ miles: a tool that divided instead of copying would print a different number.
  revenuePerMile: 2.17 + k,
  costPerMile: 1.93 + k,
  netPerMile: 0.31 + k,
});

const UNPOSTED = { month: "2026-11", periodEnd: "2026-12-01", sweptAt: SWEPT, complete: false, shortfall: "unposted", missingModules: ["BILL", "SET"] } as unknown as LedgerMonth;

function fleetReport(from: string, to: string) {
  return {
    period: { from, to },
    total: col(0),
    company: col(1),
    ownerOperator: col(2),
    mileageReason: null,
    billedMiles: 870_001,
    emptyMiles: 130_002,
    emptyPct: 13.1,
    revenuePerBilledMile: 5.55,
    tieOut: { revenue: 0, expenses: 0 },
    trucks: [
      { tractor_unit: "748", loads: 9, miles: 10_400, revenue: 31_000, revenuePerMile: 2.98, isOwnerOperator: false },
      { tractor_unit: "751", loads: 12, miles: 11_900, revenue: 44_500, revenuePerMile: 3.74, isOwnerOperator: true },
      { tractor_unit: "900", loads: 3, miles: null, revenue: 9_000, revenuePerMile: null, isOwnerOperator: false },
    ],
    ownerOperators: [
      { payeeId: "SCORELIL", units: ["751"], settlements: 7, revenue: 44_500, pay: 42_275, grossMargin: 2_225, deductionIncome: 1_200, netMargin: 3_425, dealPct: 95 },
    ],
    families: {
      revenue: [{ key: "linehaul", label: "Linehaul", isRevenue: true, isUnassigned: false, amount: 4_828_189.24, toDateAmount: null, pctOfRevenue: 100, toDatePctOfRevenue: null, perMile: 4.83, accounts: 1 }],
      expense: [{ key: "fuel", label: "Fuel", isRevenue: false, isUnassigned: false, amount: 972_820.62, toDateAmount: null, pctOfRevenue: 20.1, toDatePctOfRevenue: null, perMile: 0.97, accounts: 1 }],
      tieOut: { revenue: 0, expenses: 0 },
    },
    monthsCovered: ["2026-10"],
    monthsMissing: [],
    monthsPartial: [UNPOSTED],
    ledgerReason: "2026-11 has not been fully posted in McLeod yet",
    monthsOpen: ["2026-10"],
    openNote: "2026-10 is still open in McLeod",
    closeKnown: true,
    toDateFrom: "2026-01-01",
    sweptAt: SWEPT,
  };
}

const recorder = () => createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });

beforeEach(() => {
  getFleetReport.mockReset();
  getIncomeStatement.mockReset();
  readFinancialSyncedAt.mockReset();
  getFleetReport.mockImplementation((_a: unknown, _o: unknown, from: string, to: string) => Promise.resolve(fleetReport(from, to)));
  readFinancialSyncedAt.mockResolvedValue(SWEPT);
});

describe("resolveFinancePeriod — whole months, as the Fleet report page asks for them", () => {
  const r = (input: Record<string, unknown>, today = "2026-11-10") => resolveFinancePeriod(input, today);
  it("last month is October 1st to 31st (periodForMonth('2026-10'))", () => {
    expect(r({ period: "last_month" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("no period means last month, the page's own opening choice", () => {
    expect(r({})).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("last quarter is July 1st to September 30th (periodForQuarter)", () => {
    expect(r({ period: "last_quarter" })).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
  });
  it("this month is the whole month, said so in the label: the ledger has no day grain", () => {
    const p = r({ period: "this_month" });
    expect(p).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect((p as { label: string }).label).toContain("widened to whole months");
  });
  it("a custom range widens to the months it touches", () => {
    expect(r({ from: "2026-07-14", to: "2026-08-03" })).toMatchObject({ from: "2026-07-01", to: "2026-08-31" });
  });
  it("refuses a malformed range instead of guessing", () => {
    expect(r({ from: "2026-07-14" })).toEqual({ ok: false, error: "from and to must both be YYYY-MM-DD dates." });
  });
});

describe("finance_report — the Fleet report's figures, for the page's months", () => {
  it("asks getFleetReport for exactly the page's window, and copies every figure unchanged", async () => {
    const rec = recorder();
    const out = (await assistantFinanceReport(rec.client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(getFleetReport).toHaveBeenCalledTimes(1);
    expect(getFleetReport.mock.calls[0]!.slice(1)).toEqual([ORG, "2026-10-01", "2026-11-01"]);

    const page = fleetReport("2026-10-01", "2026-10-31");
    const asPage = (c: FleetColumn) => ({
      trucks: c.trucks, measured_miles: c.miles, revenue: c.revenue, expenses: c.expenses, net: c.net,
      revenue_per_mile: c.revenuePerMile, cost_per_mile: c.costPerMile, net_per_mile: c.netPerMile,
    });
    expect(out.all_in).toEqual(asPage(page.total));
    expect(out.company_trucks).toEqual(asPage(page.company));
    expect(out.owner_operators).toEqual(asPage(page.ownerOperator));
    expect(out.all_in.cost_per_mile).toBe(1.93);
    expect(out).toMatchObject({
      source: FINANCE_SOURCE, timezone: "America/Chicago", billed_miles: 870_001, empty_miles: 130_002, empty_pct: 13.1,
      revenue_per_billed_mile: 5.55, per_mile_unavailable_because: null, split_ties_to_ledger: true,
    });
    expect(out.expense_families).toEqual([{ family: "Fuel", amount: 972_820.62, pct_of_revenue: 20.1, per_mile: 0.97 }]);
    expectOrgScoped(rec, ORG);
  });

  it("states the provenance: months in the figures, left out and why, still open in McLeod, last synced", async () => {
    const out = (await assistantFinanceReport(recorder().client, ORG, { period: "this_month" }, NOV_10)) as Out;
    expect(out.provenance).toEqual({
      months_in_figures: ["2026-10"],
      months_not_swept: [],
      months_left_out: [{ month: "2026-11", why: `2026-11 ${ledgerMonthWhy(UNPOSTED)}` }],
      months_still_open_in_mcleod: ["2026-10"],
      open_note: "2026-10 is still open in McLeod",
      mcleod_close_known: true,
      left_out_reason: "2026-11 has not been fully posted in McLeod yet",
      mcleod_last_synced_at: SWEPT,
      mcleod_never_synced: false,
    });
    expect(out.provenance.months_left_out[0].why).toContain("no BILL, SET lines");
  });

  it("says when McLeod was never synced rather than leaving the date blank", async () => {
    getFleetReport.mockImplementation((_a: unknown, _o: unknown, f: string, t: string) => Promise.resolve({ ...fleetReport(f, t), sweptAt: null }));
    const out = (await assistantFinanceReport(recorder().client, ORG, {}, NOV_10)) as Out;
    expect(out.provenance).toMatchObject({ mcleod_last_synced_at: null, mcleod_never_synced: true });
  });

  it("'last month' late on 10/31 in Chicago is September, not October", async () => {
    await assistantFinanceReport(recorder().client, ORG, { period: "last_month" }, LATE_OCT_31_CENTRAL);
    expect(getFleetReport.mock.calls[0]!.slice(2)).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("by=truck: the named units' rows as written ('#748', 'Unit 751'), never a cost per truck", async () => {
    const out = (await assistantFinanceReport(recorder().client, ORG, { by: "truck", units: ["#748", "Unit 751", "999"] }, NOV_10)) as Out;
    expect(out.by_truck).toEqual([
      { unit: "748", loads: 9, measured_miles: 10_400, revenue: 31_000, revenue_per_mile: 2.98, owner_operator: false },
      { unit: "751", loads: 12, measured_miles: 11_900, revenue: 44_500, revenue_per_mile: 3.74, owner_operator: true },
    ]);
    expect(out.units_without_a_row).toEqual(["999"]);
    expect(out.per_truck_cost).toBe(NO_TRUCK_COST_NOTE);
    for (const row of out.by_truck) expect(Object.keys(row).some((k) => /cost|profit|net/.test(k))).toBe(false);
  });

  it("by=truck without units: the top trucks by revenue, and says how many of how many", async () => {
    const out = (await assistantFinanceReport(recorder().client, ORG, { by: "truck", limit: 2 }, NOV_10)) as Out;
    expect(out.by_truck.map((t: Out) => t.unit)).toEqual(["751", "748"]);
    expect(out.by_truck_note).toBe("Top 2 of 3 trucks by revenue.");
  });

  it("by=contractor: each owner-operator's settled figures, copied", async () => {
    const out = (await assistantFinanceReport(recorder().client, ORG, { by: "contractor" }, NOV_10)) as Out;
    expect(out.by_contractor).toEqual([
      { payee: "SCORELIL", units: ["751"], settlements: 7, revenue: 44_500, pay: 42_275, gross_margin: 2_225, deduction_income: 1_200, net_margin: 3_425, deal_pct: 95 },
    ]);
  });

  it("by=month: one page read per month, each the page's own month window", async () => {
    const out = (await assistantFinanceReport(recorder().client, ORG, { period: "last_quarter", by: "month" }, NOV_10)) as Out;
    const windows = getFleetReport.mock.calls.map((c) => c.slice(2));
    expect(windows).toEqual([
      ["2026-07-01", "2026-10-01"],
      ["2026-07-01", "2026-08-01"],
      ["2026-08-01", "2026-09-01"],
      ["2026-09-01", "2026-10-01"],
    ]);
    expect(out.by_month.map((m: Out) => [m.from, m.all_in.cost_per_mile])).toEqual([
      ["2026-07-01", 1.93],
      ["2026-08-01", 1.93],
      ["2026-09-01", 1.93],
    ]);
  });
});

describe("income_statement — the statement tab's figures", () => {
  const statement = {
    sections: [
      { typeId: "Revenue", label: "Revenue", isRevenue: true, isUnrecognised: false, total: 4_828_189.24, toDateTotal: 4_700_000,
        lines: [{ glid: "30000001", descr: "Gross Trucking Income", amount: 4_828_189.24, pctOfRevenue: 100, toDateAmount: 4_700_000, toDatePctOfRevenue: 100, modules: [] }] },
    ],
    revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86,
    toDateRevenue: 4_700_000, toDateExpenses: 4_000_000, toDateNet: 700_000, unrecognisedNet: 0,
    monthsCovered: ["2026-10"], monthsMissing: [], monthsPartial: [], ledgerReason: null,
    monthsOpen: ["2026-10"], openNote: "2026-10 is still open in McLeod", closeKnown: true, toDateFrom: "2026-09-01",
    comparison: { kind: "previous", from: "2026-09-01", to: "2026-10-01", monthsCovered: ["2026-09"], monthsMissing: [] },
  };
  beforeEach(() => getIncomeStatement.mockResolvedValue(statement));

  it("asks for the page's window with 'previous' by default, copies the totals, and states provenance", async () => {
    const rec = recorder();
    const out = (await assistantIncomeStatement(rec.client, ORG, { period: "last_month" }, NOV_10)) as Out;
    expect(getIncomeStatement.mock.calls[0]!.slice(1)).toEqual([ORG, "2026-10-01", "2026-11-01", "previous"]);
    expect(readFinancialSyncedAt.mock.calls[0]!.slice(1)).toEqual([ORG]);
    expect(out).toMatchObject({ revenue: 4_828_189.24, expenses: 4_058_143.38, net: 770_045.86, comparison_net: 700_000 });
    expect(out.sections).toEqual([{ section: "Revenue", is_revenue: true, total: 4_828_189.24, comparison_total: 4_700_000, accounts: 1 }]);
    expect(out.provenance).toMatchObject({ months_still_open_in_mcleod: ["2026-10"], mcleod_last_synced_at: SWEPT });
    expect(out.comparison).toEqual({ kind: "previous", from: "2026-09-01", to_exclusive: "2026-10-01", months_in_figures: ["2026-09"], months_not_swept: [] });
    expectOrgScoped(rec, ORG);
  });

  it("passes ytd through, and detail=lines lists each account", async () => {
    const out = (await assistantIncomeStatement(recorder().client, ORG, { compare: "ytd", detail: "lines" }, NOV_10)) as Out;
    expect(getIncomeStatement.mock.calls[0]![4]).toBe("ytd");
    expect(out.sections[0].lines).toEqual([
      { glid: "30000001", account: "Gross Trucking Income", amount: 4_828_189.24, pct_of_revenue: 100, comparison_amount: 4_700_000 },
    ]);
  });
});
