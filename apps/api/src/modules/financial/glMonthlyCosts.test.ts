import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getGlMonthlyCosts } from "./glMonthlyCosts.js";

const ORG = "11111111-1111-1111-1111-111111111111";

/**
 * Shaped after the real June 2026 ledger read out of the McLeod sandbox on 2026-08-28: VIP Lease
 * posts as a journal total, insurance likewise, tires arrive through AP, and the revenue account
 * sits in the same month and must not be counted as a cost.
 */
const ACCOUNTS = [
  { glid: "50100000", descr: "VIP Lease", type_id: "Operating Expenses" },
  { glid: "50200000", descr: "Insurance Expense", type_id: "Operating Expenses" },
  { glid: "50300000", descr: "Tires", type_id: "Operating Expenses" },
  { glid: "60100000", descr: "Rent Expense", type_id: "General & Admin Expenses" },
  { glid: "40100000", descr: "Gross Trucking Income", type_id: "Revenue" },
  { glid: "10100000", descr: "Accounts Receivable", type_id: "Current Assets" },
];

const TOTALS = [
  { post_module: "GJ", glid: "50100000", line_count: 6, net_amount: "400000.00", abs_amount: "400000.00" },
  { post_module: "GJ", glid: "50200000", line_count: 3, net_amount: "163964.17", abs_amount: "163964.17" },
  // The same account through two modules in one month — D-MC13's lifecycle views of one dollar set.
  { post_module: "AP", glid: "50200000", line_count: 1, net_amount: "1089.97", abs_amount: "1089.97" },
  { post_module: "AP", glid: "50300000", line_count: 6, net_amount: "54760.00", abs_amount: "54760.00" },
  { post_module: "AP", glid: "60100000", line_count: 3, net_amount: "16723.23", abs_amount: "16723.23" },
  { post_module: "BILL", glid: "40100000", line_count: 2078, net_amount: "-5107789.04", abs_amount: "5107789.04" },
  { post_module: "CASH", glid: "10100000", line_count: 40, net_amount: "1573622.96", abs_amount: "1573622.96" },
];

const recorder = () =>
  createSupabaseRecorder({ tables: { mcleod_gl_totals: TOTALS, mcleod_gl_accounts: ACCOUNTS } });

describe("getGlMonthlyCosts", () => {
  it("returns the month's expense accounts largest first, org-scoped", async () => {
    const rec = recorder();
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    expect(r.accounts.map((a) => a.descr)).toEqual([
      "VIP Lease",
      "Insurance Expense",
      "Tires",
      "Rent Expense",
    ]);
    expect(r.accounts[0]!.amount).toBe(400000);
    expectOrgScoped(rec, ORG);
  });

  it("sums an account across the modules it posted through", async () => {
    const rec = recorder();
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    // 163,964.17 journal + 1,089.97 AP — one account, two lifecycle views, one number.
    expect(r.accounts.find((a) => a.descr === "Insurance Expense")!.amount).toBe(165054.14);
  });

  it("excludes revenue and balance-sheet accounts — a loan draw is not a cost", async () => {
    const rec = recorder();
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    const descrs = r.accounts.map((a) => a.descr);
    expect(descrs).not.toContain("Gross Trucking Income");
    expect(descrs).not.toContain("Accounts Receivable");
  });

  it("totals only what it lists", async () => {
    const rec = recorder();
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    const summed = r.accounts.reduce((a, x) => a + x.amount, 0);
    expect(r.total).toBeCloseTo(summed, 2);
    expect(r.total).toBeCloseTo(400000 + 165054.14 + 54760 + 16723.23, 2);
  });

  it("reads the month asked for", async () => {
    const rec = recorder();
    await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    const totalsQuery = rec.queries.find((q) => q.table === "mcleod_gl_totals");
    expect(totalsQuery?.filters()).toContainEqual({ col: "period_start", val: "2026-06-01" });
  });

  // The state production is in until the agent's next --financial pass. Without the master every
  // account is unclassifiable, so the list is empty for a reason the page has to be able to state
  // — otherwise "not swept yet" renders identically to "this month cost nothing".
  it("flags an unstaged chart of accounts rather than reporting no costs", async () => {
    const rec = createSupabaseRecorder({
      tables: { mcleod_gl_totals: TOTALS, mcleod_gl_accounts: [] },
    });
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    expect(r.accountsStaged).toBe(false);
    expect(r.swept).toBe(true);
    expect(r.accounts).toEqual([]);
  });

  it("flags a month the GL sweep has not reached", async () => {
    const rec = createSupabaseRecorder({
      tables: { mcleod_gl_totals: [], mcleod_gl_accounts: ACCOUNTS },
    });
    const r = await getGlMonthlyCosts(rec.client, ORG, "2026-06");
    expect(r.swept).toBe(false);
    expect(r.accountsStaged).toBe(true);
    expect(r.total).toBe(0);
  });
});
