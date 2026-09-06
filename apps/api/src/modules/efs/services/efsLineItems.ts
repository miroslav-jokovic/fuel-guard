import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The faithful store's card lines for one window, by product — the reader the FUEL tie-out needs
 * (D-FIN12) and the only door `financial` has to `efs_transactions` (D-SEP1: a collector exports
 * readers over its raw table, nothing else reads it).
 *
 * `amt` is the line's own dollars and `item` its product code (ULSD, DEFD, ULSR, SCLE, …), which is
 * exactly the grain McLeod posts at; `fuel_transactions.total_cost` has already folded a fill's
 * lines together, which is why the tie-out cannot read the derived table. `unit` is the truck the
 * pump line names, as printed — the tie-out matches it against settlement tractor units to route
 * owner-operator fuel to the asset account.
 *
 * Windowed on `tran_date`, the EFS business date (the org time zone is D-FIN9's step, not this one).
 */
export interface EfsLineItemRow {
  item: string | null;
  amt: number | string | null;
  unit: string | null;
  tran_date: string | null;
}

const PAGE = 1000;

export async function readEfsLineItemsWindow(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<EfsLineItemRow[]> {
  const out: EfsLineItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("efs_transactions")
      .select("item, amt, unit, tran_date")
      .eq("org_id", orgId)
      .gte("tran_date", fromIso)
      .lt("tran_date", toIso)
      .order("tran_date", { ascending: true })
      .order("id", { ascending: true }) // a day's lines tie on tran_date; id makes the page order total
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EfsLineItemRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
