/**
 * Read one recorded weekly Pilot bill and rebuild it in the old statement's columns
 * (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3). The arithmetic is `buildWeeklyBillReport`'s; this file only
 * reads what was recorded and the quotes for the same stations and days.
 *
 * Reads the RECORDED lines (`fuel_statement_lines`), never a re-parse: the lines are evidence (append-only,
 * RETENTION_FORBIDDEN), so the report opened next month is built from exactly what was accepted today.
 * The quotes are read live — a quote that arrives late (the price mail retries) fills in on the next open.
 *
 * Every query filters `org_id` explicitly: the service role bypasses RLS, so the filter IS the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWeeklyBillReport, pickPilotQuote, type WeeklyBillLineIn, type WeeklyBillReport } from "@silvicom/shared";
import { readPilotQuotes } from "../posted-prices/index.js";
import { eachPage } from "../../lib/paging.js";

export interface WeeklyBillStatement {
  id: string;
  invoiceNo: string;
  accountNo: string | null;
  periodStart: string;
  periodEnd: string;
  billingDate: string | null;
  sourceFilename: string | null;
  /** What Pilot printed, when it printed it. The 2026-11 invoice prints only the amount. */
  printed: { amount: number | null; retail: number | null; savings: number | null };
  supersededBy: string | null;
}

export type WeeklyBillResult =
  | { ok: true; statement: WeeklyBillStatement; report: WeeklyBillReport }
  | { ok: false; notFound: true }
  | { ok: false; notFound?: false; error: string };

const LINE_COLS = "line_number, product_code, tank_type, tran_date, card_ref, unit_number, po_name, auth_no, ticket_no, odometer, site_number, city, state, station_id, pilot_vehicle_id, pilot_driver_id, gallons, unit_cost, fuel_amount, misc_amount, sales_tax, invoice_total, retail_total";

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function toLine(r: Record<string, unknown>): WeeklyBillLineIn {
  const tank = r.tank_type;
  return {
    lineNumber: Number(r.line_number),
    productCode: str(r.product_code),
    tank: tank === "tractor" || tank === "reefer" || tank === "none" ? tank : null,
    tranDate: str(r.tran_date),
    cardRef: str(r.card_ref),
    unit: str(r.unit_number),
    poName: str(r.po_name),
    authNo: str(r.auth_no),
    ticket: str(r.ticket_no),
    odometer: num(r.odometer),
    site: str(r.site_number),
    city: str(r.city),
    state: str(r.state),
    stationId: str(r.station_id),
    vehicleId: str(r.pilot_vehicle_id),
    driverId: str(r.pilot_driver_id),
    gallons: num(r.gallons) ?? 0,
    unitCost: num(r.unit_cost),
    fuelAmount: num(r.fuel_amount),
    miscAmount: num(r.misc_amount),
    salesTax: num(r.sales_tax),
    invoiceTotal: num(r.invoice_total),
    retailTotal: num(r.retail_total),
  };
}

export async function readWeeklyBill(admin: SupabaseClient, orgId: string, statementId: string): Promise<WeeklyBillResult> {
  const { data: s, error } = await admin
    .from("fuel_statements")
    .select("id, invoice_no, account_no, period_start, period_end, billing_date, source_filename, printed_amount, printed_retail, printed_savings, superseded_by")
    .eq("org_id", orgId)
    .eq("id", statementId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!s) return { ok: false, notFound: true };
  const st = s as Record<string, unknown>;

  const lines: WeeklyBillLineIn[] = [];
  let lineError: string | null = null;
  await eachPage(
    (a, b) =>
      admin
        .from("fuel_statement_lines")
        .select(LINE_COLS)
        .eq("org_id", orgId)
        .eq("statement_id", statementId)
        .order("line_number", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) lines.push(toLine(r as Record<string, unknown>));
    },
  ).catch((e: unknown) => {
    lineError = e instanceof Error ? e.message : String(e);
  });
  if (lineError) return { ok: false, error: lineError };

  const stations = lines.map((l) => l.stationId).filter((id): id is string => id != null);
  const quotes = await readPilotQuotes(admin, orgId, stations, String(st.period_start), String(st.period_end));
  const report = buildWeeklyBillReport(lines, (stationId, date) => pickPilotQuote(quotes.get(stationId) ?? [], date));

  return {
    ok: true,
    statement: {
      id: String(st.id),
      invoiceNo: String(st.invoice_no),
      accountNo: str(st.account_no),
      periodStart: String(st.period_start),
      periodEnd: String(st.period_end),
      billingDate: str(st.billing_date),
      sourceFilename: str(st.source_filename),
      printed: { amount: num(st.printed_amount), retail: num(st.printed_retail), savings: num(st.printed_savings) },
      supersededBy: str(st.superseded_by),
    },
    report,
  };
}
