#!/usr/bin/env node
/**
 * The repository's test entry point: `pnpm test` (and `pnpm test:rls` for the matrices alone).
 *
 * WHY THIS EXISTS (audit 2026-08-09, finding 3.1). Two layers of `&&` were hiding results:
 *
 *     "test":     "pnpm -r test && pnpm test:rls"
 *     "test:rls": "node rls.test.mjs && node hazmat_rls.test.mjs && node load-lifecycle... && ..."
 *
 * So ONE unit failure anywhere in thirteen workspaces short-circuited all four behavioural
 * matrices - the only tests in this repo that assert tenant isolation - and one matrix failing
 * short-circuited the other three. Nothing recorded that they had been skipped. The run simply went
 * red for the first failure, somebody fixed that, and the matrices' status for that commit was
 * never established.
 *
 * That matters more here than in most repos, because it has already happened twice for real. The
 * old `//test:rls` comment keys in package.json are the team's own record of it: two matrices sat
 * un-runnable for months behind stale migration filenames while the ledger quoted their pass counts
 * - 42/42 and 20/20 - as fact, and two genuine driver-scope leaks hid behind that.
 *
 * This runner therefore:
 *   1. DISCOVERS the matrices from disk, so a matrix that is added and never wired up cannot exist;
 *   2. runs every suite unconditionally - no `&&`, no short-circuit;
 *   3. fails if any suite failed, or if any matrix produced no RESULT line at all (a matrix that
 *      does not execute is a failure, never a pass);
 *   4. writes the counts to the GitHub step summary, so nobody hand-copies a number into prose
 *      again - the README's "27/27 RLS matrix" was three phases and 100+ assertions stale when the
 *      audit found it.
 */
import { spawn } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MATRIX_DIR = join(ROOT, "supabase", "tests");
const matricesOnly = process.argv.includes("--matrices-only");

/** Every behavioural matrix on disk. Discovered, never hand-listed - that is the whole point. */
function discoverMatrices() {
  let names;
  try {
    names = readdirSync(MATRIX_DIR)
      .filter((f) => f.endsWith(".test.mjs"))
      .sort();
  } catch {
    console.error(
      `FAIL: ${relative(ROOT, MATRIX_DIR)} is missing. The behavioural matrices cannot run.`,
    );
    process.exit(1);
  }
  if (names.length === 0) {
    console.error(`FAIL: no *.test.mjs matrices found in ${relative(ROOT, MATRIX_DIR)}.`);
    process.exit(1);
  }
  return names.map((n) => ({ name: n.replace(/\.test\.mjs$/, ""), path: join(MATRIX_DIR, n) }));
}

function run(label, cmd, args) {
  return new Promise((resolve) => {
    console.log(`\n---- ${label} ${"-".repeat(Math.max(0, 60 - label.length))}\n`);
    const child = spawn(cmd, args, { cwd: ROOT, shell: process.platform === "win32" });
    let out = "";
    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on("data", (chunk) => {
        out += chunk.toString();
        sink.write(chunk);
      });
    }
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (err) => {
      console.error(`${label}: failed to start - ${err.message}`);
      resolve({ code: 1, out });
    });
  });
}

const rows = [];
let anyFailed = false;

// ---- unit suites ----------------------------------------------------------
if (!matricesOnly) {
  const unit = await run("Unit suites (pnpm -r test)", "pnpm", ["-r", "test"]);
  if (unit.code !== 0) anyFailed = true;
  rows.push({
    suite: "Unit (`pnpm -r test`)",
    result: unit.code === 0 ? "PASS" : `**FAIL** (exit ${unit.code})`,
  });
}

// ---- behavioural matrices, every one, regardless of anything above ---------
for (const m of discoverMatrices()) {
  const r = await run(`Matrix: ${m.name}`, "node", [m.path]);
  const hit = r.out.match(/RESULT:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);

  if (!hit) {
    // The failure mode this whole file exists to prevent: a matrix that produced no verdict.
    anyFailed = true;
    rows.push({
      suite: `Matrix \`${m.name}\``,
      result: "**NO RESULT REPORTED** - did not execute",
    });
    console.error(
      `\nFAIL: ${m.name} produced no "RESULT: N passed, M failed" line. ` +
        "A matrix that does not report is not a matrix that passed.",
    );
    continue;
  }

  const [, passed, failed] = hit;
  if (r.code !== 0 || Number(failed) > 0) anyFailed = true;
  rows.push({
    suite: `Matrix \`${m.name}\``,
    result: `${passed} passed, ${failed} failed${r.code === 0 ? "" : ` (exit ${r.code})`}`,
  });
}

// ---- report ---------------------------------------------------------------
const summaryLines = [
  "### Test results",
  "",
  "| Suite | Result |",
  "| --- | --- |",
  ...rows.map((r) => `| ${r.suite} | ${r.result} |`),
  "",
  "_Counts are emitted by the run. Do not copy them into prose - link to the run instead._",
  "",
];

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n") + "\n");
  } catch (err) {
    console.error(`(could not write step summary: ${err.message})`);
  }
}

console.log("\n" + "=".repeat(72));
for (const r of rows) console.log(`  ${r.suite.padEnd(34)} ${r.result.replace(/\*\*/g, "")}`);
console.log("=".repeat(72));
console.log(anyFailed ? "\nFAIL - see the suites marked above.\n" : "\nAll suites passed.\n");

process.exit(anyFailed ? 1 : 0);
