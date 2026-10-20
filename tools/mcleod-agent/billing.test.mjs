import test from "node:test";
import assert from "node:assert/strict";
import { BILLING_HISTORY } from "./queries.mjs";
import { mapBilling } from "./billing.mjs";

/**
 * The billing sweep carries `bill_type` (0496, TRUCK-DRIVER-PNL-PLAN §1.3 D2).
 *
 * McLeod stages a credit memo as its own bill with a POSITIVE `total_charges`; `bill_type = 'C'` is the
 * only thing that says it takes money back. Before this column was swept, 55 July credits (−$213,124.32
 * in the ledger) reached every per-truck, per-dispatcher and weekly reader as revenue. Pinned as text
 * for the reason `queries.test.mjs` gives: the database that could run it sits behind the carrier's VPN.
 */

test("the billing query reads McLeod's bill type, trimmed, with blank as null", () => {
  assert.match(BILLING_HISTORY, /NULLIF\(LTRIM\(RTRIM\(b\.bill_type\)\), ''\)\s+AS bill_type/);
});

test("a credit memo crosses the wire verbatim and positive — the API's readers sign it, not the agent", () => {
  const row = mapBilling({ external_id: "B-CR", company_id: "TMS", total_charges: 213124.32, other_charge: 0, bill_type: "C" });
  assert.equal(row.bill_type, "C");
  assert.equal(row.total_charges, 213124.32);
});

test("a row without a bill type sends null, never a guessed invoice", () => {
  assert.equal(mapBilling({ external_id: "B-1", company_id: "TMS", total_charges: 1 }).bill_type, null);
});
