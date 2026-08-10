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
const VICTIM = "apps/api/src/lib/efsSoap.ts"; // a pinned waiver
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
