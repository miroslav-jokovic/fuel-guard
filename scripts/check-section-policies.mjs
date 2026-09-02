#!/usr/bin/env node
/**
 * Fitness function — the SECTION_ACCESS matrix and the SQL that mirrors it cannot drift silently
 * (D-SEP10, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; closes the hand-held gap
 * auth.ts:78-81 admits: "0078 derived each policy from rolesThatManage(section) BY HAND").
 *
 * Three sources of truth exist for who may touch what: the SECTION_ACCESS literal in
 * packages/shared/src/auth.ts, the `auth_role() in (...)` lists inside RLS policies, and the
 * requireRole() calls on routers. Nothing has ever checked them against each other — the 2026-08-27
 * audit found the entire fuel-spend surface hand-listing roles instead of deriving them, and a
 * dispatcher reading fuel spend nobody decided they should read. The check:
 *
 *   NEW migration role lists — any `auth_role() in ('…')` in a migration above 0260 must
 *      exactly equal rolesThatManage(section) or rolesThatCanView(section) for the section the
 *      table's module maps to (module from scripts/table-modules.json, section from the
 *      MODULE_SECTIONS map below), or the migration carries a `-- section-policy-waiver: <reason>`
 *      line. Policies written before the boundary are grandfathered wholesale: re-deriving the
 *      final policy state of 260 migrations by regex would be a guess, and a wrong guess in a
 *      gate is worse than a bounded one. The point is that the accounting/billing/maintenance
 *      sections (program phase P4) are born checked.
 *
 * The route-mount half of D-SEP10 ("every mounted router carries a requireRole") is deliberately
 * NOT here: role gates live per-verb inside router trees, so a static mount scan would pin
 * genuinely-gated routers (roster, recruiting) as "auth-only" — a ledger that lies, the exact
 * thing 0212's header warns a pretend-enforcing policy is. It lands at program step P4.2 as a
 * routeAuth.test.ts extension that inspects the real express middleware stacks at runtime.
 *
 * The matrix is parsed from the auth.ts literal — if the file's shape changes, this gate fails
 * loudly rather than silently checking nothing (parse-failure IS a failure).
 *
 * `--self-test` proves the detector fires and the matrix parse cannot silently go blind.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SQL_BOUNDARY = 260;

// Module → section. null = no client-facing section (deny-all tables, driver-app surfaces,
// platform machinery) — a role-named policy on such a module's table needs a waiver, because
// there is no matrix row to check it against. Extended in phase P4 with accounting/billing/
// maintenance; extending it is part of the section's birth certificate.
const MODULE_SECTIONS = {
  efs: "fuel",
  fuel: "fuel",
  "fuel-spend": "fuel",
  anomalies: "fuel",
  routing: "fuel",
  "posted-prices": "fuel", // carved out of fuel at P1.5; its tables' client policies were authored under the fuel section
  samsara: null,
  mcleod: null,
  psp: "safety",
  org: "admin",
  // `fleet` split into `roster` + `equipment` on 2026-08-30 (D-ROS12, DRIVER-ROSTER-PLAN R0a), so
  // every module that used to point at it had to be re-pointed deliberately rather than by search
  // and replace. `roster` is the DEFAULT for its module and the two equipment tables it owns are
  // named in TABLE_SECTIONS below — see that comment for why the module was not split instead.
  roster: "roster",
  idle: "equipment",      // idle_events, engine days, the learned idle envelope — telemetry off a truck
  performance: "roster",  // driver scores and the weeks they are computed over — facts about a person
  evidence: "safety",
  loads: "dispatch",
  financial: "accounting", // mapped at P4.1 — the finance sections are born checked
  accounting: "accounting", // P5.1 harness — no tables yet; the first one lands checked
  billing: "billing",       // P5.2 harness — same
  maintenance: "maintenance", // P5.3 harness — same
  messaging: null,
  "driver-app": null,
  recruiting: "recruitment",
  hazmat: "hazmat",
};

/**
 * Table → section, consulted BEFORE the module default. Empty until the D-ROS12 split, and it exists
 * because that split made one module legitimately span two sections: `roster` owns `drivers`,
 * `driver_time_off` and `driver_vehicle_assignments` (the people) alongside `vehicles` and `trailers`
 * (the machines).
 *
 * The alternative was splitting the MODULE to match the sections, and it was rejected. Module
 * ownership answers "which code may write this table" (lint:boundaries, check-table-modules.mjs) and
 * is correct as it stands — one roster module writes all five. Section membership answers "which role
 * may act here". They are different questions and are allowed different answers; bending the module
 * boundary to satisfy a permissions rename would be moving the wrong thing.
 */
const TABLE_SECTIONS = {
  vehicles: "equipment",
  trailers: "equipment",
  // Added with 0295 (P4 batch 3). Both are the D-ROS12 case again — a module and a section that
  // answer different questions — and neither is a re-classification: in each case the policy's
  // EXISTING role list is exactly one section's derived set, and the migration that authored it says
  // so in words. Pointing them anywhere else would fail this gate, which is the gate working.
  //
  // `psp_requests` is written by the `psp` module (module default `safety`) and its section read
  // lists exactly rolesThatCanView("recruitment"); 0216 calls it "hiring paperwork, behind the
  // hiring section".
  psp_requests: "recruitment",
  // `seven_day_statements` is written by the `recruiting` module (module default `recruitment`) and
  // its write lists exactly rolesThatManage("roster"); 0236 says it "takes the fleet lifecycle
  // roles", and `canWriteDriverLifecycle()` in auth.ts is literally canManageSection(role,"roster").
  seven_day_statements: "roster",
};

/** The section a table's policies are checked against: its own override, else its module's default. */
function sectionForTable(manifest, table) {
  if (table in TABLE_SECTIONS) return TABLE_SECTIONS[table];
  const module = manifest.tables[table]?.module;
  return module ? MODULE_SECTIONS[module] : undefined;
}

function parseMatrix() {
  const src = readFileSync(join(ROOT, "packages", "shared", "src", "auth.ts"), "utf8");
  const block = src.match(/const SECTION_ACCESS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("SECTION_ACCESS literal not found in packages/shared/src/auth.ts — gate cannot check anything; fix the parser with the file");
  const matrix = {};
  for (const row of block[1].matchAll(/^\s*(\w+):\s*\{([^}]*)\},?\s*$/gm)) {
    const [, role, cells] = row;
    matrix[role] = {};
    for (const cell of cells.matchAll(/(\w+):\s*"(none|view|manage)"/g)) matrix[role][cell[1]] = cell[2];
  }
  const roles = Object.keys(matrix);
  if (roles.length < 7) throw new Error(`SECTION_ACCESS parse found only ${roles.length} roles — parser or matrix shape changed; fix together`);
  return matrix;
}

const setsEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function expectedSets(matrix, section) {
  const manage = new Set(Object.keys(matrix).filter((r) => matrix[r][section] === "manage"));
  const view = new Set(Object.keys(matrix).filter((r) => matrix[r][section] !== "none"));
  return { manage, view };
}

function checkNewPolicies(matrix, manifest, migrationsDir) {
  const errors = [];
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    const num = Number(f.slice(0, 4));
    if (!Number.isFinite(num) || num <= SQL_BOUNDARY) continue;
    const raw = readFileSync(join(migrationsDir, f), "utf8");
    if (/section-policy-waiver:/.test(raw)) continue;
    const s = raw.replace(/--[^\n]*/g, "");
    // pair each role list with the nearest preceding "on <table>" so the section can be derived
    for (const m of s.matchAll(/create\s+policy\s+\S+\s+on\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)[\s\S]*?(?=create\s+policy|$)/gi)) {
      const table = m[1].toLowerCase();
      const body = m[0];
      const lists = [...body.matchAll(/auth_role\(\)\s+in\s+\(([^)]*)\)/gi)];
      if (!lists.length) continue;
      const module = manifest.tables[table]?.module;
      const section = sectionForTable(manifest, table);
      for (const l of lists) {
        const roles = new Set([...l[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
        if (!section) {
          errors.push(`${f}: policy on ${table} names roles but module ${module ?? "?"} maps to no section — add a "-- section-policy-waiver: <reason>" or extend MODULE_SECTIONS`);
          continue;
        }
        const { manage, view } = expectedSets(matrix, section);
        if (!setsEqual(roles, manage) && !setsEqual(roles, view))
          errors.push(
            `${f}: policy on ${table} lists [${[...roles].sort().join(", ")}] but section "${section}" derives manage=[${[...manage].sort().join(", ")}] view=[${[...view].sort().join(", ")}] — use the derived set or waive with a reason`,
          );
      }
    }
  }
  return errors;
}

function selfTest(matrix, manifest) {
  const fails = [];
  const anySection = Object.values(MODULE_SECTIONS).find(Boolean);
  const { manage } = expectedSets(matrix, anySection);
  if (!manage.has("admin")) fails.push("matrix parse looks wrong — admin does not manage " + anySection);
  // policy detector: a wrong role list on a sectioned table must mismatch both derived sets
  const table = Object.keys(manifest.tables).find((t) => MODULE_SECTIONS[manifest.tables[t].module]);
  const wrong = new Set(["driver"]);
  const sec = sectionForTable(manifest, table);
  const exp = expectedSets(matrix, sec);
  if (setsEqual(wrong, exp.manage) || setsEqual(wrong, exp.view)) fails.push("policy detector cannot fire — ['driver'] equals a derived set");

  // The TABLE_SECTIONS override must actually override, and must name a section the matrix knows.
  // Without this, a typo in the map would silently fall back to the module default and the gate
  // would check `vehicles` against the roster section — passing, while checking the wrong thing.
  for (const [t, want] of Object.entries(TABLE_SECTIONS)) {
    if (!(t in manifest.tables)) { fails.push(`TABLE_SECTIONS names ${t}, which is not a live table`); continue; }
    if (sectionForTable(manifest, t) !== want) fails.push(`TABLE_SECTIONS override for ${t} did not take effect`);
    const roleWithMatrix = Object.keys(matrix)[0];
    if (!(want in matrix[roleWithMatrix])) fails.push(`TABLE_SECTIONS maps ${t} to "${want}", which is not a section in SECTION_ACCESS`);
    if (sectionForTable(manifest, t) === MODULE_SECTIONS[manifest.tables[t].module])
      fails.push(`TABLE_SECTIONS entry for ${t} is redundant — it equals its module default`);
  }
  return fails;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "table-modules.json"), "utf8"));
for (const mod of new Set(Object.values(manifest.tables).map((v) => v.module)))
  if (!(mod in MODULE_SECTIONS)) { console.error(`✗ module ${mod} missing from MODULE_SECTIONS`); process.exit(1); }

const matrix = parseMatrix();

if (process.argv.includes("--self-test")) {
  const fails = selfTest(matrix, manifest);
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ section-policies self-test — matrix parses, policy detector can fire.");
  process.exit(0);
}

const errors = checkNewPolicies(matrix, manifest, MIGRATIONS);
if (errors.length) {
  console.error(`✗ ${errors.length} section-policy violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ section policies ok — matrix (${Object.keys(matrix).length} roles × ${Object.keys(Object.values(matrix)[0]).length} sections) parsed from auth.ts; new-migration role lists derive from it.`,
);
