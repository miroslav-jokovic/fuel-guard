import type { SupabaseClient } from "@supabase/supabase-js";
import { applyEfsTxnFilters, type EfsListFilters } from "@silvicom/shared";
import { pageAll, renderCsv, type CsvExport, type ExportScope } from "../../lib/csvExport.js";

/**
 * The Fuel Log's `Source records` tab, as a file (FUEL-P2, D-FUI15).
 *
 * ── WHY THIS LIVES IN THE EFS MODULE AND NOT BESIDE THE OTHER TWO EXPORTS ───────────────────────
 * `efs_transactions` is the efs collector's RAW table, and D-SEP1 says raw collected data is read by
 * the collector that owns it — `check-table-access.mjs` enforces it by path, with a grandfathered list
 * that may only shrink. The fills and declines exports sit in `modules/fuel` because both of their
 * tables belong to `fuel`; this one belongs here. Three exports, two modules, one shape — the shape
 * being `lib/csvExport.ts` and the filters being `@silvicom/shared`.
 *
 * Splitting them costs a file and keeps the ownership map readable, which is the whole point of the
 * gate. Putting all three in one module would have added a fourth entry to a list that is supposed to
 * be emptying.
 *
 * ⚠ The service role bypasses RLS: the query carries its own `.eq("org_id", …)`, and that filter is
 * the only tenant boundary this code has.
 */

const SOURCE_COLS =
  "id, line_number, card_num, tran_date, tran_time, invoice, unit, driver_name, odometer, " +
  "location_name, city, state, item, unit_price, qty, amt, fees, db, currency";

/**
 * The columns a raw EFS line exports as — the Source-records table's own seventeen, in its order.
 *
 * This tab is the one place in the section that shows the vendor's lines UNCHANGED, so its export has
 * no reason to reshape them: a controller reconciling an invoice is matching this file against a PDF
 * from Pilot line by line. `tran_date` and `tran_time` stay as EFS printed them rather than becoming
 * an instant, for the same reason the screen does.
 */
const SOURCE_HEADERS = [
  "Unit", "Tran date", "Time", "Card", "Invoice", "Driver", "Odometer", "Location", "City",
  "State", "Item", "Unit price", "Qty", "Amt", "Fees", "DB", "Currency",
] as const;

export interface SourceExportInput {
  orgId: string;
  filters: EfsListFilters;
  scope: ExportScope;
}

export async function exportSourceRecords(admin: SupabaseClient, input: SourceExportInput): Promise<CsvExport> {
  const rows = await pageAll<Record<string, unknown>>((from, to) =>
    applyEfsTxnFilters(
      admin
        .from("efs_transactions")
        .select(SOURCE_COLS, { count: "exact" })
        .eq("org_id", input.orgId)
        // Undated lines — the fee, DEF and footer rows with no Tran Date — sort to the BOTTOM rather
        // than floating to the top of a descending sort, exactly as they do on screen. `line_number`
        // then `id` is the tiebreaker: a page boundary inside one day's lines must not repeat or drop
        // a row, and `tran_date` alone is tied across hundreds of them.
        .order("tran_date", { ascending: false, nullsFirst: false })
        .order("line_number", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to),
      input.filters,
    ),
  );

  return renderCsv(
    input.scope,
    SOURCE_HEADERS,
    rows.map((r) => [
      r.unit, r.tran_date, r.tran_time, r.card_num, r.invoice, r.driver_name, r.odometer,
      r.location_name, r.city, r.state, r.item, r.unit_price, r.qty, r.amt, r.fees, r.db, r.currency,
    ]),
  );
}
