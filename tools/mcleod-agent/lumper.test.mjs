import test from "node:test";
import assert from "node:assert/strict";
import { LUMPER_ORDERS, LUMPER_CHARGES, LUMPER_PAYMENTS, LUMPER_BILLS } from "./queries.mjs";
import { lumperSince, mapLumperBill, mapLumperPayment, summarizeLumper } from "./lumper.mjs";

/**
 * The lumper feed (LRC1). The statements are pinned as text for the reason `queries.test.mjs` gives:
 * the database that could run them sits behind the carrier's VPN. Each assertion is a measured fact
 * from LUMPER-REVISED-RC-PLAN.md §1 that the statement must keep honouring.
 */

test("every lumper statement is bound to the company and to the sweep's start date", () => {
  for (const sql of [LUMPER_ORDERS, LUMPER_CHARGES, LUMPER_PAYMENTS, LUMPER_BILLS]) {
    assert.match(sql, /company_id = @companyId/);
    assert.match(sql, /@lumperSince/);
    assert.doesNotMatch(sql, /SELECT\s+\*/i);
  }
});

test("payments are read by date and not through the order list, so a line with no order number still arrives", () => {
  assert.doesNotMatch(LUMPER_PAYMENTS, /order_id IN \(/);
  assert.match(LUMPER_PAYMENTS, /dbo\.drs_pending_deduct/);
  assert.match(LUMPER_PAYMENTS, /dbo\.drs_deduct_hist/);
});

test("only the two lumper deduction codes are read from the settlement tables", () => {
  const codes = [...LUMPER_PAYMENTS.matchAll(/deduct_code_id IN \(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(codes, ["'UNL', 'LUM'", "'UNL', 'LUM'"]);
});

test("bills are read for the order, with or without a lumper line, so an invoice that left the lumper out is seen", () => {
  assert.match(LUMPER_BILLS, /LEFT JOIN \(/);
  assert.match(LUMPER_BILLS, /COALESCE\(l\.lumper_lines, 0\)/);
});

test("a voided payment keeps its flag and a pending one says so", () => {
  const base = { external_id: "D1", company_id: "TMS", deduct_code: "UNL", amount: "310.00", transacted_at: "2026-10-07T00:00:00" };
  assert.equal(mapLumperPayment({ ...base, settlement_state: "paid", is_void: 1 }).is_void, true);
  const pending = mapLumperPayment({ ...base, settlement_state: "pending", is_void: 0, order_external_id: null });
  assert.equal(pending.settlement_state, "pending");
  assert.equal(pending.order_external_id, null);
  assert.equal(pending.amount, 310);
  assert.equal(pending.transacted_at, "2026-10-07T00:00:00Z");
});

test("a bill with no lumper line carries zero, not null", () => {
  const bill = mapLumperBill({ external_id: "B1", company_id: "TMS", order_external_id: "O1", invoice_no: 5512, lumper_amount: null, lumper_lines: 0 });
  assert.equal(bill.lumper_amount, 0);
  assert.equal(bill.lumper_lines, 0);
  assert.equal(bill.invoice_no, "5512");
});

test("the default sweep starts 90 days back, as a calendar date", () => {
  assert.equal(lumperSince(Date.UTC(2026, 10, 13, 15)), "2026-08-15");
});

test("the dry-run summary counts a paid lumper that was billed with no lumper line, and a row outside the order list", () => {
  const s = summarizeLumper({
    since: "2026-08-15",
    orders: [{ order_external_id: "O1", dispatcher_user_id: "u", customer_name: "c", consignee_city: "x" }],
    charges: [],
    payments: [
      { order_external_id: "O1", deduct_code: "UNL", amount: 200, is_void: false, settlement_state: "paid", reference_no: "r" },
      { order_external_id: "O9", deduct_code: "LUM", amount: 200, is_void: false, settlement_state: "paid", reference_no: null },
      { order_external_id: null, deduct_code: "LUM", amount: 50, is_void: true, settlement_state: "paid", reference_no: null },
    ],
    bills: [{ order_external_id: "O1", bill_type: "I", lumper_amount: 0, lumper_lines: 0 }],
    timings_ms: {},
  });
  assert.equal(s.coverage.ordersBilledWithNoLumperLine, 1);
  assert.equal(s.coverage.ordersPaidNotCharged, 2);
  assert.equal(s.coverage.rowsOutsideTheOrderList, 1);
  assert.equal(s.payments.voided, 1);
});
