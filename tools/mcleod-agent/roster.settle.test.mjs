import { test } from "node:test";
import assert from "node:assert/strict";
import { diffAgainstState, forgetUnsettled, upgradeRosterState, ROSTER_STATE_VERSION } from "./roster.mjs";

// D-MR16 (2026-10-14): a driver McLeod hired before our row existed was sent once, came back
// unmatched, and was never sent again — 11 of 11 new hires sat unlinked.

test("a row the API could not settle is sent again on the next sweep", () => {
  const row = { external_id: "AACKISS", first_name: "AARON" };
  const first = diffAgainstState("drivers", [row], {});
  assert.equal(first.changed.length, 1);
  forgetUnsettled(first.nextState, { retry: ["AACKISS"], unmatched: [] });
  const second = diffAgainstState("drivers", [row], { drivers: first.nextState });
  assert.deepEqual(second.changed.map((r) => r.external_id), ["AACKISS"]);
});

test("a settled row is not sent again until it changes", () => {
  const row = { external_id: "TSMITH", first_name: "TOM" };
  const first = diffAgainstState("drivers", [row], {});
  forgetUnsettled(first.nextState, { retry: [], unmatched: [] });
  assert.equal(diffAgainstState("drivers", [row], { drivers: first.nextState }).changed.length, 0);
});

test("an API older than `retry` still gets its unmatched rows again", () => {
  const state = { AACKISS: "h1", TSMITH: "h2" };
  forgetUnsettled(state, { unmatched: ["AACKISS"] });
  assert.deepEqual(Object.keys(state), ["TSMITH"]);
});

test("a state written before the fix is dropped once, so the stranded drivers are sent", () => {
  assert.deepEqual(upgradeRosterState({ drivers: { YALAM: "h" } }), { version: ROSTER_STATE_VERSION });
  assert.deepEqual(upgradeRosterState({}), { version: ROSTER_STATE_VERSION });
  const current = { version: ROSTER_STATE_VERSION, drivers: { YALAM: "h" } };
  assert.equal(upgradeRosterState(current), current);
});
