import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The accounts-payable side of FleetPal's coverage bridge (FLEETPAL-INTEGRATION-PLAN §2.4, D-FP17).
 *
 * `modules/fleetpal` may not touch `mcleod_*` — the raw layer belongs to its collector (D-SEP1,
 * `lint:table-access`) — so the read it needs lives here and is exported through the McLeod
 * module's index. That is the D-ARC3 door, and the `fleetpal -> mcleod` edge is declared in
 * `check-feature-boundaries.mjs` with this file as its reason.
 *
 * ── WHY `readApVouchersWindow` COULD NOT BE REUSED ────────────────────────────────────────────
 * It does not select `invoice_number`, and `invoice_number` is the ENTIRE join. Widening its
 * projection would change the shape every financial caller already depends on, to carry a column
 * none of them read, so this is a second narrow reader rather than a wider shared one.
 *
 * ── ⚠ THESE VOUCHERS ARE NOT FILTERED TO MAINTENANCE, BECAUSE THEY CANNOT BE (D-FP17) ─────────
 * The obvious query — "AP vouchers in the maintenance GL family" — does not exist.
 * `mcleod_ap_vouchers.ap_glid` is the accounts-payable CONTROL account, not the expense account:
 * measured on production 2026-09-21 it is `20000000` on 1,278 of 1,658 rows and null on the other
 * 380, one distinct non-null value in the whole table. The expense distribution lives on voucher
 * DETAIL rows this stack does not stage, so a voucher header carries no expense dimension at all.
 *
 * FleetPal supplies that dimension instead: every invoice it holds is against a maintenance
 * purchase order, so a voucher whose number matches one is maintenance spend on FleetPal's
 * evidence. This reader therefore returns the whole window and the caller's number-match does the
 * classifying. A reader that pretended to filter by family would be returning the same rows behind
 * a name that claimed otherwise.
 *
 * ── THE DATE IS THE ONE ECONOMIC DATE (D-FIN7) ────────────────────────────────────────────────
 * `coalesce(distribution_date, invoice_date)`, the same expression the agent sweeps on and the
 * projection stamps `occurred_at` with — a distributed voucher by its distribution date, an
 * undistributed one by its invoice date. Spelled as PostgREST can say it. Reading only
 * `invoice_date` here would put a voucher in a different month than every other financial surface
 * shows it in, and the coverage ratio would disagree with the ledger page beside it.
 */

export interface StagedVoucherNumber {
  id: string;
  /** The vendor's own invoice number, as McLeod holds it. Not unique across vendors. */
  invoice_number: string | null;
  vendor_id: string | null;
  invoice_date: string | null;
  distribution_date: string | null;
  amount: number | string;
}

/** PostgREST caps every response at 1,000 rows regardless of `.limit()`; the walk is the defence. */
const PAGE = 1000;

/**
 * Every AP voucher whose economic date falls in `[fromIso, toIso)`, with its invoice number.
 *
 * ⚠ Ordered by `id` as a tiebreaker. Same-day vouchers tie on the date, and `.range()` paging over
 * a tied sort repeats and drops boundary rows — the failure the settlements reader records at
 * length, which took a projection down on 2026-08-28.
 */
export async function readVoucherNumbersWindow(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<StagedVoucherNumber[]> {
  const out: StagedVoucherNumber[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("mcleod_ap_vouchers")
      .select("id, invoice_number, vendor_id, invoice_date, distribution_date, amount")
      .eq("org_id", orgId)
      .or(
        `and(distribution_date.gte.${fromIso},distribution_date.lt.${toIso}),` +
          `and(distribution_date.is.null,invoice_date.gte.${fromIso},invoice_date.lt.${toIso})`,
      )
      .order("distribution_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`mcleod_ap_vouchers read failed: ${error.message}`);
    const rows = (data ?? []) as StagedVoucherNumber[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
