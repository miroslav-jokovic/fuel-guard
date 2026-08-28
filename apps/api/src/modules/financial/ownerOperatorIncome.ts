import type { SupabaseClient } from "@supabase/supabase-js";
import { PNL_REVENUE_TYPES } from "@silvicom/shared";
import { readOwnerOperatorDeductions, readGlAccounts } from "../mcleod/index.js";

/**
 * Owner-operator deduction INCOME, per payee — the carrier's earning beyond the share of the load
 * it retained (owner request, 2026-08-28).
 *
 * "Deduction" is three unrelated economic events wearing one word, and only the GL account tells
 * them apart. Measured on June 2026:
 *
 *  · A credit to a REVENUE account is money the carrier earned — Equipment Rental, Insurance
 *    Collection O/O, Installment Sale, ~$29,733 across five payees. This is what belongs in margin.
 *  · A credit to a BALANCE-SHEET account is a contractor repaying an advance, not income. `FEE`
 *    credits `Fuel Advance` ($53,196.95, a Current Asset) and `SL` credits Company Driver Payable
 *    ($30,515.08). Counting either would book earnings out of a receivable being settled.
 *  · A credit to an EXPENSE account is a cost recovery the ledger has ALREADY applied — these post
 *    through the DRS module as negatives, so the income statement is net of them. Counting them
 *    here would put the same dollar in the report twice.
 *
 * The classification is McLeod's own `gl_account.type_id`, never a list of deduct codes we keep.
 * June alone used 23 codes, several of them opaque (`OWR`, `TOP`, `DRT`, `STL`); a hardcoded list
 * would be an attribution we invented, and it would silently miss the next code the bookkeeper adds
 * with no gate to catch it. 0274 stages the account so this join is possible at all.
 */
export async function readOwnerOperatorDeductionIncome(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<Record<string, number>> {
  const [deductions, glAccounts] = await Promise.all([
    readOwnerOperatorDeductions(admin, orgId, fromIso, toIso),
    readGlAccounts(admin, orgId),
  ]);

  const revenueTypes = new Set<string>(PNL_REVENUE_TYPES);
  const revenueGlids = new Set(
    glAccounts.filter((a) => a.type_id && revenueTypes.has(a.type_id)).map((a) => a.glid.trim()),
  );

  const byPayee: Record<string, number> = {};
  for (const d of deductions) {
    const glid = d.glid?.trim();
    // An unmapped account lands in neither bucket rather than being guessed into one.
    if (!glid || !revenueGlids.has(glid) || !d.payee_id) continue;
    const amount = d.amount == null ? 0 : Number(d.amount);
    byPayee[d.payee_id] = Math.round(((byPayee[d.payee_id] ?? 0) + amount) * 100) / 100;
  }
  return byPayee;
}
