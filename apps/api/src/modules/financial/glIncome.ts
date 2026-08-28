import type { SupabaseClient } from "@supabase/supabase-js";
import { PNL_REVENUE_TYPES, PNL_EXPENSE_TYPES } from "@silvicom/shared";
import { readLedgerTotals, readGlAccounts } from "../mcleod/index.js";

/**
 * The GL read as an income statement — the fleet-truth check (T7's first working piece).
 *
 * Why this exists: the owner reconciled his own monthly P&L spreadsheet against our staged GL on
 * 2026-08-28 and they matched to the dollar, Jan–Jun 2026 — which proved the STORE is complete and
 * simultaneously that the CPM page's cost figures (per-truck attributable cost only) read ~80¢/mi
 * lower than the whole fleet's actual burn. The page must carry the GL number next to its own so the
 * difference is a stated composition gap, never a surprise.
 *
 * Sign convention is the ledger's own: revenue accounts carry credit (negative) nets, expenses
 * debit (positive). Classification is McLeod's `gl_account.type_id`, staged in 0272 — never
 * inferred from account numbers or names. Dollars in accounts whose class is unknown (master not
 * yet swept, or a class outside the P&L set) are returned as `unclassifiedNet`, visible.
 */
export interface GlIncomeSummary {
  revenue: number;
  expenses: number;
  net: number;
  /** Months whose GL totals are staged, of the months asked for. */
  monthsCovered: string[];
  monthsMissing: string[];
  /** Net dollars in accounts the staged master cannot classify — nonzero means sweep the master. */
  unclassifiedNet: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function getGlIncomeForMonths(
  admin: SupabaseClient,
  orgId: string,
  months: Array<{ year: number; month: number }>,
): Promise<GlIncomeSummary> {
  const accounts = await readGlAccounts(admin, orgId);
  const typeByGlid = new Map(accounts.map((a) => [a.glid, a.type_id ?? ""]));
  const revenueTypes = new Set<string>(PNL_REVENUE_TYPES);
  const expenseTypes = new Set<string>(PNL_EXPENSE_TYPES);

  let revenue = 0;
  let expenses = 0;
  let unclassifiedNet = 0;
  const monthsCovered: string[] = [];
  const monthsMissing: string[] = [];
  for (const m of months) {
    const periodStart = `${m.year}-${String(m.month).padStart(2, "0")}-01`;
    const totals = await readLedgerTotals(admin, orgId, periodStart);
    if (!totals.length) {
      monthsMissing.push(periodStart.slice(0, 7));
      continue;
    }
    monthsCovered.push(periodStart.slice(0, 7));
    for (const t of totals) {
      const type = typeByGlid.get(t.glid.trim());
      const net = Number(t.net_amount);
      if (type != null && revenueTypes.has(type)) revenue = round(revenue - net);
      else if (type != null && expenseTypes.has(type)) expenses = round(expenses + net);
      else if (type == null) unclassifiedNet = round(unclassifiedNet + net);
      // Balance-sheet classes fall through on purpose — a loan draw is not income.
    }
  }
  return { revenue, expenses, net: round(revenue - expenses), monthsCovered, monthsMissing, unclassifiedNet };
}
