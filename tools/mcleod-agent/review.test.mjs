/**
 * The carrier reviews `review/SILVICOM-READ-ROUTINE.sql` and approves what it says we run. If a
 * query in `queries.mjs` then changes and that file does not, we are running something they never
 * saw — which is the one failure this whole review step exists to prevent.
 *
 * Since CA5 (2026-09-24) the file is BUILT from the code by `review/build-routine.mjs`, so this pins
 * three things: the committed file is exactly that build; every statement the agent can run is in
 * it; and the settings it shows are the ones `connection.mjs` sends. When it fails, the fix is to
 * rebuild the file AND tell the carrier what changed; it is never to relax the assertion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Q from "./queries.mjs";
import { buildRoutine, routineStatements, ROUTINE_PATH } from "./review/build-routine.mjs";
import { SESSION_SETTINGS, STATEMENT_HINT, APP_NAME } from "./connection.mjs";

const routine = readFileSync(ROUTINE_PATH, "utf8");

test("the committed routine is exactly what the code builds", () => {
  assert.ok(
    routine === buildRoutine(),
    "review/SILVICOM-READ-ROUTINE.sql is stale. Run `node review/build-routine.mjs`, and tell the carrier what changed.",
  );
});

test("every statement the agent can run is in the routine the carrier reviews", () => {
  const inFile = new Set(routineStatements().map((s) => s.sql.trim()));
  const exported = Object.entries(Q).filter(([, v]) => typeof v === "string" && /\bSELECT\b/.test(v));
  const expected = [
    ...exported,
    ...Object.entries(Q.rosterQueries("identity")).map(([k, v]) => [`roster.${k}`, v]),
    ...Object.entries(Q.retirementQueries()).map(([k, v]) => [`retire.${k}`, v]),
  ];
  for (const [name, sql] of expected) {
    assert.ok(inFile.has(sql.trim()), `${name} can run against LME but is not in the review routine`);
  }
});

test("each statement is followed by the connector's own hint, as it goes on the wire", () => {
  for (const { title, sql } of routineStatements()) {
    assert.ok(routine.includes(`${sql.trim()}\n${STATEMENT_HINT};`), `${title} is not shown with ${STATEMENT_HINT}`);
  }
});

test("the settings the routine shows are the ones the connector sends, and it promises no dirty read", () => {
  for (const s of SESSION_SETTINGS) assert.ok(routine.includes(s), `the routine does not show ${s}`);
  assert.ok(!/WITH\s*\(\s*NOLOCK\s*\)/i.test(routine), "a NOLOCK hint reached the routine we send out");
});

test("the routine tells the DBA the program_name our connection actually uses", () => {
  assert.ok(routine.includes(`"${APP_NAME}"`), `the routine does not name the program_name "${APP_NAME}"`);
});
