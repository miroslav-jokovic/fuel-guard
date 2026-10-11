#!/usr/bin/env node
/**
 * "What is actually running?" — in one command (ship-pipeline plan D0.5; release train R6).
 *
 * Since the release train (2026-10-04) there are two environments that run DIFFERENT commits by
 * design, so the question needs a target. Each target is compared with the git ref it follows:
 *
 *   pnpm verify:live                 # production — vs origin/production, the last release
 *   pnpm verify:live staging         # staging (uat) — vs origin/main, the last merge
 *   pnpm verify:live https://h.tld   # any host — vs this checkout's HEAD (the pre-train behaviour)
 *   API_URL=... pnpm verify:live     # the same, from the environment
 *
 * The two named hosts are read from the repository variables API_URL and STAGING_API_URL — the
 * ones release.yml and deploy-verify.yml use — through `gh`, never restated here. Prints a table and
 * exits non-zero on any drift, so it works as a gate as well as a human sanity check.
 *
 * This exists because on 2026-08-07 the question "why don't I see my changes?" cost an hour of
 * probing route shapes over HTTPS to infer which build was live. It should cost five seconds.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TIMEOUT_MS = 15_000;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
const git = (...args) => run("git", args);

/** Named targets: the repository variable holding the host, and the remote branch that host serves. */
const TARGETS = {
  production: { variable: "API_URL", branch: "production" },
  staging: { variable: "STAGING_API_URL", branch: "main" },
};

/** Numeric-then-lexicographic, so "0099" < "0140" and v2026.10.05.10 sorts after v2026.10.05.2. */
const byVersion = (a, b) => a.length - b.length || a.localeCompare(b);

function highestMigration(paths) {
  return (
    paths
      .map((p) => /^(\d+)_.+\.sql$/.exec(p.split("/").pop())?.[1])
      .filter(Boolean)
      .sort(byVersion)
      .at(-1) ?? null
  );
}

/** True when HEAD is present on the tracked remote branch — an unpushed commit can never be live. */
function isPushed() {
  const out = git("log", "--oneline", "@{u}..HEAD");
  return out === null ? null : out.length === 0; // no upstream configured — unknown, not false
}

/** What the target SHOULD be running: a remote branch's tip, or this checkout's HEAD. */
function expected(target) {
  if (!target) {
    return {
      label: "this checkout",
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      schema: highestMigration(readdirSync(join(root, "supabase/migrations"))),
      version: null,
    };
  }
  git("fetch", "--quiet", "--tags", "origin", target.branch);
  const commit = git("rev-parse", `origin/${target.branch}`);
  const files = commit ? git("ls-tree", "--name-only", commit, "supabase/migrations/") : null;
  const tags = commit ? git("tag", "--points-at", commit, "--list", "v*") : null;
  return {
    label: `origin/${target.branch}`,
    commit,
    branch: target.branch,
    schema: files ? highestMigration(files.split("\n")) : null,
    version: tags ? (tags.split("\n").filter(Boolean).sort(byVersion).at(-1) ?? null) : null,
  };
}

function row(label, local, live, ok) {
  const mark = ok === null ? "?" : ok ? "✓" : "✗";
  return `  ${mark}  ${label.padEnd(18)} expected ${String(local ?? "—").padEnd(24)} live ${String(live ?? "—")}`;
}

const arg = process.argv[2];
const isUrl = (s) => typeof s === "string" && s.includes("://");
if (arg && !isUrl(arg) && !TARGETS[arg]) {
  console.error(`✗ Unknown target "${arg}". Use production (the default), staging, or a URL.`);
  process.exit(2);
}
const explicitUrl = isUrl(arg) ? arg : arg ? null : (process.env.API_URL ?? process.env.VERIFY_LIVE_URL ?? null);
// An explicit URL keeps the pre-train behaviour (compare with HEAD); otherwise a named target.
const target = explicitUrl ? null : TARGETS[arg ?? "production"];
const base = (explicitUrl ?? run("gh", ["variable", "get", target.variable]))?.replace(/\/+$/, "");
if (!base) {
  console.error(`✗ Could not read the repository variable ${target.variable} — is \`gh\` signed in? Or pass a URL.`);
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

const want = expected(target);
const pushed = target ? true : isPushed();
const commitOk = want.commit && live.commit ? want.commit === live.commit : null;
const schemaOk = want.schema && live.schema?.applied ? want.schema === live.schema.applied : null;
const isProduction = target?.branch === "production";

console.log(`\nSilvicom 360 — live deployment check\n  target ${base}   env ${live.env}   compared with ${want.label}\n`);
console.log(row("commit", want.commit?.slice(0, 7), live.commitShort, commitOk));
console.log(row("branch", want.branch, live.branch, want.branch && live.branch ? want.branch === live.branch : null));
// R6 (D-REL10): only production is tagged. A live version still missing right after a release is the
// minutes before release.yml tags what it shipped, so it is shown, never counted as drift.
if (isProduction)
  console.log(row("release", want.version, live.version ?? "not reported", want.version && live.version ? want.version === live.version : null));
console.log(row("schema version", want.schema, live.schema?.applied, schemaOk));
console.log(row("code expects", want.schema, live.schema?.expected, null));
// L6 (0360): the database's own hourly partition maintenance. Absent on an API older than that merge.
const maint = live.maintenance?.state;
const maintOk = maint === undefined ? null : maint === "ok" || maint === "pending";
console.log(row("partition upkeep", "ok", maint ?? "not reported", maintOk));
console.log(`\n  deployment ${live.deploymentId ?? "—"}   up since ${live.startedAt}`);

const problems = [];
if (pushed === false) problems.push("HEAD is not pushed — the commit you are testing has never reached CI or Railway.");
if (commitOk === false)
  problems.push(
    isProduction
      ? `Production is running ${live.commitShort}; the production branch is at ${want.commit?.slice(0, 7)} — the release has not landed (or failed). Merged work reaches production only through an approved release (release.yml).`
      : `Railway is running ${live.commitShort}; ${want.label} is at ${want.commit?.slice(0, 7)} — the deploy has not landed (or failed).`,
  );
if (commitOk === null) problems.push("Could not compare commits — one side did not report one.");
if (live.schema?.state === "behind") problems.push(`Database is at ${live.schema.applied}, the code expects ${live.schema.expected} — migrations have not been applied.`);
if (live.schema?.state === "ahead") problems.push(`Database is at ${live.schema.applied}, ahead of the code's ${live.schema.expected} — a rollback left the schema in front of the API.`);
if (live.schema?.state === "unknown") problems.push("The API could not read the migration ledger — either Supabase is unconfigured, or migration 0140 has not been applied.");
if (maintOk === false)
  problems.push(
    maint === "unknown"
      ? "The API could not read the partition maintenance state (lifecycle_maintenance_health, 0360)."
      : `The database's hourly partition maintenance is "${maint}" (last success ${live.maintenance.lastSucceededAt ?? "never"}) — check cron.job_run_details for the partman-maintenance job.`,
  );
if (schemaOk === false && live.schema?.state === "current") problems.push(`Live schema ${live.schema.applied} differs from ${want.label}'s ${want.schema}.`);

if (problems.length === 0) {
  console.log(`\n✓ Live deployment matches ${want.label}.\n`);
  process.exit(0);
}
console.log("\n✗ Drift:\n" + problems.map((p) => `  · ${p}`).join("\n") + "\n");
process.exit(1);
