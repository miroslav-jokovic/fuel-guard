#!/usr/bin/env node
/**
 * Fitness function — `scripts/efs.mjs` puts ONLY a JSON result on stdout.
 *
 * ── The incident, 2026-08-16 ────────────────────────────────────────────────────────────────────
 * `docs/25` tells an operator to run `node scripts/efs.mjs inventory > docs/efs/…json`. The token
 * prompt was written with `process.stdout.write`, so the redirect swallowed it: the terminal showed
 * nothing, the process sat waiting on stdin for a credential it appeared never to have asked for,
 * and it read as a hung command for five minutes. The `Copy an admin token…` instructions went the
 * same way.
 *
 * Both halves of that are silent failures. A prompt on stdout makes a redirected command hang; a
 * narrative line on stdout corrupts the JSON file the command exists to produce. Neither shows up in
 * a test that calls the CLI without a redirect, which is every test that existed.
 *
 * ── What this asserts, and why it is not a source scan ──────────────────────────────────────────
 * It RUNS the CLI on paths that do not touch the network and asserts stdout is empty on each. A grep
 * for `console.log` would be the structural version of this check, and would have passed happily
 * while `process.stdout.write(prompt)` — a different spelling — did the damage. Run it, do not read
 * it.
 *
 * Run: node scripts/check-cli-streams.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "efs.mjs");

/**
 * Every case here must exit BEFORE any network call or any prompt, so this gate needs no credentials
 * and no vendor. That is the whole reason they are argument-validation paths.
 */
const CASES = [
  { name: "unknown command prints usage", args: ["bogus"] },
  { name: "no command at all prints usage", args: [] },
  { name: "a card number passed where a uuid belongs is refused", args: ["inventory", "--cards", "70830000000000001"] },
  { name: "--token-from-env without FG_TOKEN is refused", args: ["scan", "--token-from-env"] },
  // Added after --expect-org shipped: its argument validation must also stay off stdout, and must
  // happen before the token prompt rather than after a round trip.
  { name: "--expect-org with no value is refused", args: ["scan", "--expect-org"] },
];

const failures = [];
for (const { name, args } of CASES) {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    // No FG_TOKEN, so the last case refuses rather than proceeding.
    env: { ...process.env, FG_TOKEN: "" },
  });
  const out = run.stdout ?? "";
  if (out.trim() !== "") {
    failures.push(`${name}: wrote ${out.length} byte(s) to stdout — "${out.trim().slice(0, 80)}"`);
  }
  // A diagnostic that reaches NEITHER stream is worse than one on the wrong stream: the operator
  // sees a command that did nothing and says nothing.
  if ((run.stderr ?? "").trim() === "") {
    failures.push(`${name}: said nothing on stderr either — the operator gets silence`);
  }
}

if (failures.length > 0) {
  console.error("✗ efs.mjs stream discipline violated — stdout must carry ONLY a JSON result:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\n  A prompt or a narrative line on stdout makes `efs.mjs <cmd> > file.json` hang or produce\n"
      + "  invalid JSON. Human-facing output goes to stderr; the JSON payload goes to stdout.",
  );
  process.exit(1);
}
console.log(`✓ efs.mjs stream discipline ok — ${CASES.length} non-network path(s), stdout clean on each.`);
