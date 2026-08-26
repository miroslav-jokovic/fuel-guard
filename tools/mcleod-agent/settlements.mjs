/**
 * Settlement extraction — C3.
 *
 * Driver and owner-operator pay, windowed on the accrual date and reconciled against the accrual side
 * of the general ledger. Read-only, same posture as `movements.mjs` and `expenses.mjs`, and no
 * `@fuelguard/shared` import — this ships to the carrier's machine with `mssql` as its only dependency.
 *
 * The one thing to keep in mind while reading this file: settlement, payroll, checks and the ledger
 * are four views of the SAME payment (D-MC13). This sweep reads the settlement view alone. Nothing
 * here may be added to `drs_payroll_hist` or `drs_check`.
 */

import process from "node:process";
import { SETTLEMENTS, SETTLEMENT_LEDGER_LINES, SETTLEMENT_DEDUCTIONS } from "./queries.mjs";
import { withPool } from "./roster.mjs";

const num = (v) => (v == null ? 0 : Number(v));

/**
 * McLeod's single-character payee code, mapped to something a reader cannot misread.
 *
 * 'C' and 'O' are not two flavours of the same cost. A company-driver settlement is wages against a
 * truck whose fuel and maintenance the carrier pays separately; an owner-operator settlement buys the
 * entire trip from a contractor and already contains all of it. Anything unrecognised maps to 'other'
 * rather than being folded into the larger bucket.
 */
const PAYEE_TYPE = { C: "company_driver", O: "owner_operator" };

function mapSettlement(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    tractor_unit: row.tractor_unit ?? null,
    trailer_unit: row.trailer_unit ?? null,
    driver_external_id: row.driver_external_id ?? null,
    movement_external_id: row.movement_external_id ?? null,
    order_external_id: row.order_external_id ?? null,
    payee_id: row.payee_id ?? null,
    payee_type: PAYEE_TYPE[String(row.payee_type || "").trim()] ?? "other",
    pay_method: row.pay_method ?? null,
    accrued_at: row.accrued_at ? `${row.accrued_at}Z` : null,
    paid_at: row.paid_at ? `${row.paid_at}Z` : null,
    transferred_at: row.transferred_at ? `${row.transferred_at}Z` : null,
    total_pay: num(row.total_pay),
    posted_pay: num(row.posted_pay),
    pay_distance: row.pay_distance == null ? null : Number(row.pay_distance),
    accrual_key: row.accrual_key || null,
    post_key: row.post_key || null,
  };
}

function mapDeduction(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    payee_id: row.payee_id ?? null,
    payee_type: PAYEE_TYPE[String(row.payee_type || "").trim()] ?? "other",
    tractor_unit: row.tractor_unit ?? null,
    deduct_code: row.deduct_code ?? null,
    deduction_type: row.deduction_type ?? null,
    transacted_at: row.transacted_at ? `${row.transacted_at}Z` : null,
    amount: num(row.amount),
    accrual_key: row.accrual_key || null,
  };
}

/** Read one accrual window of settlements, their accrual-side ledger lines, and the deductions. */
export async function fetchSettlements({
  server, port, database, user, password, companyId,
  windowStart, windowEnd, encrypt, trustCert, serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchSettlements requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }

  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const bind = () =>
      pool
        .request()
        .input("companyId", mssql.VarChar(32), companyId)
        .input("windowStart", mssql.VarChar(32), windowStart)
        .input("windowEnd", mssql.VarChar(32), windowEnd);

    const settlementRows = await bind().query(SETTLEMENTS);
    const ledgerRows = await bind().query(SETTLEMENT_LEDGER_LINES);
    const deductionRows = await bind().query(SETTLEMENT_DEDUCTIONS);

    return {
      settlements: settlementRows.recordset.map(mapSettlement),
      ledgerLines: ledgerRows.recordset.map((r) => ({
        post_key: r.post_key,
        glid: r.glid,
        amount: num(r.amount),
      })),
      deductions: deductionRows.recordset.map(mapDeduction),
      window_start: windowStart,
      window_end: windowEnd,
    };
  });
}

/**
 * The settlement payable accounts on the accrual side.
 *
 * `20500010` is the company-driver payable, `20500020` the owner-operator one; the prefix covers both.
 * Mirrors `SETTLEMENT_PAYABLE_GLID_PREFIX` in packages/shared/src/tmsCost/settlementFact.ts and, like
 * the fuel account, is Silvicom's chart of accounts rather than a McLeod constant — the two copies
 * must move together when a second carrier is onboarded.
 */
const SETTLEMENT_PAYABLE_GLID_PREFIX = "205000";

/**
 * The dry run, and the C3 acceptance test.
 *
 * Reconciliation compares `posted_pay` — NOT `total_pay` — against the accrual payable, because that
 * is what the ledger actually recorded. `total_pay` is reported beside it as the CPM figure, and the
 * gap between them is shown rather than reconciled away: it is real money the payee received after
 * the accrual posted.
 */
export function summarizeSettlements({ settlements, ledgerLines, deductions, window_start, window_end }) {
  const round = (n) => Math.round(n * 100) / 100;

  const payableByKey = new Map();
  for (const line of ledgerLines) {
    if (!String(line.glid).startsWith(SETTLEMENT_PAYABLE_GLID_PREFIX)) continue;
    payableByKey.set(line.post_key, (payableByKey.get(line.post_key) ?? 0) + line.amount);
  }

  let posted = 0, totalPay = 0, unmatched = 0, zeroValue = 0;
  const byPayeeType = {};
  const tractors = new Set();
  const seenKeys = new Set();

  for (const s of settlements) {
    posted += s.posted_pay;
    totalPay += s.total_pay;
    if (s.tractor_unit) tractors.add(s.tractor_unit);

    const bucket = (byPayeeType[s.payee_type] ??= { settlements: 0, total_pay: 0 });
    bucket.settlements++;
    bucket.total_pay = round(bucket.total_pay + s.total_pay);

    if (s.accrual_key && payableByKey.has(s.accrual_key)) seenKeys.add(s.accrual_key);
    else if (s.posted_pay === 0) zeroValue++; // posts no ledger line at all — not a miss
    else unmatched++;
  }

  let ledger = 0;
  for (const amount of payableByKey.values()) ledger += -amount;

  const difference = round(posted - ledger);

  let deductionTotal = 0;
  const deductionsWithTractor = deductions.filter((d) => d.tractor_unit).length;
  for (const d of deductions) deductionTotal += d.amount;

  return {
    window: `${window_start} .. ${window_end}`,
    settlements: {
      rows: settlements.length,
      tractors: tractors.size,
      byPayeeType,
      /** What the payees received. The cost-per-mile figure. */
      totalPay: round(totalPay),
      /** What the ledger recorded at accrual. The figure that reconciles. */
      postedPay: round(posted),
      /** Real money, paid after the accrual posted. Shown, never reconciled away. */
      postAccrualAdjustment: round(totalPay - posted),
      ledgerPayable: round(ledger),
      difference,
      zeroValueRows: zeroValue,
      unmatchedSettlements: unmatched,
      unmatchedLedgerKeys: payableByKey.size - seenKeys.size,
      reconciled: difference === 0 && unmatched === 0 && payableByKey.size === seenKeys.size,
    },
    deductions: {
      rows: deductions.length,
      total: round(deductionTotal),
      withTractor: deductionsWithTractor,
    },
  };
}

/** `npm run settlements -- 2026-06-01 2026-07-01` — reads and reports, sends nothing. */
async function main() {
  const [windowStart, windowEnd] = process.argv.slice(2);
  if (!windowStart || !windowEnd) {
    console.error("usage: npm run settlements -- <windowStart YYYY-MM-DD> <windowEnd YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }

  const result = await fetchSettlements({
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

  const summary = summarizeSettlements(result);
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.settlements.reconciled) {
    console.error(
      `\nFAIL: settlement does not reconcile to the accrual ledger.` +
        ` difference=${summary.settlements.difference}` +
        ` unmatchedSettlements=${summary.settlements.unmatchedSettlements}` +
        ` unmatchedLedgerKeys=${summary.settlements.unmatchedLedgerKeys}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
