/**
 * Lumper feed — LRC1 (docs/plans/dispatch-loads/LUMPER-REVISED-RC-PLAN.md).
 *
 * Reads the four facts a lumper case is built from: the orders in scope, the `LUM` charges on them,
 * what payroll paid, and what was invoiced. Read-only, same posture as `settlements.mjs`, and no
 * `@silvicom/shared` import: this ships to the Board VM with `mssql` as its only dependency.
 *
 * This file reads and reports. It does not decide what state a case is in; that rule lives in
 * `packages/shared` (LRC2) so the page, the reminder and the tests read one definition. The summary
 * below is the dry run's coverage check, counts and dollars only, and prints no row.
 */

import process from "node:process";
import { LUMPER_ORDERS, LUMPER_CHARGES, LUMPER_PAYMENTS, LUMPER_BILLS } from "./queries.mjs";
import { withPool } from "./connection.mjs";

/** How far back a sweep reads when no date is given. A parameter, not a setting on the VM. */
export const LUMPER_WINDOW_DAYS = 90;

const num = (v) => (v == null ? 0 : Number(v));
const stamp = (v) => (v ? `${v}Z` : null); // McLeod wall time, labelled UTC like every other feed

export function mapLumperOrder(row) {
  return {
    order_external_id: row.order_external_id,
    company_id: row.company_id,
    order_status: row.order_status ?? null,
    ordered_at: stamp(row.ordered_at),
    bill_date: stamp(row.bill_date),
    customer_id: row.customer_id ?? null,
    customer_name: row.customer_name ?? null,
    dispatcher_user_id: row.dispatcher_user_id ?? null,
    dispatcher_name: row.dispatcher_name ?? null,
    movement_external_id: row.movement_external_id ?? null,
    consignee_name: row.consignee_name ?? null,
    consignee_city: row.consignee_city ?? null,
    consignee_state: row.consignee_state ?? null,
    consignee_arrived_at: stamp(row.consignee_arrived_at),
    consignee_departed_at: stamp(row.consignee_departed_at),
  };
}

export function mapLumperCharge(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    order_external_id: row.order_external_id,
    charge_code: row.charge_code,
    descr: row.descr ?? null,
    amount: num(row.amount),
    sequence: row.sequence == null ? null : Number(row.sequence),
  };
}

export function mapLumperPayment(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    settlement_state: row.settlement_state === "pending" ? "pending" : "paid",
    order_external_id: row.order_external_id ?? null,
    movement_external_id: row.movement_external_id ?? null,
    deduct_code: row.deduct_code,
    deduction_type: row.deduction_type ?? null,
    amount: num(row.amount),
    transacted_at: stamp(row.transacted_at),
    reference_no: row.reference_no ?? null,
    driver_external_id: row.driver_external_id ?? null,
    payee_id: row.payee_id ?? null,
    tractor_unit: row.tractor_unit ?? null,
    is_void: Number(row.is_void) === 1,
  };
}

export function mapLumperBill(row) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    order_external_id: row.order_external_id,
    invoice_no: row.invoice_no == null ? null : String(row.invoice_no).trim() || null,
    bill_date: stamp(row.bill_date),
    bill_type: row.bill_type ?? null,
    canceled: row.canceled ?? null,
    rebilled: row.rebilled ?? null,
    total_charges: num(row.total_charges),
    lumper_amount: num(row.lumper_amount),
    lumper_lines: Number(row.lumper_lines ?? 0),
  };
}

/** `YYYY-MM-DD`, `days` before `now`. The sweep's default start. */
export function lumperSince(now = Date.now(), days = LUMPER_WINDOW_DAYS) {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/** Read one sweep: every order in scope since `since`, with its charges, payments and bills. */
export async function fetchLumper({ server, port, database, user, password, companyId, since, encrypt, trustCert, serverName }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since ?? ""))) {
    throw new Error("fetchLumper requires an explicit `since` date (YYYY-MM-DD).");
  }
  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const bind = () =>
      pool.request().input("companyId", mssql.VarChar(32), companyId).input("lumperSince", mssql.VarChar(32), since);
    const timed = async (sql) => {
      const t = Date.now();
      const r = await bind().query(sql);
      return { rows: r.recordset, ms: Date.now() - t };
    };
    // One at a time, in this order: the server never sees two of our statements at once.
    const orders = await timed(LUMPER_ORDERS);
    const charges = await timed(LUMPER_CHARGES);
    const payments = await timed(LUMPER_PAYMENTS);
    const bills = await timed(LUMPER_BILLS);
    return {
      since,
      orders: orders.rows.map(mapLumperOrder),
      charges: charges.rows.map(mapLumperCharge),
      payments: payments.rows.map(mapLumperPayment),
      bills: bills.rows.map(mapLumperBill),
      timings_ms: { orders: orders.ms, charges: charges.ms, payments: payments.ms, bills: bills.ms },
    };
  });
}

/**
 * The dry run's report: counts and dollars, never a row.
 *
 * `ordersPaidNotCharged` and `ordersBilledWithNoLumperLine` are coverage figures for comparing a sweep
 * with the plan's measurements, NOT case states. They ignore credit memos and partial amounts, which
 * the case rule handles.
 */
export function summarizeLumper({ since, orders, charges, payments, bills, timings_ms }) {
  const round = (n) => Math.round(n * 100) / 100;
  const sum = (rows, f) => round(rows.reduce((t, r) => t + f(r), 0));
  const live = payments.filter((p) => !p.is_void);
  const moneyCodes = live.filter((p) => p.deduct_code === "UNL");
  const reimbursements = live.filter((p) => p.deduct_code === "LUM");
  const charged = new Set(charges.map((c) => c.order_external_id));
  const paid = new Set(live.map((p) => p.order_external_id).filter(Boolean));
  const billed = new Set(bills.map((b) => b.order_external_id));
  const billedWithLumper = new Set(bills.filter((b) => b.lumper_lines > 0).map((b) => b.order_external_id));
  const known = new Set(orders.map((o) => o.order_external_id));
  return {
    since,
    orders: {
      rows: orders.length,
      withDispatcher: orders.filter((o) => o.dispatcher_user_id).length,
      withCustomerName: orders.filter((o) => o.customer_name).length,
      withConsignee: orders.filter((o) => o.consignee_city).length,
    },
    charges: { rows: charges.length, orders: charged.size, total: sum(charges, (c) => c.amount) },
    payments: {
      rows: payments.length,
      voided: payments.length - live.length,
      pending: live.filter((p) => p.settlement_state === "pending").length,
      moneyCodes: { rows: moneyCodes.length, total: sum(moneyCodes, (p) => p.amount), withReference: moneyCodes.filter((p) => p.reference_no).length },
      reimbursements: { rows: reimbursements.length, total: sum(reimbursements, (p) => p.amount) },
      withoutOrder: live.filter((p) => !p.order_external_id).length,
    },
    bills: {
      rows: bills.length,
      orders: billed.size,
      creditMemos: bills.filter((b) => b.bill_type === "C").length,
      lumperTotal: sum(bills.filter((b) => b.bill_type !== "C"), (b) => b.lumper_amount),
    },
    coverage: {
      ordersPaidNotCharged: [...paid].filter((id) => !charged.has(id)).length,
      ordersChargedNotPaid: [...charged].filter((id) => !paid.has(id)).length,
      ordersBilledWithNoLumperLine: [...billed].filter((id) => paid.has(id) && !billedWithLumper.has(id)).length,
      // Must be 0: every charge, bill and order-carrying payment belongs to an order the header read returned.
      rowsOutsideTheOrderList:
        charges.filter((c) => !known.has(c.order_external_id)).length +
        bills.filter((b) => !known.has(b.order_external_id)).length +
        payments.filter((p) => p.order_external_id && !known.has(p.order_external_id)).length,
    },
    timings_ms,
  };
}

/**
 * The feed's switch. ON only when the settings say exactly `LUMPER_FEED=on`; unset, empty, `off` or a
 * typo all mean off. The opposite default from FINANCE_FEED, because the Board VM's settings file has
 * no such line: installing this code there must start nothing (`serviceJobs`, schedule.mjs).
 */
export function lumperFeedOn(value) {
  return String(value ?? "").trim().toLowerCase() === "on";
}

/** One sweep as `POST /api/tms/lumper` takes it (lumperContract.ts): the four lists, whole, in one request. */
export function lumperPayload({ since, orders, charges, payments, bills }, companyId) {
  return { company_id: companyId, since, orders, charges, payments, bills };
}

/**
 * Reasons not to send a sweep, in words for the log. 360 REPLACES what it holds inside the sweep's
 * window, so a sweep that is wrong must not arrive.
 *  · No orders at all. 90 days held 87 orders when measured; an empty read means a wrong company id or
 *    a statement that returned nothing, and sending it would take every charge and payment off every
 *    open case until the next good read.
 *  · A charge or bill of an order the order read did not return: the four statements disagree with
 *    each other, which the dry run also reports as a failure.
 *  · A row of another company: the statements bind the company, so this is a fault, not data.
 */
export function lumperSweepProblems({ orders, charges, payments, bills }, companyId) {
  const problems = [];
  if (orders.length === 0) problems.push("the read returned no orders with a lumper; nothing is sent, so 360 keeps what it has");
  const known = new Set(orders.map((o) => o.order_external_id));
  const orphans = charges.filter((c) => !known.has(c.order_external_id)).length + bills.filter((b) => !known.has(b.order_external_id)).length;
  if (orphans) problems.push(`${orphans} charge or bill row(s) name an order the order read did not return`);
  const foreign = [...orders, ...charges, ...payments, ...bills].filter((r) => r.company_id !== companyId).length;
  if (foreign) problems.push(`${foreign} row(s) belong to a company other than ${companyId}`);
  return problems;
}

/** `node --env-file=.env lumper.mjs [since YYYY-MM-DD]` — reads and reports, sends nothing. */
async function main() {
  const since = process.argv[2] ?? lumperSince();
  const result = await fetchLumper({
    server: process.env.MCLEOD_SQL_SERVER,
    port: Number(process.env.MCLEOD_SQL_PORT || 1433),
    database: process.env.MCLEOD_SQL_DATABASE,
    user: process.env.MCLEOD_SQL_USER,
    password: process.env.MCLEOD_SQL_PASSWORD,
    companyId: process.env.MCLEOD_COMPANY_ID,
    encrypt: process.env.MCLEOD_SQL_ENCRYPT !== "false",
    trustCert: process.env.MCLEOD_SQL_TRUST_CERT !== "false",
    serverName: process.env.MCLEOD_SQL_SERVERNAME || undefined,
    since,
  });
  const summary = summarizeLumper(result);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.coverage.rowsOutsideTheOrderList !== 0) {
    console.error(`\nFAIL: ${summary.coverage.rowsOutsideTheOrderList} rows name an order the order read did not return.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
