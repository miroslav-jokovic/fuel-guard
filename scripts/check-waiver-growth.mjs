#!/usr/bin/env node
/**
 * Proves the file-size gate's no-growth guard is live (Stage 2.6 harness support).
 *
 * scripts/mutation-check.mjs neuters that guard and runs this. The assertion has to live here rather
 * than in the gate: a disabled guard makes the gate go quietly green, and only something that
 * deliberately grows a waived file can tell the difference.
 *
 * CRASH SAFETY. This edits a real source file, so a `finally` block is not enough — the first version
 * of this probe was killed by a command timeout mid-run and left two stray lines in efsSoap.ts, which
 * then failed the very gate it was testing. It now (a) keeps its backup on disk outside the repo,
 * (b) restores on SIGINT/SIGTERM/uncaught as well as normally, and (c) restores any backup left by a
 * previous killed run BEFORE doing anything else. A test rig that can damage the tree it tests is not
 * a test rig.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * The victim is DISCOVERED from check-file-size.mjs's GRANDFATHERED map, never hand-written.
 *
 * It was hand-written twice and went stale twice, in exactly the same way. It named efsSoap.ts,
 * which left the map on 2026-08-10 when the card-control work split it; the comment left behind said
 * "keep this in sync when the waiver list changes", and then samsara.ts left the map too and nobody
 * did. Growing an UNWAIVED file does not trip the no-growth guard — samsara.ts is 451 lines against a
 * 500-line budget, so the gate passes and this probe reads that as "the guard is dead".
 *
 * That is not a harmless false alarm. This probe is the `detect` command for the
 * `waiver-growth-unchecked` mutation, and mutation-check.mjs runs `detect` ONLY against the mutated
 * source — a detect that always exits non-zero therefore reports CAUGHT whether the guard works or
 * not. The mutation has been vacuous, and the file-size no-growth guard unverified, for as long as
 * the name has been wrong.
 *
 * A second "keep it in sync" comment would be the third attempt at the same failed idea. So the name
 * comes from the map itself, the way run-tests.mjs discovers the matrices: a waiver list that changes
 * cannot leave this probe pointing at nothing.
 */
function discoverVictim() {
  const gate = readFileSync(join(ROOT, "scripts/check-file-size.mjs"), "utf8");
  const start = gate.indexOf("const GRANDFATHERED");
  const block = gate.slice(start, gate.indexOf("};", start));
  // Entries only — a commented-out line is a file that LEFT the list, which is the whole hazard.
  const pinned = [...block.matchAll(/^\s*"([^"]+)":\s*(\d+)\s*,/gm)].map((m) => m[1]);
  if (pinned.length === 0) {
    console.error(
      "FAIL: check-file-size.mjs has no pinned waivers left, so the no-growth guard cannot be probed.\n" +
        "That is the intended end state of that list — delete the `waiver-growth-unchecked` mutation\n" +
        "and this probe together, rather than leaving a check that silently tests nothing.",
    );
    process.exit(1);
  }
  return pinned[0];
}

const VICTIM = discoverVictim();
console.log(`probing the no-growth guard against the pinned waiver ${VICTIM}`);
const target = join(ROOT, VICTIM);
const backup = join(tmpdir(), "fuelguard-waiver-growth-probe.bak");

// A backup left behind means a previous run was killed mid-probe. Put the file back first.
if (existsSync(backup)) {
  writeFileSync(target, readFileSync(backup, "utf8"));
  rmSync(backup, { force: true });
  console.warn(`(restored ${VICTIM} from a previous interrupted run)`);
}

const original = readFileSync(target, "utf8");
writeFileSync(backup, original);

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  try {
    writeFileSync(target, original);
    rmSync(backup, { force: true });
  } catch (err) {
    console.error(`FATAL: could not restore ${VICTIM}: ${String(err)}\nRestore it from ${backup}.`);
  }
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("uncaughtException", (err) => { restore(); console.error(err); process.exit(1); });
process.on("exit", restore);

writeFileSync(target, original + "\n// waiver-growth probe\n");
const run = spawnSync("node", ["scripts/check-file-size.mjs"], { cwd: ROOT, encoding: "utf8" });
restore();

if (run.status === 0) {
  console.error(`FAIL: grew a pinned waiver (${VICTIM}) and check-file-size.mjs still passed.`);
  process.exit(1);
}
console.log("OK — growing a pinned waiver fails the file-size gate.");
