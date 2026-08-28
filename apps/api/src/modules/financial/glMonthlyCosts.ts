import type { SupabaseClient } from "@supabase/supabase-js";
import { PNL_EXPENSE_TYPES } from "@silvicom/shared";
import { readLedgerTotals, readGlAccounts } from "../mcleod/index.js";

/**
 * The month's expense accounts, straight from McLeod's ledger, for the fixed-cost schedule page.
 *
 * Why this exists — the 2026-08-28 sandbox audit (D-MC12 territory). The schedule page told the
 * office these were "the per-truck fixed costs McLeod cannot attribute", the page was empty, and
 * the owner read that as a claim McLeod does not HOLD the money. It does. Rebuilding June 2026
 * from `gl_ledger` + `gl_ledger_hist` through `gl_account.type_id` reproduces his printed income
 * statement to the cent — revenue 5,107,789.04, operating 3,245,282.08, G&A 388,494.13, tax
 * 283.90, net 1,473,728.93. Every dollar is there.
 *
 * What McLeod does not hold is the per-TRUCK split, and that was measured too rather than assumed:
 * `gl_ledger` HAS a `tractor` column and 0 of 29,427 June lines populate it; `voucher_hist` has no
 * equipment column at all; `voucher_dist` and `recur_voucher_dist` have one and populate it zero
 * times; and McLeod's own profitability-costing module (`pft_cost`, `cost_fact`, `cost_summary`,
 * `dedicated_fixed_charge`) is entirely empty, never configured by this carrier. VIP Lease posts as
 * six journal lines reading "VIP LEASE"; insurance posts as one reading "Insurance monthly payment".
 *
 * So the schedule stays a manual instrument — it is the only path to a per-truck fixed cost — but
 * the page now shows the GL lines it is meant to cover, and the office reads the split off McLeod's
 * OWN account descriptions rather than being told the money does not exist. No categorisation is
 * inferred here: `descr` and `type_id` are McLeod's, staged by 0272, and the mapping from an account
 * to one of our five schedule categories is a human judgement this endpoint declines to make.
 */

/**
 * How finely McLeod can split an account, derived from the modules it posted through.
 *
 * This is a fact about the source, not a preference, and it is the difference between a page that
 * can be trusted and one that cannot: $194,407 of office payroll and $400,000 of VIP lease look
 * identical as totals, but one resolves to 31 named people and the other resolves to nothing
 * finer than the company. A reader has to be able to tell those apart at a glance, otherwise
 * "company-level" silently reads as "we have not got round to splitting it yet".
 */
export const COST_GRAINS = ["per_truck", "per_person", "per_vendor", "company"] as const;
export type CostGrain = (typeof COST_GRAINS)[number];

/**
 * Module → grain, measured against June 2026 rather than assumed from names.
 *
 *  · SET (2,894 lines, 158 payees) and FUEL (5,752 lines, 152 payees) resolve to a truck through
 *    settlements and fuel purchases.
 *  · OFF (203 lines, 31 payees) resolves to a person and to nothing else — it has no subledger, so
 *    the ledger line is the record (0276).
 *  · AP (408 lines) carries no payee but its vouchers carry a vendor (181 of 183 in June, 30
 *    vendors), which is the finest thing McLeod asserts about it.
 *  · GJ (53 lines, $609,465) and RJ (22 lines, $131,941) carry NEITHER. Lease, insurance, officer
 *    salaries and payroll tax are company-level in McLeod, full stop.
 *
 * An unrecognised module is `company` — the conservative answer, because claiming a split that
 * cannot be produced is worse than admitting there is none.
 */
const GRAIN_BY_MODULE: Record<string, CostGrain> = {
  SET: "per_truck",
  SETV: "per_truck",
  FUEL: "per_truck",
  DRS: "per_truck",
  DED: "per_truck",
  DEDV: "per_truck",
  OFF: "per_person",
  AP: "per_vendor",
};

/** Finest first — an account posting through several modules is reported at the best it can do. */
const GRAIN_RANK: CostGrain[] = ["per_truck", "per_person", "per_vendor", "company"];

export interface GlMonthlyCostAccount {
  glid: string;
  descr: string | null;
  typeId: string | null;
  /** Dollars for the month, debit-positive — the ledger's own sign for an expense. */
  amount: number;
  /** The posting modules this account's dollars came through, for the grain and for provenance. */
  modules: string[];
  /** The finest split McLeod can support for this account. See `GRAIN_BY_MODULE`. */
  grain: CostGrain;
}

export interface GlMonthlyCosts {
  /** The month asked for, "YYYY-MM". */
  period: string;
  /** Whether `mcleod_gl_totals` holds this month at all — false means the sweep has not run. */
  swept: boolean;
  /**
   * Whether the chart of accounts is staged. False is the state production is in until the agent's
   * next `--financial` pass, and it matters: without the master every account is unclassifiable, so
   * the list would come back empty and read as "no costs" rather than "not swept yet".
   */
  accountsStaged: boolean;
  /** Expense accounts for the month, largest first. */
  accounts: GlMonthlyCostAccount[];
  total: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function getGlMonthlyCosts(
  admin: SupabaseClient,
  orgId: string,
  period: string,
): Promise<GlMonthlyCosts> {
  const periodStart = `${period}-01`;
  const [totals, accounts] = await Promise.all([
    readLedgerTotals(admin, orgId, periodStart),
    readGlAccounts(admin, orgId),
  ]);

  const accountsStaged = accounts.length > 0;
  const byGlid = new Map(accounts.map((a) => [a.glid.trim(), a]));
  const expenseTypes = new Set<string>(PNL_EXPENSE_TYPES);

  // A glid can post through several modules in one month (D-MC13: modules are lifecycle views of
  // the same dollars), so the account is the unit of the answer and the modules sum into it.
  const merged = new Map<string, GlMonthlyCostAccount>();
  let total = 0;
  for (const t of totals) {
    const glid = t.glid.trim();
    const account = byGlid.get(glid);
    if (!account || !account.type_id || !expenseTypes.has(account.type_id)) continue;
    const net = Number(t.net_amount);
    const row =
      merged.get(glid) ??
      ({ glid, descr: account.descr, typeId: account.type_id, amount: 0, modules: [], grain: "company" } as GlMonthlyCostAccount);
    row.amount = round(row.amount + net);
    const mod = t.post_module.trim();
    if (mod && !row.modules.includes(mod)) row.modules.push(mod);
    merged.set(glid, row);
    total = round(total + net);
  }

  // Grain is decided once per account, after every module it posted through is known — an account
  // that reached the ledger through both AP and OFF can be split by person, and reporting it as
  // vendor-only because AP happened to be read first would understate what McLeod actually holds.
  for (const row of merged.values()) {
    row.modules.sort();
    const grains = row.modules.map((m) => GRAIN_BY_MODULE[m] ?? "company");
    row.grain = GRAIN_RANK.find((g) => grains.includes(g)) ?? "company";
  }

  return {
    period,
    swept: totals.length > 0,
    accountsStaged,
    accounts: [...merged.values()].sort((a, b) => b.amount - a.amount),
    total,
  };
}
