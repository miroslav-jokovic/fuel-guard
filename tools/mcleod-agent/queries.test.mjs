import test from "node:test";
import assert from "node:assert/strict";
import { rosterQueries, retirementQueries } from "./queries.mjs";

/**
 * The roster predicates, pinned as TEXT.
 *
 * That is a weaker assertion than running them and it is the strongest one available here: this file
 * is the agent's half of the census and the only database that can answer it lives on the carrier's
 * private network, behind a VPN CI has never had. So these tests hold the SHAPE of the predicates
 * against the counts measured by hand on 2026-09-22 (193 active / 459 retiring / 12 in a shop, run
 * through `fetchRoster` against the live LoadMaster before the PR was opened) and fail the moment
 * somebody puts back one of the two clauses that were measured wrong.
 *
 * `lint:agent-syntax` runs this suite — `eslint.config.js` excludes `tools/**` deliberately, since
 * the agent runs on the carrier's Node rather than the app's.
 */

const vehicles = (mode) => rosterQueries(mode).vehicles;

test("the active predicate asks McLeod's own flag and nothing else about being in service", () => {
  const q = vehicles("identity");
  assert.match(q, /t\.service_status = 'A'/);
  // D-FC2: this instance never CLEARS outservice_date, so three trucks running today carry dates from
  // 2021, 2022 and 2023. Reading it here excluded 18 running trucks from the roster.
  assert.ok(!/outservice_date/.test(q), "the active sweep must not read outservice_date");
});

test("a row describing no truck at all is excluded, by rule and not by accident", () => {
  const q = vehicles("identity");
  // 54 of 247 'A' tractors are reserved unit numbers: no purchase date, no model year, never
  // dispatched. Either date is enough, so a reservation rejoins the fleet by itself on delivery.
  assert.match(q, /purchase_date IS NOT NULL OR NULLIF\(LTRIM\(RTRIM\(t\.model_year\)\), ''\) IS NOT NULL/);
  // G5: MCTEST is McLeod's own test row and lacks a VIN. It used to be dropped only as a side effect
  // of also lacking a purchase date, which is not a reason.
  assert.match(q, /NULLIF\(LTRIM\(RTRIM\(t\.serial_number\)\), ''\) IS NOT NULL/);
});

test("membership does not change with the mode — link mode selects the same fleet as identity", () => {
  // The column LISTS differ by mode, deliberately, so that link-only mode reads no PII. The WHERE
  // clause must not: a link sweep that saw a different fleet would link rows an identity sweep then
  // refuses to update, and the disagreement would show up as unmatched rows rather than as an error.
  const where = (q) => q.slice(q.indexOf("WHERE"));
  assert.equal(where(vehicles("link")), where(vehicles("identity")));
});

test("the sub-status is read for display, and the letter itself never leaves this file", () => {
  // D-FC9: `tractor_status` decides how a truck is shown, never whether it is ours. roster.mjs maps
  // 'S' to the neutral in_shop flag; @silvicom/shared turns that into the stored status.
  assert.match(vehicles("identity"), /AS tractor_status/);
  assert.ok(!/tractor_status/.test(vehicles("link")), "link mode reads no sub-status");
});

test("the retirement predicate is the TMS's active flag, negated, and nothing more", () => {
  const q = retirementQueries().vehicles;
  assert.match(q, /t\.service_status <> 'A'/);
  // Of 472 genuinely deactivated tractors, 471 also carry an outservice_date — so the clause that
  // used to be OR'd in here earned one row and cost 18, three of them dispatched this week.
  assert.ok(!/OR t\.outservice_date IS NOT NULL/.test(q), "retirement must not infer from outservice_date");
});

test("the two sweeps cannot both claim a tractor, and neither claims a NULL", () => {
  // `service_status` is NULL on one tractor and one trailer. NULL satisfies neither `= 'A'` nor
  // `<> 'A'`, so those rows fall through both sweeps untouched — retiring a row on the strength of a
  // NULL is the inference this whole design exists to avoid.
  assert.match(vehicles("identity"), /t\.service_status = 'A'/);
  assert.match(retirementQueries().vehicles, /t\.service_status <> 'A'/);
});
