/**
 * Invoiced-revenue extraction — the earnings side (P3.3), unblocked by recon F1/F2 2026-08-27.
 *
 * A DRY RUN and nothing else, exactly as movements.mjs began: it reads, it reports, it sends
 * nothing. Two gates stand between this file and posting, both evidential:
 *
 *   1. The VOID PREDICATE. F1 surfaced `canceled` and `rebilled` flags with unmeasured
 *      vocabularies. This summary prints their cross-tab WITH DOLLARS; the filter gets written
 *      from that table, because importing a canceled invoice as revenue overstates every report.
 *   2. The ACCEPTANCE CHECK. The monthly totals printed here must match the carrier's own income
 *      statement (June 2026 gross trucking income is a number the owner recognises). If they do
 *      not, the extraction is wrong and nothing downstream of it is worth debugging.
 *
 * When both pass, posting is one small change: map rows through `mapBilling` (already the neutral
 * `tmsBillingFactSchema` shape, minus the two flag columns the contract deliberately does not
 * carry) and send to /api/tms/billing, which has been standing ready since 0257.
 */

import process from "node:process";
import { BILLING_HISTORY } from "./queries.mjs";
import { withPool } from "./roster.mjs";

const num = (v) => (v == null ? 0 : Number(v));

/** The neutral contract shape (billingFact.ts). The canceled/rebilled flags stay agent-side. */
export function mapBilling(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    invoice_no: row.invoice_no == null ? null : String(row.invoice_no),
    customer_id: row.customer_id ?? null,
    order_external_id: row.order_external_id ?? null,
    master_order_id: row.master_order_id ?? null,
    tractor_unit: row.tractor_unit ?? null,
    trailer_unit: row.trailer_unit ?? null,
    driver_external_id: row.driver_external_id ?? null,
    bill_date: row.bill_date ? `${row.bill_date}Z` : null,
    ship_date: row.ship_date ? `${row.ship_date}Z` : null,
    delivery_date: row.delivery_date ? `${row.delivery_date}Z` : null,
    transfer_date: row.transfer_date ? `${row.transfer_date}Z` : null,
    total_charges: num(row.total_charges),
    other_charge: num(row.other_charge),
    excise_tax: num(row.excise_tax),
    canceled: row.canceled ?? null,
    rebilled: row.rebilled ?? null,
    billing_loaded_distance: row.billing_loaded_distance == null ? null : num(row.billing_loaded_distance),
    billing_empty_distance: row.billing_empty_distance == null ? null : num(row.billing_empty_distance),
    post_key: row.post_key || null,
    post_module: row.post_module || null,
  };
}

/** Read one bill-date window. Explicit half-open window, no watermark — D-MC14, as everywhere. */
export async function fetchBilling({
  server, port, database, user, password, companyId,
  windowStart, windowEnd, encrypt, trustCert, serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchBilling requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }
  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const res = await pool
      .request()
      .input("companyId", mssql.VarChar(32), companyId)
      .input("windowStart", mssql.VarChar(32), windowStart)
      .input("windowEnd", mssql.VarChar(32), windowEnd)
      .query(BILLING_HISTORY);
    return { rows: res.recordset, window_start: windowStart, window_end: windowEnd };
  });
}

/**
 * The dry-run report. `byMonth` is the line to hold against the income statement; `flags` is the
 * evidence the void predicate gets written from; the attribution block is what makes this table
 * worth having at all — revenue per truck exists nowhere else in McLeod.
 */
export function summarizeBilling({ rows, window_start, window_end }) {
  const ids = new Set();
  let duplicates = 0;
  const byMonth = new Map();
  const flags = new Map();
  let withTractor = 0;
  let withDriver = 0;

  for (const r of rows) {
    if (ids.has(r.external_id)) duplicates++;
    ids.add(r.external_id);
    if (r.tractor_unit) withTractor++;
    if (r.driver_external_id) withDriver++;

    const month = (r.bill_date || "unknown").slice(0, 7);
    const m = byMonth.get(month) ?? { rows: 0, total_charges: 0, other_charge: 0, excise_tax: 0 };
    m.rows++;
    m.total_charges += num(r.total_charges);
    m.other_charge += num(r.other_charge);
    m.excise_tax += num(r.excise_tax);
    byMonth.set(month, m);

    const key = `canceled=${r.canceled ?? "∅"} rebilled=${r.rebilled ?? "∅"}`;
    const f = flags.get(key) ?? { rows: 0, total_charges: 0 };
    f.rows++;
    f.total_charges += num(r.total_charges);
    flags.set(key, f);
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  for (const m of byMonth.values()) {
    m.total_charges = round2(m.total_charges);
    m.other_charge = round2(m.other_charge);
    m.excise_tax = round2(m.excise_tax);
  }
  for (const f of flags.values()) f.total_charges = round2(f.total_charges);

  return {
    window: `${window_start} .. ${window_end}`,
    invoices: rows.length,
    duplicates,
    withTractor,
    withDriver,
    byMonth: Object.fromEntries([...byMonth.entries()].sort()),
    flags: Object.fromEntries([...flags.entries()].sort()),
  };
}

/** `npm run billing -- 2026-06-01 2026-07-01` — reads and reports; posts nothing. */
async function main() {
  const [windowStart, windowEnd] = process.argv.slice(2);
  if (!windowStart || !windowEnd) {
    console.error("usage: npm run billing -- <windowStart YYYY-MM-DD> <windowEnd YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }
  const result = await fetchBilling({
    server: process.env.MCLEOD_SQL_SERVER,
    port: Number(process.env.MCLEOD_SQL_PORT || 1433),
    database: process.env.MCLEOD_SQL_DATABASE,
    user: process.env.MCLEOD_SQL_USER,
    password: process.env.MCLEOD_SQL_PASSWORD,
    companyId: process.env.MCLEOD_COMPANY_ID,
    encrypt: process.env.MCLEOD_SQL_ENCRYPT !== "false",
    trustCert: process.env.MCLEOD_SQL_TRUST_CERT !== "false",
    serverName: process.env.MCLEOD_SQL_SERVERNAME || undefined,
    windowStart,
    windowEnd,
  });

  const summary = summarizeBilling(result);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.duplicates > 0) {
    console.error(`\nFAIL: ${summary.duplicates} duplicated invoice rows.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
