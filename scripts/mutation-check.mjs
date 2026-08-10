#!/usr/bin/env node
/**
 * Mutation harness: does the safety net still bite? (audit 2026-08-09, Stage 2.6)
 *
 * WHY THIS EXISTS. A test suite reports on itself. It says "290 passed" whether or not those 290
 * assertions would notice a real defect, and the failure is invisible from the inside — a matrix
 * that has quietly stopped testing anything looks exactly like a matrix that passes. That is not
 * hypothetical here. Before Stage 2, seeding `using (true)` into three of the most sensitive SELECT
 * policies in the schema — every org's fuel data, driver PII and anomalies world-readable — changed
 * the RLS matrix's output not at all: 209 passed, 0 failed, byte-identical to a clean run. Four of
 * six seeded regressions survived.
 *
 * The fix for that was better assertions. THIS file is what stops those assertions from rotting: it
 * breaks the code on purpose, in ways that mirror defects this codebase has actually shipped, and
 * requires the suite to go red. A mutation that SURVIVES is a hole in the net, reported as a failure.
 *
 * Two rules that make the harness honest:
 *   1. A mutation whose pattern no longer matches is a FAILURE, not a skip. Code moves; a stale
 *      mutation silently tests nothing, which is the exact disease being treated.
 *   2. A detection command that fails to START is a FAILURE, not a skip. "The runner was missing so
 *      we passed" is how the driver app went 24 tests without executing any of them.
 *
 * The two `api-*` mutations shell out to pnpm, so they only run where the workspace is installed —
 * in CI, and on a machine that has run `pnpm install`. Where pnpm is absent they report ERROR, not
 * "skipped": a check that cannot run has not passed, and saying otherwise is how this repository lost
 * 24 driver tests for months.
 *
 * Usage:
 *   node scripts/mutation-check.mjs                # everything (CI)
 *   node scripts/mutation-check.mjs --only=rls-    # substring filter, for local iteration
 *   node scripts/mutation-check.mjs --list
 *
 * Mutations are applied IN PLACE and restored in a `finally`, with the restore verified by content
 * hash. The harness refuses to run when a target file already differs from git HEAD, so it can never
 * clobber uncommitted work — pass --allow-dirty only if you know why.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Detection commands. Each must EXIT NON-ZERO when the mutation is present. */
const RLS_MATRIX = ["node", ["supabase/tests/rls.test.mjs"]];
const HAZMAT_MATRIX = ["node", ["supabase/tests/hazmat_rls.test.mjs"]];
const apiTest = (f) => ["pnpm", ["--filter", "@fuelguard/api", "exec", "vitest", "run", f]];

const MUTATIONS = [
  // ── tenant isolation in the database ────────────────────────────────────────
  {
    id: "rls-ftxn-select-open",
    why: "Every org's fuel transactions become world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy ftxn_select on fuel_transactions\n  for select using (org_id = auth_org_id());",
    replace: "create policy ftxn_select on fuel_transactions\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "rls-drivers-select-open",
    why: "Every org's driver PII becomes world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy drivers_select on drivers\n  for select using (org_id = auth_org_id());",
    replace: "create policy drivers_select on drivers\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "rls-anomalies-select-open",
    why: "Every org's theft alerts become world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy anomalies_select on anomalies\n  for select using (org_id = auth_org_id());",
    replace: "create policy anomalies_select on anomalies\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "anon-lockout-imports-open",
    why:
      "Opens a table that has no restrictive policy behind it, so the leak reaches an " +
      "UNAUTHENTICATED caller holding only the publishable anon key. Positive control for the anon " +
      "sweep — the cross-tenant mutations above are all on tables where 0083's restrictive driver " +
      "policies still block anon, so they do not exercise it.",
    file: "supabase/migrations/0007_imports.sql",
    find: "create policy imports_select on imports for select using (org_id = auth_org_id());",
    replace: "create policy imports_select on imports for select using (true);",
    detect: RLS_MATRIX,
  },
  // ── the Stage 1 fixes ───────────────────────────────────────────────────────
  {
    id: "definer-revoke-removed",
    why: "Restores the state 0162 fixed: SECURITY DEFINER RPCs taking (p_org, p_user) callable by anon.",
    file: "supabase/migrations/0162_definer_exposure_closure.sql",
    find: "execute format('revoke all on function %s from public, anon, authenticated', sig);",
    replace: "-- mutation: revoke removed",
    detect: RLS_MATRIX,
  },
  {
    id: "hazmat-draft-withcheck-weakened",
    why: "Restores the 0092 defect: a driver could self-clear a hazmat load, bypassing hazmat_reviews.",
    file: "supabase/migrations/0161_hazmat_draft_and_org_immutability.sql",
    find:
      "  with check (\n    org_id = auth_org_id()\n    and auth_role() = 'driver'\n" +
      "    and created_by = auth_user_id()\n    and status = 'draft'\n  );",
    replace: "  with check (auth_role() = 'driver' and created_by = auth_user_id());",
    detect: HAZMAT_MATRIX,
  },
  {
    id: "org-id-made-mutable",
    why: "Removes the org_id immutability trigger, so a row can be moved between tenants.",
    file: "supabase/migrations/0161_hazmat_draft_and_org_immutability.sql",
    find:
      "      'create trigger %I before update on public.%I for each row execute function public.forbid_org_change()',",
    replace: "      'select 1 /* %I %I mutation: trigger removed */',",
    detect: HAZMAT_MATRIX,
  },
  // ── tenant scoping in application code (needs node_modules; CI) ─────────────
  {
    id: "api-anomalyFlagReconcile-unscoped",
    why: "Drops the tenant filter from a service. The API uses the service role, so RLS will not catch it.",
    file: "apps/api/src/services/anomalyFlagReconcile.ts",
    find: '      .select("id")\n      .eq("org_id", orgId)\n      .eq("has_anomaly", true)',
    replace: '      .select("id")\n      .eq("has_anomaly", true)',
    detect: apiTest("src/services/anomalyFlagReconcile.test.ts"),
  },
  {
    id: "api-idleRollup-unscoped",
    why: "Same class, different service — proves the recorder assertion is applied, not just available.",
    file: "apps/api/src/services/idleRollup.ts",
    find: '      .eq("org_id", orgId).gte("day", w.fromDate)',
    replace: '      .gte("day", w.fromDate)',
    detect: apiTest("src/services/idleRollup.test.ts"),
  },
  // ── the fitness functions themselves ────────────────────────────────────────
  {
    id: "driver-tests-uncollected",
    why: "Re-narrows the driver include glob — the bug that hid 24 tests for months, three times over.",
    file: "apps/driver/vitest.config.ts",
    find: "include: ['tests/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],",
    replace: "include: ['tests/**/*.test.ts'],",
    detect: ["node", ["scripts/check-test-collection.mjs"]],
  },
];

// ── runner ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "";
const allowDirty = args.includes("--allow-dirty");

if (args.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id.padEnd(36)} ${m.file}`);
  process.exit(0);
}

const selected = MUTATIONS.filter((m) => m.id.includes(only));
if (selected.length === 0) {
  console.error(`No mutations match --only=${only}`);
  process.exit(1);
}

// Never clobber uncommitted work.
if (!allowDirty) {
  const files = [...new Set(selected.map((m) => m.file))];
  const dirty = spawnSync("git", ["diff", "--name-only", "HEAD", "--", ...files], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const changed = (dirty.stdout ?? "").trim();
  if (changed) {
    console.error(
      "Refusing to run: these target files differ from git HEAD, and this harness edits files in " +
        "place.\n" + changed + "\nCommit or stash first, or pass --allow-dirty.",
    );
    process.exit(1);
  }
}

const results = [];
for (const m of selected) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, "utf8");
  const before = sha(original);

  if (!original.includes(m.find)) {
    results.push({ id: m.id, status: "STALE", note: `pattern not found in ${m.file}` });
    continue;
  }

  let status, note;
  try {
    writeFileSync(path, original.replace(m.find, m.replace));
    const [cmd, cmdArgs] = m.detect;
    const run = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" });
    if (run.error) {
      status = "ERROR";
      note = `could not run ${cmd}: ${run.error.message}`;
    } else if (run.status === 0) {
      status = "SURVIVED";
      note = `${cmd} ${cmdArgs.join(" ")} still passed`;
    } else {
      status = "CAUGHT";
      const hit = (run.stdout ?? "").split("\n").find((l) => /FAIL|not scoped|NEVER COLLECTED/.test(l));
      note = (hit ?? "").trim().slice(0, 100);
    }
  } finally {
    writeFileSync(path, original);
    if (sha(readFileSync(path, "utf8")) !== before) {
      console.error(`\nFATAL: ${m.file} was NOT restored. Restore it from git before doing anything else.`);
      process.exit(2);
    }
  }
  results.push({ id: m.id, status, note });
}

const width = Math.max(...results.map((r) => r.id.length));
console.log("");
for (const r of results) {
  const mark = r.status === "CAUGHT" ? "ok  " : "FAIL";
  console.log(`${mark} ${r.status.padEnd(9)} ${r.id.padEnd(width)}  ${r.note}`);
}

const bad = results.filter((r) => r.status !== "CAUGHT");
console.log(`\n${results.length - bad.length}/${results.length} mutations caught.`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results
    .map((r) => `| ${r.status === "CAUGHT" ? "✅" : "❌"} ${r.status} | \`${r.id}\` | ${r.note || ""} |`)
    .join("\n");
  const md = [
    "### Mutation check — does the test suite still bite?",
    "",
    `**${results.length - bad.length}/${results.length} caught.**`,
    "",
    "| Result | Mutation | Detail |",
    "| --- | --- | --- |",
    rows,
    "",
    bad.length
      ? "> A **SURVIVED** mutation means the defect was introduced and nothing went red. " +
        "A **STALE** one means the code moved and that check has been testing nothing since."
      : "> Every deliberately introduced defect was detected.",
    "",
  ].join("\n");
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  } catch (err) {
    console.error(`(could not write step summary: ${err.message})`);
  }
}
if (bad.length) {
  console.error(
    "\nA SURVIVED mutation is a hole in the test suite: the defect was introduced and nothing went red.\n" +
      "A STALE mutation is worse — the code moved and this check has been testing nothing since.\n" +
      "Fix the assertions (or the mutation), never delete the entry.",
  );
  process.exit(1);
}
