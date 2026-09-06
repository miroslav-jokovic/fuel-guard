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
  // Added with 0300 (P6, D-PERM11): a table belongs to the section whose PAGE edits it, and for these
  // three the module default named the wrong one while the policy's list named the right one.
  //
  // `idle_settings` is written by the `idle` module (module default `equipment`) but edited from the
  // Idling page — a safety surface — and its write lists exactly rolesThatManage("safety").
  idle_settings: "safety",
  // `route_fuel_settings` (module `routing`) and `fuel_discount_rules` (module `fuel`) are the fuel
  // planner's inputs, edited from Fuel Planning — a dispatch surface — and both write lists are
  // exactly rolesThatManage("dispatch"); Q-PERM10 had noticed the coincidence before it was a ruling.
  route_fuel_settings: "dispatch",
  fuel_discount_rules: "dispatch",
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

/**
 * Both spellings of a role list. Postgres renders `auth_role() in (a, b)` and
 * `auth_role() = any (array[a, b])` identically in pg_policy; the detector read only the first until
 * P6, and 0293 wrote all seventeen of its lists in the second — so the gate printed green having
 * read none of them (Q-PERM11). One regex, two alternatives, no preferred spelling.
 */
const ROLE_LIST = /auth_role\(\)\s*(?:in\s*\(([^)]*)\)|=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\))/gi;

/**
 * Every `create policy` in one migration's text, with its table, the role lists in its body, and
 * whether a per-policy waiver line precedes it. Comments are stripped BEFORE policies are read (so a
 * header cannot be mistaken for a call site) but waivers are read from the comments themselves, on
 * their own line, so a header that merely mentions the marker mid-sentence waives nothing — the trap
 * 0294's first draft fell into.
 */
export function extractPolicies(sql) {
  const waived = new Set([...sql.matchAll(/^\s*--\s*section-policy-waiver\(([a-z_][a-z0-9_]*)\):\s*\S/gim)].map((m) => m[1].toLowerCase()));
  const fileWaived = /^\s*--\s*section-policy-waiver:\s*\S/im.test(sql);
  const body = sql.replace(/--[^\n]*/g, "");
  const policies = [];
  for (const m of body.matchAll(/create\s+policy\s+"?([a-z_][a-z0-9_]*)"?\s+on\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)([\s\S]*?)(?=create\s+policy|$)/gi)) {
    const policy = m[1].toLowerCase();
    const table = m[2].toLowerCase();
    const lists = [...m[3].matchAll(ROLE_LIST)].map((l) =>
      new Set([...(l[1] ?? l[2]).matchAll(/'(\w+)'/g)].map((x) => x[1])),
    );
    policies.push({ policy, table, lists, waived: fileWaived || waived.has(policy) });
  }
  return policies;
}

/**
 * The policies the live schema actually holds, as far as migrations above the boundary define them:
 * the LATEST `create policy` for each (table, policy) wins, because an applied migration cannot be
 * edited and a superseded definition is dead text (D-PERM13). Files at or below the boundary are
 * grandfathered as before — but a policy they created and a later migration re-creates is checked,
 * which is how 0300 brought `ftxn_insert` (0004) and the two 0078 lists into scope.
 */
function latestPolicies(migrationsDir) {
  const latest = new Map();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    const num = Number(f.slice(0, 4));
    if (!Number.isFinite(num) || num <= SQL_BOUNDARY) continue;
    for (const p of extractPolicies(readFileSync(join(migrationsDir, f), "utf8"))) {
      latest.set(`${p.table}.${p.policy}`, { ...p, file: f });
    }
  }
  return [...latest.values()];
}

function checkNewPolicies(matrix, manifest, migrationsDir) {
  const errors = [];
  for (const { file: f, table, policy, lists, waived } of latestPolicies(migrationsDir)) {
    if (!lists.length || waived) continue;
    const module = manifest.tables[table]?.module;
    const section = sectionForTable(manifest, table);
    for (const roles of lists) {
      if (!section) {
        errors.push(`${f}: policy ${policy} on ${table} names roles but module ${module ?? "?"} maps to no section — add a "-- section-policy-waiver(${policy}): <reason>" line above it or extend MODULE_SECTIONS`);
        continue;
      }
      const { manage, view } = expectedSets(matrix, section);
      if (!setsEqual(roles, manage) && !setsEqual(roles, view))
        errors.push(
          `${f}: policy ${policy} on ${table} lists [${[...roles].sort().join(", ")}] but section "${section}" derives manage=[${[...manage].sort().join(", ")}] view=[${[...view].sort().join(", ")}] — use the derived set or waive it by name with a reason`,
        );
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

  // The extractor must read BOTH spellings, honour a per-policy waiver only on its own line, and let a
  // later definition supersede an earlier one — each of these was a way the gate went green having
  // read nothing (Q-PERM11, D-PERM13).
  const sample = `
    -- a header that talks about the section-policy-waiver: marker in passing
    create policy p_in on t1 for all using (auth_role() in ('admin', 'x'));
    create policy p_any on t1 for all using (auth_role() = any (array['admin','y']));
    -- section-policy-waiver(p_named): granted by name
    create policy p_named on t1 for all using (auth_role() in ('admin','z'));
  `;
  const got = extractPolicies(sample);
  const by = Object.fromEntries(got.map((p) => [p.policy, p]));
  if (!by.p_in || ![...by.p_in.lists[0] ?? []].includes("x")) fails.push("extractor does not read the `in (...)` spelling");
  if (!by.p_any || ![...by.p_any.lists[0] ?? []].includes("y")) fails.push("extractor does not read the `= any (array[...])` spelling");
  if (!by.p_named?.waived) fails.push("a per-policy waiver line does not waive its policy");
  if (by.p_in?.waived || by.p_any?.waived) fails.push("a header merely mentioning the marker waived the file");
  const superseded = new Map();
  for (const p of [...extractPolicies("create policy p on t for all using (auth_role() in ('admin','old'));"), ...extractPolicies("create policy p on t for all using (auth_role() in ('admin','new'));")])
    superseded.set(`${p.table}.${p.policy}`, p);
  if (![...superseded.get("t.p").lists[0]].includes("new")) fails.push("a later definition does not supersede an earlier one");

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
