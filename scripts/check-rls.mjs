#!/usr/bin/env node
/**
 * Fitness function — no table ships without row-level security.
 *
 * PostgREST exposes the entire public schema to the anon/authenticated roles, so RLS is the ONLY wall
 * between tenants (and between the public internet and the data). A table with RLS enabled and no
 * policy is deny-all for client roles (service role bypasses RLS) — that is a valid, intentionally
 * locked-down state. A table with NO `enable row level security` anywhere is world-readable through the
 * API: that is a data leak waiting for a row, and this gate fails the build for it.
 *
 * Static check over supabase/migrations/*.sql: every `create table` must be matched by an
 * `alter table <name> enable row level security` in the same or any later migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "supabase", "migrations");

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const created = new Map(); // table → migration file that created it
const rlsEnabled = new Set();

const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
const RLS_RE = /alter\s+table\s+([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi;

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(CREATE_RE)) {
    const t = m[1].toLowerCase();
    if (!created.has(t)) created.set(t, f);
  }
  for (const m of sql.matchAll(RLS_RE)) rlsEnabled.add(m[1].toLowerCase());
}

const missing = [...created.entries()].filter(([t]) => !rlsEnabled.has(t));

if (missing.length) {
  console.error(`✗ ${missing.length} table(s) created without row level security:`);
  for (const [t, f] of missing) console.error(`   ${t}  (created in ${f})`);
  console.error(
    "  Every table must have `alter table <name> enable row level security` — with org-scoped policies" +
      " for client access, or NO policies for service-role-only tables (deny-all).",
  );
  process.exit(1);
}
console.log(`✓ rls ok — all ${created.size} created tables have row level security enabled.`);
