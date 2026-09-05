import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FUEL_EXCEPTION_KIND_LABELS,
  FUEL_EXCEPTION_STATUS_LABELS,
  type FuelExceptionKind,
  type FuelExceptionStatus,
} from "@silvicom/shared";
import { pageAll, renderCsv, type CsvExport, type ExportScope } from "../../lib/csvExport.js";
import type { ExceptionFilters } from "./fuelExceptions.js";

/**
 * The finding ledger, as a file (FUEL-P2 / P3, D-FUI15).
 *
 * ── WHAT THIS REPLACES, AND WHY IT COUNTS AS A CORRECTNESS FIX ──────────────────────────────────
 * `FuelExceptionsPage.vue` had an "Export CSV" button that serialised `rows.value` — **the 25 rows on
 * the current page**. A controller assembling a claim from a filtered ledger got page one of it, with
 * no indication that anything was missing, and the four tiles above the button said $41,000 while the
 * file said $600. That is not a smaller export, it is a wrong one.
 *
 * This reads the whole filtered set, through the same `listExceptions` filters the screen applies —
 * status, kind, window, owner and the trucks P3 added — pages it (PostgREST answers 1,000 rows
 * whatever is asked for), and refuses past the ceiling rather than stopping quietly.
 *
 * ── WHY IT IS A SEPARATE FILE FROM THE DISPUTE PACKET ───────────────────────────────────────────
 * `renderDisputePacket` takes IDS: it is the document you send Pilot about findings somebody chose. A
 * spreadsheet of a filtered ledger is a different job with a different scope, and folding them into
 * one call taking "either ids or filters" would be one function with two meanings.
 *
 * ⚠ The service role bypasses RLS: the query carries its own `.eq("org_id", …)`.
 */

const COLS =
  "id, kind, occurred_on, amount, amount_kind, unit_number, site_number, city, state, brand, " +
  "status, assigned_to, resolved_at, resolution_note, credited_amount, credited_on, first_seen_at, last_seen_at";

/**
 * The ledger's columns.
 *
 * The four KINDS of money stay apart in their own column rather than being summed into one figure
 * (D-FX5): overbilled is recoverable, unbilled may still be owed, and unrecorded is unexplained. A
 * spreadsheet that added them would produce a number this product refuses to print.
 */
const HEADERS = [
  "Date", "Finding", "Amount", "Kind of money", "Unit", "Site", "City", "State", "Brand",
  "Status", "Credited", "Credited on", "Note", "First seen", "Last seen",
] as const;

interface LedgerRow {
  kind: FuelExceptionKind;
  occurred_on: string | null;
  amount: number | string;
  amount_kind: string;
  unit_number: string | null;
  site_number: string | null;
  city: string | null;
  state: string | null;
  brand: string | null;
  status: FuelExceptionStatus;
  credited_amount: number | string | null;
  credited_on: string | null;
  resolution_note: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface LedgerExportInput {
  orgId: string;
  /** The list's own filters, minus paging — the export is the whole set, not a page of it. */
  filters: Omit<ExceptionFilters, "limit" | "offset">;
  scope: ExportScope;
}

export async function exportExceptions(admin: SupabaseClient, input: LedgerExportInput): Promise<CsvExport> {
  const f = input.filters;
  const rows = await pageAll<LedgerRow>((from, to) => {
    let q = admin.from("fuel_exceptions").select(COLS, { count: "exact" }).eq("org_id", input.orgId);
    if (f.status?.length) q = q.in("status", f.status);
    if (f.kind?.length) q = q.in("kind", f.kind);
    if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
    if (f.unitNumbers) q = q.in("unit_number", f.unitNumbers);
    if (f.from) q = q.gte("occurred_on", f.from);
    if (f.to) q = q.lte("occurred_on", f.to);
    // The screen's order — newest first, biggest first within a day — plus `id`, because two findings
    // on one day for one amount are a tie, and a tied sort is not a total order to page through.
    return q
      .order("occurred_on", { ascending: false })
      .order("amount", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });

  return renderCsv(
    input.scope,
    HEADERS,
    rows.map((r) => [
      r.occurred_on,
      // The label the screen shows, from the same map — a file that named kinds differently from the
      // page would be answered with "which report is this?" every time it was sent.
      FUEL_EXCEPTION_KIND_LABELS[r.kind] ?? r.kind,
      Number(r.amount).toFixed(2),
      r.amount_kind,
      r.unit_number,
      r.site_number,
      r.city,
      r.state,
      r.brand,
      FUEL_EXCEPTION_STATUS_LABELS[r.status] ?? r.status,
      r.credited_amount == null ? "" : Number(r.credited_amount).toFixed(2),
      r.credited_on,
      r.resolution_note,
      r.first_seen_at.slice(0, 10),
      r.last_seen_at.slice(0, 10),
    ]),
  );
}
