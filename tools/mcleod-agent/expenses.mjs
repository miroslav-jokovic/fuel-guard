/**
 * Fuel and payables extraction — C2.
 *
 * Two domains in one file because they share a window and a dry run, and because the contrast between
 * them is the point: fuel is fully attributed to a truck and reconciles to the ledger to the cent,
 * while accounts payable carries no equipment link at all. Together they are the whole of the
 * carrier's non-settlement cost, and the split between "attributed" and "needs an allocation rule" is
 * the number finance has to see before it can sign anything off.
 *
 * Read-only, same posture as `movements.mjs`. No `@silvicom/shared` import — this ships to the
 * carrier's own machine with `mssql` as its only dependency.
 */

import process from "node:process";
import { FUEL_PURCHASES, FUEL_LEDGER_LINES, AP_VOUCHERS } from "./queries.mjs";
import { withPool } from "./roster.mjs";

const num = (v) => (v == null ? 0 : Number(v));

/**
 * Collapse McLeod's two funding columns into the one figure that reconciles.
 *
 * `direct_amount` and `funded_amount` are mutually exclusive per row — 1,904 and 355 of June 2026's
 * 2,259 purchases respectively — and which one carries the money is a treasury detail, not a
 * cost-per-mile one. `total_amount` is deliberately NOT used: it is gross, before a card discount that
 * ran 14.6% in June, and it does not tie to the ledger.
 */
function settledAmount(row) {
  const direct = num(row.direct_amount);
  return direct !== 0 ? direct : num(row.funded_amount);
}

function mapPurchase(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    tractor_unit: row.tractor_unit ?? null,
    driver_external_id: row.driver_external_id ?? null,
    movement_external_id: row.movement_external_id ?? null,
    order_external_id: row.order_external_id ?? null,
    purchased_at: row.purchased_at ? `${row.purchased_at}Z` : null,
    state: row.state ?? null,
    truck_stop_name: row.truck_stop_name ?? null,
    truck_stop_city: row.truck_stop_city ?? null,
    card_id: row.card_id ?? null,
    gallons: {
      tractor: num(row.gal_tractor),
      reefer: num(row.gal_reefer),
      def: num(row.gal_def),
      other: num(row.gal_other),
    },
    costs: {
      tractor: num(row.cost_tractor),
      reefer: num(row.cost_reefer),
      def: num(row.cost_def),
      oil: num(row.cost_oil),
      misc: num(row.cost_misc),
      sales_tax: num(row.cost_sales_tax),
      transaction_fee: num(row.cost_transaction_fee),
    },
    total_amount: num(row.total_amount),
    fuel_discount: num(row.fuel_discount),
    settled_amount: settledAmount(row),
    post_key: row.post_key || null,
    post_module: row.post_module || null,
  };
}

function mapVoucher(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    voucher_no: row.voucher_no ?? null,
    voucher_type: row.voucher_type ?? null,
    vendor_id: row.vendor_id ?? null,
    invoice_number: row.invoice_number ?? null,
    purchase_order_no: row.purchase_order_no ?? null,
    description: row.description ?? null,
    invoice_date: row.invoice_date ? `${row.invoice_date}Z` : null,
    due_date: row.due_date ? `${row.due_date}Z` : null,
    distribution_date: row.distribution_date ? `${row.distribution_date}Z` : null,
    amount: num(row.amount),
    discount_amount: num(row.discount_amount),
    ap_glid: row.ap_glid ?? null,
    is_paid: String(row.is_paid ?? "").trim().toUpperCase() === "Y",
    check_number: row.check_number ?? null,
    post_key: row.post_key || null,
    post_module: row.post_module || null,
  };
}

/** Read one window of fuel purchases, their ledger lines, and the AP vouchers alongside them. */
export async function fetchExpenses({
  server, port, database, user, password, companyId,
  windowStart, windowEnd, encrypt, trustCert, serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchExpenses requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }

  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const bind = () =>
      pool
        .request()
        .input("companyId", mssql.VarChar(32), companyId)
        .input("windowStart", mssql.VarChar(32), windowStart)
        .input("windowEnd", mssql.VarChar(32), windowEnd);

    const purchaseRows = await bind().query(FUEL_PURCHASES);
    const ledgerRows = await bind().query(FUEL_LEDGER_LINES);
    const voucherRows = await bind().query(AP_VOUCHERS);

    return {
      purchases: purchaseRows.recordset.map(mapPurchase),
      ledgerLines: ledgerRows.recordset.map((r) => ({
        post_key: r.post_key,
        glid: r.glid,
        amount: num(r.amount),
      })),
      vouchers: voucherRows.recordset.map(mapVoucher),
      window_start: windowStart,
      window_end: windowEnd,
    };
  });
}

/**
 * The carrier-specific account the fuel payable lands in.
 *
 * Duplicated from `packages/shared/src/tmsCost/fuelFact.ts` rather than imported, because the agent
 * has no workspace dependency by design. It is Silvicom's chart of accounts, not a McLeod constant —
 * when a second carrier is onboarded this moves to `.env`, and the two copies must move together.
 */
const FUEL_PAYABLE_GLID_PREFIX = "20550000";

/**
 * Vendors whose AP invoices are fuel already counted by `FUEL_PURCHASES`.
 *
 * Configuration, not a constant, and overridable through MCLEOD_FUEL_VENDOR_IDS. A carrier that
 * switches fuel-card provider would otherwise start double-counting its largest cost silently, on the
 * day the new vendor's first invoice posts, with nothing in the output to show it had happened.
 */
const DEFAULT_FUEL_VENDOR_IDS = new Set(
  (process.env.MCLEOD_FUEL_VENDOR_IDS || "PILOKNTN")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

/**
 * The dry run, and the C2 acceptance test in one.
 *
 * Reconciliation is the whole point. `settledAmount` summed over the extracted purchases must equal
 * the ledger's own payable for the same transactions — not approximately, to the cent. Anything else
 * means rows are missing, double-counted, or the wrong amount column was read, and every one of those
 * failures is silent in a report that only prints totals.
 */
export function summarizeExpenses(
  { purchases, ledgerLines, vouchers, window_start, window_end },
  fuelVendorIds = DEFAULT_FUEL_VENDOR_IDS,
) {
  const round = (n) => Math.round(n * 100) / 100;

  const payableByKey = new Map();
  for (const line of ledgerLines) {
    if (!String(line.glid).startsWith(FUEL_PAYABLE_GLID_PREFIX)) continue;
    payableByKey.set(line.post_key, (payableByKey.get(line.post_key) ?? 0) + line.amount);
  }

  let extracted = 0, gross = 0, discount = 0, unmatchedPurchases = 0, unposted = 0;
  const gallons = { tractor: 0, reefer: 0, def: 0, other: 0 };
  const tractors = new Set();
  const states = new Set();
  const seenKeys = new Set();

  for (const p of purchases) {
    extracted += p.settled_amount;
    gross += p.total_amount;
    discount += p.fuel_discount;
    for (const k of Object.keys(gallons)) gallons[k] += p.gallons[k];
    if (p.tractor_unit) tractors.add(p.tractor_unit);
    if (p.state) states.add(p.state);
    if (!p.post_key) unposted++;
    else if (payableByKey.has(p.post_key)) seenKeys.add(p.post_key);
    else unmatchedPurchases++;
  }

  let ledger = 0;
  for (const amount of payableByKey.values()) ledger += -amount;

  const difference = round(extracted - ledger);

  // Vouchers: an inventory of unattributed cost by expense account, which is what finance needs in
  // order to write an allocation rule. Not an allocation — this file never guesses at a truck.
  //
  // Split on the fuel vendor first. The fuel-card company invoices the carrier through AP for the
  // same purchases the fuel half of this report already counted — $1,017,601.81 of June 2026's
  // $1,453,255.46, the very figure the ledger and fuel_detail independently agree on. `otherTotal` is
  // the number that belongs in cost per mile; `fuelVendorTotal` is shown beside it so the overlap is
  // visible rather than quietly removed.
  const byAccount = new Map();
  let otherTotal = 0;
  let fuelVendorTotal = 0;
  let fuelVendorVouchers = 0;
  for (const v of vouchers) {
    if (v.vendor_id && fuelVendorIds.has(v.vendor_id.trim().toUpperCase())) {
      fuelVendorTotal += v.amount;
      fuelVendorVouchers++;
      continue;
    }
    otherTotal += v.amount;
    const key = v.ap_glid?.trim() || "(unclassified)";
    byAccount.set(key, (byAccount.get(key) ?? 0) + v.amount);
  }
  const topAccounts = [...byAccount.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8)
    .map(([ap_glid, amount]) => ({ ap_glid, amount: round(amount) }));

  return {
    window: `${window_start} .. ${window_end}`,
    fuel: {
      purchases: purchases.length,
      tractors: tractors.size,
      states: states.size,
      gallons: Object.fromEntries(Object.entries(gallons).map(([k, v]) => [k, round(v)])),
      grossAmount: round(gross),
      fuelDiscount: round(discount),
      settledAmount: round(extracted),
      ledgerPayable: round(ledger),
      difference,
      unpostedPurchases: unposted,
      unmatchedPurchases,
      unmatchedLedgerKeys: payableByKey.size - seenKeys.size,
      reconciled: difference === 0 && unmatchedPurchases === 0 && payableByKey.size === seenKeys.size,
    },
    payables: {
      vouchers: vouchers.length,
      /** Non-fuel payables — the figure CPM allocates. */
      otherExpenses: round(otherTotal),
      /** Already counted under `fuel`. Reported so the double-count is visible, never summed in. */
      fuelVendorVouchers,
      fuelVendorTotal: round(fuelVendorTotal),
      /** Structurally zero: voucher_hist has no equipment column, and voucher_dist.tractor is empty. */
      attributedToTruck: 0,
      topAccounts,
    },
  };
}

/** `npm run expenses -- 2026-06-01 2026-07-01` — reads and reports, sends nothing. */
async function main() {
  const [windowStart, windowEnd] = process.argv.slice(2);
  if (!windowStart || !windowEnd) {
    console.error("usage: npm run expenses -- <windowStart YYYY-MM-DD> <windowEnd YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }

  const result = await fetchExpenses({
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

  const summary = summarizeExpenses(result);
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.fuel.reconciled) {
    console.error(
      `\nFAIL: fuel does not reconcile to the ledger.` +
        ` difference=${summary.fuel.difference}` +
        ` unmatchedPurchases=${summary.fuel.unmatchedPurchases}` +
        ` unmatchedLedgerKeys=${summary.fuel.unmatchedLedgerKeys}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
