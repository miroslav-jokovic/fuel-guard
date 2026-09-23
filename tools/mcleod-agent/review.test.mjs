/**
 * The carrier reviews `review/SILVICOM-READ-ROUTINE.sql` and approves what it says we run. If a
 * query in `queries.mjs` then changes and that file does not, we are running something they never
 * saw — which is the one failure this whole review step exists to prevent.
 *
 * So this pins the file to the code, character for character. When it fails, the fix is to
 * regenerate the file AND tell them what changed; it is never to relax the assertion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DISPATCH_LOADS,
  DISPATCH_LOAD_STOPS,
  DISPATCH_DISPATCHERS,
  rosterQueries,
  retirementQueries,
} from "./queries.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const routine = readFileSync(join(here, "review", "SILVICOM-READ-ROUTINE.sql"), "utf8");

// The roster statements are pinned in the mode the launchd sweep runs (ROSTER_MODE=identity, in
// launchd/com.silvicom.mcleod-roster.plist.template) — the widest column list, so the carrier has
// reviewed every column the roster can read. `link` mode selects a subset of the same text.
const roster = rosterQueries("identity");
const retirement = retirementQueries();

for (const [name, sql] of [
  ["DISPATCH_LOADS", DISPATCH_LOADS],
  ["DISPATCH_LOAD_STOPS", DISPATCH_LOAD_STOPS],
  ["DISPATCH_DISPATCHERS", DISPATCH_DISPATCHERS],
  ["rosterQueries(identity).drivers", roster.drivers],
  ["rosterQueries(identity).vehicles", roster.vehicles],
  ["rosterQueries(identity).trailers", roster.trailers],
  ["retirementQueries().drivers", retirement.drivers],
  ["retirementQueries().vehicles", retirement.vehicles],
  ["retirementQueries().trailers", retirement.trailers],
]) {
  test(`the review routine still contains ${name} exactly as the agent runs it`, () => {
    assert.ok(
      routine.includes(sql.trim()),
      `${name} has changed in queries.mjs but review/SILVICOM-READ-ROUTINE.sql was not updated. ` +
        `The carrier approved the old text. Regenerate the file and tell them what changed.`,
    );
  });
}

test("the review routine promises no write and no dirty read", () => {
  // These are commitments made in writing to the carrier; assert the file still makes them.
  assert.match(routine, /SET LOCK_TIMEOUT 5000;/);
  assert.match(routine, /SET DEADLOCK_PRIORITY LOW;/);
  assert.match(routine, /SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  // NOLOCK must appear only where we promise never to use it, never as a hint on a table.
  assert.ok(!/WITH\s*\(\s*NOLOCK\s*\)/i.test(routine), "a NOLOCK hint reached the routine we send out");
});

test("the review routine tells the DBA the program_name our connection actually uses", () => {
  // The letter tells them to find us in sys.dm_exec_sessions by this string; roster.mjs sets it.
  const pool = readFileSync(join(here, "roster.mjs"), "utf8");
  const appName = pool.match(/appName: "([^"]+)"/)?.[1];
  assert.ok(appName, "roster.mjs no longer sets an appName");
  assert.ok(routine.includes(`"${appName}"`), `the routine does not name the program_name "${appName}"`);
});
