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
import { DISPATCH_LOADS, DISPATCH_LOAD_STOPS, DISPATCH_DISPATCHERS } from "./queries.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const routine = readFileSync(join(here, "review", "SILVICOM-READ-ROUTINE.sql"), "utf8");

for (const [name, sql] of [
  ["DISPATCH_LOADS", DISPATCH_LOADS],
  ["DISPATCH_LOAD_STOPS", DISPATCH_LOAD_STOPS],
  ["DISPATCH_DISPATCHERS", DISPATCH_DISPATCHERS],
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
