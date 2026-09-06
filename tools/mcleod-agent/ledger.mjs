/**
 * General-ledger control totals and the coverage report — C4.
 *
 * The other three sweeps each prove themselves against one module. This one asks the question none of
 * them can ask about itself: how much of the carrier's money does FuelGuard see at all?
 *
 * That framing matters. An integration that reconciles the two domains it covers and stays silent
 * about the eight it does not is more misleading than one that reconciles nothing, because the
 * silence reads as completeness. So this report lists EVERY posting module in the window, marks the
 * ones a sweep stands behind, and prints the uncovered value as a number rather than omitting it.
 *
 * Read-only, same posture as the other sweeps, no `@silvicom/shared` import.
 */

import process from "node:process";
import { GL_CONTROL_TOTALS, OFFICE_SETTLEMENT_LINES, GL_ACCOUNTS } from "./queries.mjs";
import { withPool } from "./roster.mjs";
import { fetchExpenses } from "./expenses.mjs";
import { fetchSettlements } from "./settlements.mjs";

const num = (v) => (v == null ? 0 : Number(v));
const round = (n) => Math.round(n * 100) / 100;

/** Fuel's payable leg — the one account with a line per purchase. Mirrors expenses.mjs. */
const FUEL_PAYABLE_GLID_PREFIX = "20550000";
/** Settlement's accrual payable: 20500010 company driver, 20500020 owner-operator. */
const SETTLEMENT_PAYABLE_GLID_PREFIX = "205000";

/**
 * The GL control recordset, as the wire carries it — one row per (date, module, account) since W1.
 *
 * Extracted from `fetchLedgerControl` so the mapping can be tested without a database, which is the
 * only part of that function that has a decision in it. Two of those decisions matter:
 *
 *  · **The date is passed through as the source's own ISO string**, never re-parsed into a Date and
 *    re-formatted. `CONVERT(..., 23)` already produced `YYYY-MM-DD`; putting it through a JS Date
 *    would drag the agent's local timezone into a figure the ledger states without one, which is how
 *    a day's postings land on the day before in one operator's terminal and not another's.
 *  · **A row with no date is dropped, not defaulted.** The staging function refuses rows outside the
 *    month anyway, and a row that reached here without a `transaction_date` would mean the query
 *    changed under us — better to send fewer rows and have the month's total visibly disagree than
 *    to invent a date that makes it agree.
 */
export function toLedgerTotalRows(recordset) {
  const rows = [];
  for (const r of recordset ?? []) {
    const txnDate = String(r.txn_date ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) continue;
    rows.push({
      txn_date: txnDate,
      post_module: String(r.post_module || "").trim(),
      glid: String(r.glid || "").trim(),
      lines: Number(r.lines),
      net_amount: num(r.net_amount),
      abs_amount: num(r.abs_amount),
    });
  }
  return rows;
}

export async function fetchLedgerControl({
  server, port, database, user, password, companyId,
  windowStart, windowEnd, encrypt, trustCert, serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchLedgerControl requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }

  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const bind = () =>
      pool
        .request()
        .input("companyId", mssql.VarChar(32), companyId)
        .input("windowStart", mssql.VarChar(32), windowStart)
        .input("windowEnd", mssql.VarChar(32), windowEnd);

    const totalsRows = await bind().query(GL_CONTROL_TOTALS);
    const officeRows = await bind().query(OFFICE_SETTLEMENT_LINES);

    return {
      totals: toLedgerTotalRows(totalsRows.recordset),
      officeLines: officeRows.recordset.map((r) => ({
        external_id: String(r.external_id || "").trim(),
        company_id: companyId, // the sweep's own company filter, carried onto the row (D-FIN8)
        glid: r.glid,
        descr: r.descr ?? null,
        payee_id: r.payee_id ?? null,
        transacted_at: r.transacted_at ? `${r.transacted_at}Z` : null,
        amount: num(r.amount),
      })),
      window_start: windowStart,
      window_end: windowEnd,
    };
  });
}

/**
 * Sum the payable leg of a set of ledger lines, sign-flipped out of its credit balance.
 *
 * Used to state a sweep's claim on the SAME basis the reconcilers proved it, rather than re-deriving
 * it from a gross figure that would not match.
 */
function payableTotal(ledgerLines, glidPrefix) {
  let total = 0;
  for (const line of ledgerLines) {
    if (!String(line.glid).startsWith(glidPrefix)) continue;
    total += -line.amount;
  }
  return round(total);
}

/**
 * Build the coverage report.
 *
 * `oneSidedValue` is half the absolute sum: double-entry books every posting twice, so the signed sum
 * of a complete module is zero and reporting it would show $0.00 for a month in which the carrier
 * spent millions.
 *
 * A module's `extracted` figure is NOT expected to equal its one-sided value, and the report says so
 * by reporting drift rather than asserting balance. Fuel is the clear case: the FUEL module moved
 * $1,191,574.09 one-sided in June 2026 while the fuel payable — the leg with one line per purchase —
 * was $1,017,601.81, the gap being the card discount posting through its own accounts. The
 * authorities on whether a domain ties are `reconcileFuelToLedger` and `reconcileSettlementToLedger`,
 * which compare per key. This report is about breadth, not depth.
 *
 * ⚠ `ledgerThroughput` IS NOT "the carrier's money". It is the sum of what passed through every
 * posting module, and the modules are LIFECYCLE VIEWS OF THE SAME DOLLARS — D-MC13 at module scale.
 * Proven in this very dataset: `SET` ($1,390,599) is the settlement accrual and `DRS` ($2,067,340) is
 * the payment of those same settlements; `AP` ($2,770,827) contains the fuel-card invoices that
 * `FUEL` ($1,191,574) already booked, to the cent; `CASH` is the bank side of most of the rest.
 *
 * So the coverage percentage is a BREADTH signal — "which modules has anyone looked at" — and must
 * never be presented as "FuelGuard sees N% of the carrier's costs". Doing so would understate reality
 * badly, because a genuine cost total would count each dollar once. Deriving that total is a finance
 * exercise in choosing one lifecycle stage per dollar, which is exactly the work D-MC13 reserves for
 * the harness with finance's sign-off.
 */
export function summarizeLedgerControl({ totals, officeLines, window_start, window_end }, claims = []) {
  const claimByModule = new Map(claims.map((c) => [c.post_module, c]));

  const byModule = new Map();
  for (const t of totals) {
    const row = byModule.get(t.post_module);
    if (row) {
      row.lines += t.lines;
      row.oneSidedValue = round(row.oneSidedValue + t.abs_amount / 2);
    } else {
      byModule.set(t.post_module, {
        post_module: t.post_module,
        lines: t.lines,
        oneSidedValue: round(t.abs_amount / 2),
        source: null,
        extracted: null,
        drift: null,
      });
    }
  }

  let ledgerThroughput = 0;
  let coveredThroughput = 0;
  for (const row of byModule.values()) {
    ledgerThroughput = round(ledgerThroughput + row.oneSidedValue);
    const claim = claimByModule.get(row.post_module);
    if (!claim) continue;
    row.source = claim.source;
    row.extracted = round(claim.extracted);
    row.drift = round(claim.extracted - row.oneSidedValue);
    coveredThroughput = round(coveredThroughput + row.oneSidedValue);
  }

  let officeTotal = 0;
  for (const l of officeLines) officeTotal += Math.abs(l.amount);

  return {
    window: `${window_start} .. ${window_end}`,
    modules: [...byModule.values()].sort((a, b) => b.oneSidedValue - a.oneSidedValue),
    ledgerThroughput,
    coveredThroughput,
    uncoveredThroughput: round(ledgerThroughput - coveredThroughput),
    throughputCoveragePct:
      ledgerThroughput === 0 ? 0 : round((coveredThroughput / ledgerThroughput) * 100),
    officeSettlements: {
      lines: officeLines.length,
      oneSidedValue: round(officeTotal / 2),
      /** Structurally zero: OFF posts straight to the ledger with no subledger behind it. */
      attributedToTruck: 0,
    },
  };
}

/**
 * `npm run ledger -- 2026-06-01 2026-07-01`
 *
 * Runs the fuel and settlement sweeps alongside the ledger read so the claims are measured rather
 * than asserted. That is slower than reading the GL alone and it is the point: a coverage report
 * built from hard-coded expectations would keep reporting coverage after the sweep behind it broke.
 */
async function main() {
  const [windowStart, windowEnd] = process.argv.slice(2);
  if (!windowStart || !windowEnd) {
    console.error("usage: npm run ledger -- <windowStart YYYY-MM-DD> <windowEnd YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }

  const conn = {
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
  };

  const control = await fetchLedgerControl(conn);
  const expenses = await fetchExpenses(conn);
  const settlements = await fetchSettlements(conn);

  // Each claim is the payable leg the matching reconciler actually proved, taken from the same
  // ledger lines that reconciler used — not a gross figure that would drift for uninteresting reasons.
  const claims = [
    {
      post_module: "FUEL",
      source: "expenses.mjs (fuel)",
      extracted: payableTotal(expenses.ledgerLines, FUEL_PAYABLE_GLID_PREFIX),
    },
    {
      post_module: "SET",
      source: "settlements.mjs",
      extracted: payableTotal(settlements.ledgerLines, SETTLEMENT_PAYABLE_GLID_PREFIX),
    },
  ];

  const summary = summarizeLedgerControl(control, claims);
  console.log(JSON.stringify(summary, null, 2));

  const uncovered = summary.modules.filter((m) => !m.source).map((m) => m.post_module);
  if (uncovered.length) {
    console.error(
      `\nNOTE: ${uncovered.length} module(s) have no subledger extraction behind them ` +
        `($${summary.uncoveredThroughput.toLocaleString("en-US")} of ledger throughput): ${uncovered.join(", ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

/** The chart of accounts, whole — the classification the GL totals are read through. */
export async function fetchGlAccounts({
  server, port, database, user, password, companyId, encrypt, trustCert, serverName,
}) {
  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const rows = await pool
      .request()
      .input("companyId", mssql.VarChar(32), companyId)
      .query(GL_ACCOUNTS);
    return {
      accounts: rows.recordset.map((r) => ({
        glid: String(r.glid || "").trim(),
        descr: r.descr ?? null,
        type_id: r.type_id ?? null,
      })),
    };
  });
}
