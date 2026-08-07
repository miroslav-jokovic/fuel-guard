#!/usr/bin/env node
/**
 * "What is actually running?" — in one command (ship-pipeline plan D0.5).
 *
 * Compares this checkout (git HEAD, highest migration file) against a deployed API's
 * `GET /api/version`. Prints a table and exits non-zero on any drift, so it works as a CI gate as
 * well as a human sanity check.
 *
 *   node scripts/verify-live.mjs                      # uses EXPO_PUBLIC_API_URL from apps/driver/.env
 *   node scripts/verify-live.mjs https://my-api.tld   # explicit target
 *   API_URL=... node scripts/verify-live.mjs
 *
 * This exists because on 2026-08-07 the question "why don't I see my changes?" cost an hour of
 * probing route shapes over HTTPS to infer which build was live. It should cost five seconds.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TIMEOUT_MS = 15_000;

function localCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function localBranch() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** True when HEAD is present on the tracked remote branch — an unpushed commit can never be live. */
function isPushed() {
  try {
    const out = execFileSync("git", ["log", "--oneline", "@{u}..HEAD"], { cwd: root, encoding: "utf8" });
    return out.trim().length === 0;
  } catch {
    return null; // no upstream configured — unknown, not false
  }
}

function localSchemaVersion() {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => /^(\d+)_/.exec(n)?.[1])
    .filter(Boolean)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return versions.at(-1) ?? null;
}

/** Target precedence: argv → API_URL → the driver app's own .env, which is the URL the phone uses. */
function targetUrl() {
  const explicit = process.argv[2] ?? process.env.API_URL ?? process.env.VERIFY_LIVE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const env = readFileSync(join(root, "apps/driver/.env"), "utf8");
    const url = /^EXPO_PUBLIC_API_URL=(.+)$/m.exec(env)?.[1]?.trim();
    if (url) return url.replace(/\/+$/, "");
  } catch {
    /* fall through */
  }
  return null;
}

function row(label, local, live, ok) {
  const mark = ok === null ? "?" : ok ? "✓" : "✗";
  return `  ${mark}  ${label.padEnd(18)} local ${String(local ?? "—").padEnd(24)} live ${String(live ?? "—")}`;
}

const base = targetUrl();
if (!base) {
  console.error("✗ No API URL. Pass one as an argument, set API_URL, or add EXPO_PUBLIC_API_URL to apps/driver/.env.");
  process.exit(2);
}

let live;
try {
  const res = await globalThis.fetch(`${base}/api/version`, { signal: globalThis.AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) {
    console.error(`✗ ${base}/api/version returned 404.`);
    console.error("  The deployed API predates the version endpoint (ship-pipeline D0) — it is at least one deploy behind.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  live = await res.json();
} catch (err) {
  console.error(`✗ Could not reach ${base}/api/version — ${err.message}`);
  process.exit(1);
}

const local = { commit: localCommit(), branch: localBranch(), schema: localSchemaVersion() };
const pushed = isPushed();
const commitOk = local.commit && live.commit ? local.commit === live.commit : null;
const schemaOk = local.schema && live.schema?.applied ? local.schema === live.schema.applied : null;

console.log(`\nFuelGuard — live deployment check\n  target ${base}   env ${live.env}\n`);
console.log(row("commit", local.commit?.slice(0, 7), live.commitShort, commitOk));
console.log(row("branch", local.branch, live.branch, local.branch && live.branch ? local.branch === live.branch : null));
console.log(row("schema version", local.schema, live.schema?.applied, schemaOk));
console.log(row("code expects", local.schema, live.schema?.expected, null));
console.log(`\n  deployment ${live.deploymentId ?? "—"}   up since ${live.startedAt}`);

const problems = [];
if (pushed === false) problems.push("HEAD is not pushed — the commit you are testing has never reached CI or Railway.");
if (commitOk === false) problems.push(`Railway is running ${live.commitShort}, you are on ${local.commit?.slice(0, 7)} — the deploy has not landed (or failed).`);
if (commitOk === null) problems.push("Could not compare commits — one side did not report one.");
if (live.schema?.state === "behind") problems.push(`Database is at ${live.schema.applied}, the code expects ${live.schema.expected} — migrations have not been applied. Run the "Apply Supabase migrations" workflow.`);
if (live.schema?.state === "ahead") problems.push(`Database is at ${live.schema.applied}, ahead of the code's ${live.schema.expected} — a rollback left the schema in front of the API.`);
if (live.schema?.state === "unknown") problems.push("The API could not read the migration ledger — either Supabase is unconfigured, or migration 0140 has not been applied.");
if (schemaOk === false && live.schema?.state === "current") problems.push(`Live schema ${live.schema.applied} differs from this checkout's ${local.schema}.`);

if (problems.length === 0) {
  console.log("\n✓ Live deployment matches this checkout.\n");
  process.exit(0);
}
console.log("\n✗ Drift:\n" + problems.map((p) => `  · ${p}`).join("\n") + "\n");
process.exit(1);
