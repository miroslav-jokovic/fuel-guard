// Silvicom 360 — the GL control mapping, W1b (D-FLEET9).
//
// `toLedgerTotalRows` is the whole decision inside `fetchLedgerControl`: what the agent puts on the
// wire from what McLeod's recordset says. It runs on the CARRIER'S Node against their database, so
// the parts worth pinning are the ones that would be wrong quietly — a timezone shifting a day, or a
// dateless row being defaulted into a month it does not belong to.
//
// Run:  node --test tools/mcleod-agent/ledger.test.mjs   (also via `pnpm lint:agent-syntax`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLedgerTotalRows, mapGlControl } from "./ledger.mjs";
import { GL_CONTROL_TOTALS } from "./queries.mjs";

test("carries the date, the module, the account and the three measures", () => {
  const rows = toLedgerTotalRows([
    { txn_date: "2026-06-03", post_module: " FUEL ", glid: " 40050000 ", lines: 400, net_amount: 100.25, abs_amount: 100.25 },
  ]);
  assert.deepEqual(rows, [
    { txn_date: "2026-06-03", post_module: "FUEL", glid: "40050000", lines: 400, net_amount: 100.25, abs_amount: 100.25 },
  ]);
});

test("passes the source's own ISO date through rather than re-parsing it", () => {
  // A Date round-trip here is how a posting lands on the previous day for an operator west of UTC.
  const [row] = toLedgerTotalRows([
    { txn_date: "2026-01-01", post_module: "GJ", glid: "40140000", lines: 6, net_amount: 700000, abs_amount: 700000 },
  ]);
  assert.equal(row.txn_date, "2026-01-01");
});

test("accepts a driver that hands back a timestamp, keeping only the day", () => {
  const [row] = toLedgerTotalRows([
    { txn_date: "2026-06-17T00:00:00.000Z", post_module: "SET", glid: "20500010", lines: 1, net_amount: 1, abs_amount: 1 },
  ]);
  assert.equal(row.txn_date, "2026-06-17");
});

test("drops a row with no usable date instead of defaulting one", () => {
  const rows = toLedgerTotalRows([
    { txn_date: null, post_module: "SET", glid: "20500010", lines: 1, net_amount: 1, abs_amount: 1 },
    { txn_date: "not-a-date", post_module: "SET", glid: "20500020", lines: 2, net_amount: 2, abs_amount: 2 },
    { txn_date: "2026-06-30", post_module: "SET", glid: "20500030", lines: 3, net_amount: 3, abs_amount: 3 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].glid, "20500030");
});

test("an empty or absent recordset is an empty payload, never a throw", () => {
  assert.deepEqual(toLedgerTotalRows([]), []);
  assert.deepEqual(toLedgerTotalRows(undefined), []);
});

test("the query groups by the day, not by the raw timestamp", () => {
  // Grouping on the datetime itself would mint a row per posting time rather than per day, and the
  // month's rollup would still add up — which is exactly why this is asserted rather than eyeballed.
  assert.match(GL_CONTROL_TOTALS, /CAST\(g\.transaction_date AS date\)/);
  assert.match(GL_CONTROL_TOTALS, /GROUP BY\s+combined\.transaction_date/);
  assert.match(GL_CONTROL_TOTALS, /CONVERT\(char\(10\), combined\.transaction_date, 23\)\s+AS txn_date/);
});

// McLeod's open accounting period (D-TP5, 0493) — the sandbox row as read 2026-10-19.
const CONTROL_ROW = {
  company_id: "TMS ", fiscal_year: "2026 ", fiscal_period: 8, prior_post: "N",
  period_start: "2026-08-01", period_end: "2026-09-01",
};

test("gl control: carries the open period, trimmed, with prior posting refused only for 'N'", () => {
  assert.deepEqual(mapGlControl(CONTROL_ROW), {
    company_id: "TMS", fiscal_year: "2026", fiscal_period: 8, prior_post_allowed: false,
    period_start: "2026-08-01", period_end: "2026-09-01",
  });
  assert.equal(mapGlControl({ ...CONTROL_ROW, prior_post: "Y" }).prior_post_allowed, true);
  // An unset flag is not a refusal: nothing makes an earlier period final unless McLeod says 'N'.
  assert.equal(mapGlControl({ ...CONTROL_ROW, prior_post: null }).prior_post_allowed, true);
});

test("gl control: sends nothing for a company with no matching fiscal period", () => {
  assert.equal(mapGlControl(undefined), null);
  assert.equal(mapGlControl({ ...CONTROL_ROW, period_start: null }), null);
});
