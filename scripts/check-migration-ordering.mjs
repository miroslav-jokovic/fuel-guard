#!/usr/bin/env node
/**
 * A merged commit runs against the PREVIOUS schema for about ten minutes. Code must survive that.
 *
 * ── THE INCIDENT THIS GATE EXISTS FOR (2026-09-01, #430) ────────────────────────────────────────
 * Migration 0284 added `renderer_version` and `template_revision` to `vehicle_inspections`, and the
 * same commit added both names to `REPORT_COLUMNS` — the SELECT list that `inspectionList.ts` uses
 * for the inspections page. Measured on that merge:
 *
 *   15:33:00Z  merge to main
 *   15:36:01Z  Railway is serving the new API                 ← new code, old schema
 *   15:44:37Z  CI goes green
 *   15:45:11Z  `migrate.yml` applies 0284                     ← window closes
 *
 * For **9 minutes 10 seconds** the API asked PostgREST for two columns the database did not have,
 * so every load of the inspections page returned 500. Nothing was lost and it healed itself, but the
 * page was down for everyone during it.
 *
 * The window is not a bug to be removed here. Railway deploys on push; `migrate.yml` deliberately
 * waits for CI green (audit 2026-08-09 finding 3.1 — it used to run in parallel, so a red build
 * still touched production). Two pipelines, the schema one intentionally slower.
 * `deploy-verify.yml` already models the gap: it polls for `schema=current` for up to fifteen
 * minutes and treats "commit matches, schema behind" as a normal transient state.
 *
 * So the rule is the ordinary expand/contract discipline, and it is what this gate enforces:
 *
 *   **A column and its first reader ship in two different merges.** Migration first; the code that
 *   names the column follows once `/api/version` reports `schema.state = "current"`.
 *
 * ── WHAT IT DOES NOT FLAG, AND WHY ─────────────────────────────────────────────────────────────
 * **A new table.** Its readers are new code paths — during the window a feature nobody is using yet
 * degrades, rather than a page they are using breaking. That is the difference between 0283
 * (`maintenance_print_profiles` plus its service, harmless) and 0284 (two columns into a live SELECT
 * list, an outage). Widening this to new tables would fail almost every feature PR this repo makes
 * and would be reached for a waiver within a week, which is how a gate dies.
 *
 * **Columns named only in migrations, docs, plans or the schema snapshot.** Those do not run.
 *
 * ── WHERE IT RUNS ──────────────────────────────────────────────────────────────────────────────
 * CI runs it on the PULL REQUEST only, with `MIGRATION_ORDERING_BASE` set to the base sha. That is
 * the moment it can still stop something: on a push to main the merge has landed and Railway is
 * already building, so failing there would paint main red over a thing nobody can now prevent. The
 * `--self-test` runs on both events, so a detector that stops firing is still caught.
 *
 * Run by hand it works on a branch (against `origin/main`) and on a merge commit (against its first
 * parent) — the second is how the #430 merge above was checked after the fact.
 *
 * ── THE HONEST FIX IS NOT MINE TO MAKE ─────────────────────────────────────────────────────────
 * This gate polices the window. CLOSING it means ordering the app deploy behind the migration —
 * Railway deploying on a workflow trigger that runs after `migrate.yml` instead of on push. That is
 * Railway configuration, recorded as the open question in `docs/MIGRATION-DISCIPLINE.md`. Until it
 * is answered, backward compatibility for one release is a property every merge has to have.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * Source that RUNS in production. A column named in a `.sql`, a `.md` or the schema snapshot is not
 * a read; only these can issue one.
 */
const SOURCE_RE = /^(apps|packages)\/.*\.(ts|tsx|vue|mjs)$/;
/** Tests do not serve traffic, so a test naming a new column cannot take a page down. */
const IS_TEST = (p) => /\.(test|spec)\.[a-z]+$/.test(p) || p.includes("/testing/");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * What this change adds, against the state main was in before it.
 *
 * Three cases, and the middle one is a hole the first version of this gate had:
 *
 *   1. `MIGRATION_ORDERING_BASE` — set by CI from the pull request's base sha, and what the
 *      historical check against #430 used. Explicit beats inferred.
 *   2. **HEAD is a merge commit** (a push to main). `merge-base origin/main HEAD` is then HEAD
 *      itself, the diff is empty, and the gate passes everything — silently. Use the first parent,
 *      which is main as it stood before the merge, so the merge that just landed is what gets read.
 *   3. A branch: the point it left main.
 *
 * `origin/main` before `main` because a CI checkout has no local main.
 */
function baseRef() {
  const pinned = process.env.MIGRATION_ORDERING_BASE?.trim();
  if (pinned) return pinned;
  const head = git(["rev-parse", "HEAD"]).trim();

  /**
   * `origin/main` is the ONLY branch consulted when it exists, and a stale local `main` is never a
   * fallback for it.
   *
   * That was a real false positive, found 2026-09-01: local main sat two merges behind origin/main,
   * so `merge-base(main, HEAD)` returned an old commit and the diff swallowed migrations that had
   * already shipped — the gate then blamed the current change for a column somebody else had merged
   * a merge earlier. A gate that fires on innocent work is a gate that gets skipped.
   *
   * Local `main` is tried only when there is no `origin/main` at all (a clone with no remote), where
   * a stale answer is better than no answer.
   */
  const baseFrom = (ref) => {
    try {
      const b = git(["merge-base", ref, "HEAD"]).trim();
      return b && b !== head ? b : null;
    } catch {
      return null;
    }
  };
  const hasOrigin = (() => {
    try {
      git(["rev-parse", "--verify", "--quiet", "origin/main"]);
      return true;
    } catch {
      return false;
    }
  })();

  const branchBase = hasOrigin ? baseFrom("origin/main") : baseFrom("main");
  if (branchBase) return branchBase;

  // Nothing ahead of main, so HEAD IS main. If it is a merge commit, its first parent is main as it
  // stood before — which reads the merge that just landed.
  const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  return parents.length > 2 ? parents[1] : null;
}

/**
 * Which of `pending`'s columns this change INTRODUCES to one source file.
 *
 * Pure, and separated from the walk so `--self-test` can prove it fires — the repo's rule that a
 * detector nobody has seen fail is a detector nobody knows works.
 *
 * The name is matched as a WORD: a substring match would fire on `renderer_version_label`. And it
 * must be absent from the file BEFORE the change, so an unrelated edit to a file that already read
 * the column is not blamed for it.
 */
export function readsIntroduced(file, body, beforeBody, pending) {
  const out = [];
  for (const { table, column, file: migration, kind } of pending) {
    const re = new RegExp(`\\b${column}\\b`);
    if (re.test(body) && !re.test(beforeBody)) out.push({ file, column, table, migration, kind });
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  // The real 0284 shape, reduced: two columns onto an existing table, then named in a SELECT list.
  const sql = `alter table public.vehicle_inspections
  add column if not exists renderer_version  text,
  add column if not exists template_revision text;`;
  const cols = addedColumns(sql);
  const fires = readsIntroduced(
    "apps/api/x.ts",
    'const REPORT_COLUMNS = "id, status, renderer_version, template_revision";',
    'const REPORT_COLUMNS = "id, status";',
    cols.map((c) => ({ ...c, file: "0284.sql" })),
  );
  // A new table's own columns are exempt, and a column the file already read is not this change's.
  const newTable = addedColumns("create table if not exists public.widgets (id uuid); alter table public.widgets add column name text;");
  const alreadyRead = readsIntroduced("apps/api/x.ts", "renderer_version", "renderer_version", [
    { table: "t", column: "renderer_version", file: "0284.sql" },
  ]);
  // 0281's shape: a rename is caught by its NEW name, for the reason in `addedColumns`.
  const renamed = addedColumns("alter table vehicle_inspections rename column stock_serial to decal_serial;");
  // And a substring must not fire: `renderer_version_label` is a different column.
  const substring = readsIntroduced("apps/api/x.ts", "renderer_version_label", "", [
    { table: "t", column: "renderer_version", file: "0284.sql" },
  ]);
  const checks = {
    "two columns parsed": cols.length === 2,
    "both fire on a SELECT list": fires.length === 2,
    "a new table is exempt": newTable.length === 0,
    "a pre-existing read is not blamed": alreadyRead.length === 0,
    "a rename is caught by its new name": renamed.length === 1 && renamed[0].column === "decal_serial",
    "a substring does not fire": substring.length === 0,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  console.log(
    failed.length === 0
      ? `✓ migration-ordering self-test — ${Object.keys(checks).length} detectors, all fire as intended.`
      : `✗ migration-ordering self-test FAILED: ${failed.join("; ")}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

const base = baseRef();
if (!base) {
  console.error(
    "✗ migration ordering: cannot find a merge base against origin/main.\n" +
      "  CI needs `fetch-depth: 0` on actions/checkout for this gate; locally, `git fetch origin`.\n" +
      "  Skipping would make a silent pass indistinguishable from a real one, which is the failure\n" +
      "  mode migrate.yml's own header warns about.",
  );
  process.exit(1);
}

/**
 * Committed changes AND the working tree, because a gate that only sees commits gives a FALSE PASS
 * to the person most likely to run it: someone who has just written the migration and the reader
 * together and wants to know before they commit. `git diff <base>` (no HEAD) already spans the tree;
 * a brand-new migration is untracked, so it has to be asked for separately.
 */
const changed = [
  ...git(["diff", "--name-only", "--diff-filter=ACMR", base]).split("\n"),
  ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
].filter(Boolean);
const addedMigrations = changed.filter((p) => /^supabase\/migrations\/\d+.*\.sql$/.test(p));

if (addedMigrations.length === 0) {
  console.log("✓ migration ordering ok — no migrations in this change.");
  process.exit(0);
}

/**
 * Columns added to a table that ALREADY EXISTS.
 *
 * A `create table` in the same file declares its own columns; those are exempt for the reason in the
 * header. So the tables this migration creates are collected first and then subtracted.
 */
function addedColumns(sql) {
  const created = new Set(
    [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const found = [];
  const alterRe = /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi;
  for (const alter of sql.matchAll(alterRe)) {
    const table = alter[1].toLowerCase();
    if (created.has(table)) continue;
    const body = alter[2];
    for (const col of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) {
      found.push({ table, column: col[1].toLowerCase(), kind: "added" });
    }
    // A RENAME is the same hazard and strictly worse: the old name breaks the moment the migration
    // lands and the new name breaks until it does, so there is no window in which both sides work.
    // The safe shape is add, backfill, switch, drop — four merges, not one. 0281 renamed
    // `stock_serial` to `decal_serial` in the same merge as its readers and got away with it only
    // because the table was empty and the feature unreleased.
    for (const col of body.matchAll(/rename\s+column\s+[a-z0-9_]+\s+to\s+([a-z0-9_]+)/gi)) {
      found.push({ table, column: col[1].toLowerCase(), kind: "renamed to" });
    }
  }
  return found;
}

const pending = [];
for (const file of addedMigrations) {
  for (const c of addedColumns(readFileSync(join(ROOT, file), "utf8"))) pending.push({ ...c, file });
}

if (pending.length === 0) {
  console.log(
    `✓ migration ordering ok — ${addedMigrations.length} migration(s), no column added to an existing table.`,
  );
  process.exit(0);
}

/**
 * A column name has to be matched as a WORD.
 *
 * A substring match would fire on `renderer_version_label`, and worse, would not fire on a column
 * whose name is a common word appearing in prose. Word boundaries keep both honest.
 */
const violations = [];
for (const file of changed.filter((p) => SOURCE_RE.test(p) && !IS_TEST(p))) {
  let body;
  try {
    body = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue; // renamed away or deleted in a later commit on this branch
  }
  let beforeBody = "";
  try {
    beforeBody = git(["show", `${base}:${file}`]);
  } catch {
    /* the file is new on this branch */
  }
  violations.push(...readsIntroduced(file, body, beforeBody, pending));
}

if (violations.length === 0) {
  console.log(
    `✓ migration ordering ok — ${pending.length} new column(s) on existing tables, none read by code in the same change.`,
  );
  process.exit(0);
}

console.error(`✗ ${violations.length} column(s) added and read in the same merge:\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    names "${v.column}", which ${v.migration} adds to ${v.table} in this same change.`);
}
console.error(
  "\nRailway serves a merge about three minutes in; migrate.yml applies the schema about twelve." +
    "\nFor the ~9 minutes between, this code runs against the OLD schema and PostgREST rejects the" +
    "\nwhole query — which is how the inspections page returned 500 for everyone on 2026-09-01." +
    "\n\nSplit it into two merges: the migration alone first, then the code once /api/version reports" +
    "\nschema.state = \"current\". docs/MIGRATION-DISCIPLINE.md §the-deploy-window has the sequence.",
);
process.exit(1);
