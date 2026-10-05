/**
 * Hand-keyed IFTA fuel receipts — McLeod's `fuel_tax_history` rows with source F (IFTA-PRECISION-PLAN
 * IP6). Read on the financial sweep and posted to /api/tms/fuel-tax-receipts.
 *
 * The receipt window is NOT the sweep's 75-day one. The office keys a quarter's receipts in the first
 * week after the quarter closes, and can correct one later, so a short trailing window would miss a
 * receipt dated 80 days back that was keyed yesterday. They are small (~70 a quarter, 1,255 ever), so
 * the sweep re-reads two whole years every night; that is also the backfill of past quarters.
 */
import { FUEL_TAX_RECEIPTS } from "./queries.mjs";
import { withPool } from "./connection.mjs";

export const RECEIPT_LOOKBACK_YEARS = 2;

/** [windowStart, windowEnd) for the receipt read: two years back from the day after `today`. */
export function receiptWindow(today) {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - RECEIPT_LOOKBACK_YEARS);
  return { windowStart: start.toISOString().slice(0, 10), windowEnd: end.toISOString().slice(0, 10) };
}

/**
 * One row as it crosses the wire. A row missing a tractor or a state is dropped and COUNTED rather
 * than sent: the wire contract requires both, and none existed when this was written (0 of 1,255).
 */
export function mapReceipt(row) {
  if (!row.tractor_unit || !row.jurisdiction || !row.receipt_date) return null;
  return {
    external_id: String(row.external_id).trim(),
    company_id: row.company_id ? String(row.company_id).trim() : null,
    tractor_unit: String(row.tractor_unit).trim(),
    jurisdiction: String(row.jurisdiction).trim().toUpperCase(),
    receipt_date: row.receipt_date,
    gallons: row.gallons == null ? 0 : Number(row.gallons),
    processed_at: row.processed_at ? `${row.processed_at}Z` : null,
    is_void: Number(row.is_void) === 1,
  };
}

export async function fetchFuelTaxReceipts({
  server, port, database, user, password, companyId, windowStart, windowEnd, encrypt, trustCert, serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchFuelTaxReceipts requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }
  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const res = await pool
      .request()
      .input("companyId", mssql.VarChar(32), companyId)
      .input("windowStart", mssql.VarChar(32), windowStart)
      .input("windowEnd", mssql.VarChar(32), windowEnd)
      .query(FUEL_TAX_RECEIPTS);
    const mapped = res.recordset.map(mapReceipt);
    return { receipts: mapped.filter(Boolean), dropped: mapped.filter((r) => !r).length };
  });
}
