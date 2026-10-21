import test from "node:test";
import assert from "node:assert/strict";
import { SETTLEMENTS } from "./queries.mjs";
import { mapSettlement } from "./settlements.mjs";

/**
 * The settlement sweep carries `void_date` (0501, TRUCK-DRIVER-PNL-PLAN §1.3 D3).
 *
 * GL module SETV reverses a voided, transferred settlement on the date it was VOIDED, which can be
 * months after its accrual: `is_void` alone says a row was reversed, not in which month. Pinned as text
 * for the reason `queries.test.mjs` gives: the database that could run it sits behind the carrier's VPN.
 */

test("the settlement query reads McLeod's void date in the same ISO shape as its other dates", () => {
  assert.match(SETTLEMENTS, /CONVERT\(varchar\(19\), s\.void_date, 126\)\s+AS void_date/);
});

test("a voided row's void date crosses the wire as wall time labelled UTC, like every McLeod stamp", () => {
  const row = mapSettlement({ external_id: "S-1", company_id: "TMS", payee_type: "C", is_void: 1, void_date: "2026-07-15T09:30:00" });
  assert.equal(row.is_void, true);
  assert.equal(row.void_date, "2026-07-15T09:30:00Z");
});

test("a live row sends a null void date, never an empty string", () => {
  assert.equal(mapSettlement({ external_id: "S-2", company_id: "TMS", payee_type: "C", is_void: 0, void_date: null }).void_date, null);
});
