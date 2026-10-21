// Silvicom 360 — the tractor census mapping (TRUCK-DRIVER-PNL-PLAN P2, 0510).
//
// `mapTractorPeriod` is the one decision between McLeod's recordset and the wire. The parts worth
// pinning are the quiet ones: a date that shifts a day, a padded code that never matches, and a row
// with no id becoming a truck.
//
// Run:  node --test tools/mcleod-agent/tractorPeriods.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTractorPeriod } from "./tractorPeriods.mjs";
import { TRACTOR_PERIODS } from "./queries.mjs";

const ROW = {
  tractor_id: "418 ", company_id: "TMS ", in_service_on: "2021-03-02", out_of_service_on: "2026-07-16",
  purchased_on: "2021-02-26", model_year: "2021", service_status: "I", tractor_status: "I",
  owner_id: "SILVMEIL", pay_owner: "D",
};

test("carries every column, trimmed, with McLeod's dates as days", () => {
  assert.deepEqual(mapTractorPeriod(ROW), {
    tractor_id: "418", company_id: "TMS", in_service_on: "2021-03-02", out_of_service_on: "2026-07-16",
    purchased_on: "2021-02-26", model_year: "2021", service_status: "I", tractor_status: "I",
    owner_id: "SILVMEIL", pay_owner: "D",
  });
});

test("keeps only the day of a driver's timestamp, and sends a missing date as null", () => {
  const r = mapTractorPeriod({ ...ROW, in_service_on: "2021-03-02T00:00:00.000Z", out_of_service_on: null, purchased_on: "" });
  assert.equal(r.in_service_on, "2021-03-02");
  assert.equal(r.out_of_service_on, null);
  assert.equal(r.purchased_on, null);
});

test("sends a blank code as null rather than an empty string", () => {
  const r = mapTractorPeriod({ ...ROW, model_year: "  ", pay_owner: " " });
  assert.equal(r.model_year, null);
  assert.equal(r.pay_owner, null);
});

test("drops a row with no tractor id or company instead of inventing one", () => {
  assert.equal(mapTractorPeriod({ ...ROW, tractor_id: " " }), null);
  assert.equal(mapTractorPeriod({ ...ROW, company_id: null }), null);
  assert.equal(mapTractorPeriod(undefined), null);
});

test("the query reads every tractor of the company, not the roster's in-service ones", () => {
  // The census needs the trucks sold before the month being spread, so a service_status filter here
  // would take a sold truck's last months of lease away from it.
  assert.match(TRACTOR_PERIODS, /WHERE t\.company_id = @companyId`?\s*$/);
  assert.doesNotMatch(TRACTOR_PERIODS, /service_status\s*=/);
});
