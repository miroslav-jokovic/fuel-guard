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

describe("getGlMonthlyCosts — grain says how finely McLeod can split each account", () => {
  /**
   * The distinction the Fixed costs page turns on. $194,407 of office payroll and $400,000 of VIP
   * lease look identical as totals, but one resolves to 31 named people and the other resolves to
   * nothing finer than the company — and a reader who cannot tell them apart will read
   * "company-level" as "not split yet" rather than as "McLeod does not hold it".
   */
  const ACCOUNTS = [
    { glid: "40900000", descr: "Subcontracted Labor: Office", type_id: "Operating Expenses" },
    { glid: "40850000", descr: "VIP Lease", type_id: "Operating Expenses" },
    { glid: "40140000", descr: "Shop Parts", type_id: "Operating Expenses" },
    { glid: "40120000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
    { glid: "42100000", descr: "Rent Expense", type_id: "General & Admin Expenses" },
  ];
  const TOTALS = [
    { post_module: "OFF", glid: "40900000", line_count: 199, net_amount: "194407.20", abs_amount: "194407.20" },
    { post_module: "GJ", glid: "40850000", line_count: 6, net_amount: "400000.00", abs_amount: "400000.00" },
    { post_module: "AP", glid: "40140000", line_count: 47, net_amount: "37403.89", abs_amount: "37403.89" },
    { post_module: "FUEL", glid: "40120000", line_count: 5752, net_amount: "899741.93", abs_amount: "899741.93" },
    // One account through two modules — AP and OFF. Person beats vendor.
    { post_module: "AP", glid: "42100000", line_count: 3, net_amount: "16723.23", abs_amount: "16723.23" },
    { post_module: "OFF", glid: "42100000", line_count: 4, net_amount: "9198.47", abs_amount: "9198.47" },
  ];
  const rec = () => createSupabaseRecorder({ tables: { mcleod_gl_totals: TOTALS, mcleod_gl_accounts: ACCOUNTS } });
  const grainOf = (r: Awaited<ReturnType<typeof getGlMonthlyCosts>>, descr: string) =>
    r.accounts.find((a) => a.descr === descr)!.grain;

  it("reads office payroll as splittable per person", async () => {
    expect(grainOf(await getGlMonthlyCosts(rec().client, ORG, "2026-06"), "Subcontracted Labor: Office")).toBe("per_person");
  });

  it("reads a journal-posted lease as company-level, because McLeod holds nothing finer", async () => {
    expect(grainOf(await getGlMonthlyCosts(rec().client, ORG, "2026-06"), "VIP Lease")).toBe("company");
  });

  it("reads AP spend as splittable per vendor", async () => {
    expect(grainOf(await getGlMonthlyCosts(rec().client, ORG, "2026-06"), "Shop Parts")).toBe("per_vendor");
  });

  it("reads fuel as splittable per truck", async () => {
    expect(grainOf(await getGlMonthlyCosts(rec().client, ORG, "2026-06"), "Fuel for Hired Vehicles")).toBe("per_truck");
  });

  // Grain is decided after every module is known. Reporting vendor-only because AP was read first
  // would understate what McLeod actually holds about that account.
  it("takes the FINEST grain when an account posts through several modules", async () => {
    const r = await getGlMonthlyCosts(rec().client, ORG, "2026-06");
    const rent = r.accounts.find((a) => a.descr === "Rent Expense")!;
    expect(rent.modules).toEqual(["AP", "OFF"]);
    expect(rent.grain).toBe("per_person");
    expect(rent.amount).toBe(25921.7); // both modules summed, D-MC13
  });

  it("names the modules behind every account, so the grain can be checked rather than trusted", async () => {
    const r = await getGlMonthlyCosts(rec().client, ORG, "2026-06");
    expect(r.accounts.find((a) => a.descr === "VIP Lease")!.modules).toEqual(["GJ"]);
  });
});
