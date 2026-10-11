import test from "node:test";
import assert from "node:assert/strict";
import { FUEL_TAX_RECEIPTS } from "./queries.mjs";
import { mapReceipt, receiptWindow } from "./fuelTaxReceipts.mjs";

/**
 * Hand-keyed IFTA fuel receipts (IFTA-PRECISION-PLAN IP6). The SQL is pinned as text — the only
 * database that can run it is behind the carrier's VPN — and the mapping and window are pinned as code.
 */

test("only source F is read: O is the EFS card import Silvicom 360 already has, X is miles", () => {
  assert.match(FUEL_TAX_RECEIPTS, /f\.source = 'F'/);
  assert.ok(!/source\s*(=|IN)\s*\(?'O'/.test(FUEL_TAX_RECEIPTS), "the card import must never be read here");
  assert.match(FUEL_TAX_RECEIPTS, /f\.company_id = @companyId/);
});

test("the window is two whole years ending the day after the sweep — the re-read is the backfill", () => {
  assert.deepEqual(receiptWindow("2026-10-05"), { windowStart: "2024-10-06", windowEnd: "2026-10-06" });
});

test("a receipt crosses the wire as the fact, trimmed and upper-cased", () => {
  const r = mapReceipt({
    external_id: "zz1jss345nt04m8NQIG5TK  ", company_id: "TMS ", tractor_unit: "512 ", jurisdiction: "ut",
    receipt_date: "2026-06-15", gallons: "109.084", processed_at: "2026-07-06T11:10:00", is_void: 0,
  });
  assert.deepEqual(r, {
    external_id: "zz1jss345nt04m8NQIG5TK", company_id: "TMS", tractor_unit: "512", jurisdiction: "UT",
    receipt_date: "2026-06-15", gallons: 109.084, processed_at: "2026-07-06T11:10:00Z", is_void: false,
  });
});

test("a voided receipt says so, so the stored row flips to void on the next sweep", () => {
  assert.equal(mapReceipt({ external_id: "a", tractor_unit: "1", jurisdiction: "TX", receipt_date: "2026-01-01", is_void: 1 }).is_void, true);
});

test("a receipt with no tractor or no state is dropped, not sent — the wire contract requires both", () => {
  assert.equal(mapReceipt({ external_id: "a", tractor_unit: null, jurisdiction: "TX", receipt_date: "2026-01-01" }), null);
  assert.equal(mapReceipt({ external_id: "a", tractor_unit: "1", jurisdiction: null, receipt_date: "2026-01-01" }), null);
});
