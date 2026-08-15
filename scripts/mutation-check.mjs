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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    file: "apps/api/src/services/idleRollupInputs.ts",
    find: '      .eq("org_id", orgId)\n      .gte("day", w.fromDate)',
    replace: '      .gte("day", w.fromDate)',
    detect: apiTest("src/services/idleRollup.test.ts"),
  },
  // ── the EFS capability registry (plan Step 3.10) ────────────────────────────
  // Every one of these mirrors a defect THIS workstream actually produced or nearly produced, and
  // each was verified by hand at the time it was fixed. Writing them down is what stops the check
  // from being a thing somebody once did: the registry's whole promise is that a capability cannot
  // ship half-wired, and a promise with no failing case behind it is a comment.
  {
    id: "efs-vendorMovesFields-dropped",
    why: "A direct op stops declaring the fields it owns, so every successful clear reports itself as unexplained drift. Found by running a two-step sequence in Step 3.4; the first green run came back drift_detected.",
    file: "apps/api/src/efs/capabilities/overrideClear.behaviour.ts",
    find: "  vendorMovesFields: OVERRIDE_FIELDS,\n",
    replace: "",
    detect: apiTest("src/efs/registry.test.ts"),
  },
  {
    id: "efs-reconcile-dropped",
    why: "A capability stops declaring how its unverified rows are judged later, and they sit on the operator's Unverified list forever. That was the state of every direct op until Step 3.9.",
    file: "apps/api/src/efs/capabilities/overrideClear.behaviour.ts",
    find: "  reconcile: (after) => {\n    if (!after.doc) return \"indeterminate\";\n    return overrideClearedLanded(after.doc) ? \"landed\" : \"not_landed\";\n  },\n",
    replace: "",
    detect: apiTest("src/efs/registry.test.ts"),
  },
  {
    id: "efs-fraud-stepup-exact-match",
    why: "The fraud gate compares statuses with === instead of efsStatusEquals. This account reports FRAUD upper-cased, so the unlock walks straight past the step-up — the 2026-08-12 casing incident, applied to the field that decides whether a password is demanded.",
    file: "apps/api/src/efs/capabilities/cardUnlock.behaviour.ts",
    find: "(!ctx.stepUp && efsStatusEquals(snap.doc?.card.status ?? null, \"Fraud\") ? FRAUD_STEP_UP : null)",
    replace: "(!ctx.stepUp && (snap.doc?.card.status ?? null) === \"Fraud\" ? FRAUD_STEP_UP : null)",
    detect: apiTest("src/efs/capabilities/cardUnlock.behaviour.test.ts"),
  },
  {
    id: "efs-prompts-optin-bypassed",
    why: "The DRID removal opt-in is ignored, so clearing a text box can stop the pump asking who is fuelling (guide p137). The refusal had no test at all until Step 3.6.",
    file: "apps/api/src/efs/capabilities/promptsSet.behaviour.ts",
    find: "assertPromptRemovalAllowed(plan.removedInfoIds, body.allowRemoveDriverId, ctx.stepUp);",
    replace: "assertPromptRemovalAllowed(plan.removedInfoIds, true, ctx.stepUp);",
    detect: apiTest("src/efs/capabilities/promptsSet.behaviour.test.ts"),
  },
  {
    id: "efs-writebucket-mismatched",
    why: "A contract declares a bucket its mounted path does not resolve to. cardWriteBucket returns null on a miss and the limiter treats null as ALLOW, so the failure mode is an UNMETERED write route rather than a broken one.",
    file: "packages/shared/src/efs/capabilities/cardLock.contract.ts",
    find: "  writeBucket: \"card_status\",",
    replace: "  writeBucket: \"card_override\",",
    detect: apiTest("src/efs/registry.test.ts"),
  },
  {
    id: "efs-preflight-after-limiter",
    why: "The body-only step-up runs AFTER the write limiter, so a refusal spends a slot against a daily cap for an action the caller was always allowed to take once they re-authenticate. Step 3.5b exists to prevent exactly this.",
    file: "apps/api/src/efs/router.ts",
    find: "  if (accepted.stepUpMessage && !hasFreshAuth(req)) {\n    stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, accepted.stepUpMessage);\n    return;\n  }\n\n  const prepared = await prepare(req, res, contract.scope as CardScope);\n  if (!prepared) return;",
    replace: "  const prepared = await prepare(req, res, contract.scope as CardScope);\n  if (!prepared) return;\n\n  if (accepted.stepUpMessage && !hasFreshAuth(req)) {\n    stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, accepted.stepUpMessage);\n    return;\n  }",
    detect: apiTest("src/efs/router.test.ts"),
  },
  {
    id: "efs-partial-collapsed-into-failed",
    why: "A half-applied sequence settles `failed` instead of `partial`, sending an operator to re-run steps that already landed. `partial` is terminal but ACTIONABLE (docs/27 §5.1, migration 0190).",
    file: "apps/api/src/efs/orchestrator/dispatch.ts",
    find: "      if (landedSteps > 0) return await finalizePartial(ctx, ledger, facts, verified.after.doc, sent);\n",
    replace: "",
    detect: apiTest("src/efs/orchestrator/orchestrator.test.ts"),
  },
  // ── the fitness functions themselves ────────────────────────────────────────
  {
    id: "waiver-growth-unchecked",
    why:
      "Restores the unconditional waiver Set the file-size gate used to have. Its comment said the " +
      "list 'may only SHRINK' and nothing enforced it, so the four waived files grew 282 lines in " +
      "three weeks — the gate's own exemptions became the only unbounded files in the repo.",
    file: "scripts/check-file-size.mjs",
    find: "      if (lines > pin) grown.push({ rel, lines, pin });",
    replace: "      if (false) grown.push({ rel, lines, pin });",
    detect: ["node", ["scripts/check-waiver-growth.mjs"]],
  },

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

/**
 * CRASH SAFETY.
 *
 * This harness edits real source files and restores them in a `finally`. That is not enough: a
 * `finally` does not run when the process is killed, and this one was — twice — by a command timeout
 * mid-sweep. The first kill left two stray lines in efsSoap.ts (which then failed the very gate the
 * mutation was testing); the second left `imports_select` open to `using (true)` in a migration,
 * which is a tenant-isolation hole sitting in the working tree looking like a real regression.
 *
 * So every mutation's original content is written to a vault on disk first, signal handlers restore
 * on the way out, and a vault left over from a killed run is replayed BEFORE anything else happens.
 * A rig that can damage the tree it is testing is worse than no rig, because the damage looks like a
 * finding.
 */
const VAULT = join(tmpdir(), "fuelguard-mutation-vault");
const vaultPath = (rel) => join(VAULT, rel.replace(/[\\/]/g, "__"));

function recoverStaleVault() {
  if (!existsSync(VAULT)) return;
  const left = readdirSync(VAULT);
  if (left.length === 0) return;
  console.warn(`⚠ restoring ${left.length} file(s) left mutated by an interrupted run:`);
  for (const name of left) {
    const { rel, content } = JSON.parse(readFileSync(join(VAULT, name), "utf8"));
    writeFileSync(join(ROOT, rel), content);
    console.warn(`  - ${rel}`);
    rmSync(join(VAULT, name), { force: true });
  }
}
recoverStaleVault();
mkdirSync(VAULT, { recursive: true });

/** Files currently mutated, so a signal can put them back. */
const inFlight = new Map();
let unwound = false;
function unwind() {
  if (unwound) return;
  unwound = true;
  for (const [rel, content] of inFlight) {
    try {
      writeFileSync(join(ROOT, rel), content);
      rmSync(vaultPath(rel), { force: true });
    } catch (err) {
      console.error(`FATAL: could not restore ${rel}: ${String(err)}`);
    }
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { unwind(); process.exit(130); });
process.on("uncaughtException", (err) => { unwind(); console.error(err); process.exit(1); });
process.on("exit", unwind);

/**
 * Self-heal a leftover mutation, even under --allow-dirty.
 *
 * The vault above handles SIGINT/SIGTERM. It cannot handle SIGKILL, and the dirty-tree refusal is
 * bypassed exactly when you need it most — during development, when the tree is legitimately dirty
 * and everyone passes --allow-dirty out of habit. That combination left a tenant-isolation hole
 * (`imports_select ... using (true)`) sitting in a migration looking like a real regression.
 *
 * This check is precise rather than general: a file that is MISSING the mutation's `find` text and
 * CONTAINS its `replace` text is not ambiguous — it is this harness's own damage. Restore it from
 * HEAD and say so. Anything else is left alone; the dirty guard still owns that case.
 */
for (const m of selected) {
  const path = join(ROOT, m.file);
  let current;
  try { current = readFileSync(path, "utf8"); } catch { continue; }
  if (current.includes(m.find) || !current.includes(m.replace)) continue;
  const head = spawnSync("git", ["show", `HEAD:${m.file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (head.status !== 0) {
    console.error(`Leftover mutation "${m.id}" in ${m.file}, and it could not be read from HEAD. Restore it by hand.`);
    process.exit(2);
  }
  if (!head.stdout.includes(m.find)) continue; // HEAD does not have the clean text either — not ours to fix
  writeFileSync(path, head.stdout);
  console.warn(`⚠ restored ${m.file} — it was left mutated by "${m.id}" in an interrupted run.`);
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
    writeFileSync(vaultPath(m.file), JSON.stringify({ rel: m.file, content: original }));
    inFlight.set(m.file, original);
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
    inFlight.delete(m.file);
    rmSync(vaultPath(m.file), { force: true });
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
