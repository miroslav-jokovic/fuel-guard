#!/usr/bin/env node
/**
 * Fitness function — no table ships without a producer.
 *
 * The 2026-08-26 audit found four tables merged two days earlier with zero application code
 * (`financial_entries` + three `mcleod_*` staging tables), a table dead since 0097 that three
 * roster FKs still point at (`terminals`), and two more dead since the platform's first weeks
 * (`ai_verifications`, `import_rows`). Schema that nothing writes is not infrastructure, it is a
 * promise nobody is keeping — and the reader who finds it cannot tell the difference. This gate
 * makes the promise explicit: a table is either written somewhere, or it is on the pinned waiver
 * list below with a reason and a plan (docs/ARCHITECTURE.md §6, D-ARC3).
 *
 * "Producer" evidence, either of:
 *   - a supabase-js write or read in non-test application source: `.from("<table>")` — reads count
 *     because a read-only projection fed by an RPC (e.g. `org_usage_month`) is still alive;
 *   - DML inside a migration-defined function body: `insert into` / `update` / `delete from`
 *     <table> — this is how RPC-fed tables (`card_write_counters`, `anomaly_transitions`) are
 *     reached without ever appearing in a `.from()`.
 * FK `references`, policies, and index DDL are NOT evidence — `terminals` has all three and is dead.
 *
 * The waiver list may only shrink, or grow with a written justification in the same commit —
 * the check-file-size.mjs convention.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");

// Tables allowed to exist without a producer, each with the reason it is still pinned.
// Ratchet: entries leave when the table gains a producer or gets dropped; additions need a
// justification in the commit that adds them.
const WAIVERS = new Map([
  ["financial_entries", "0257 shipped schema-first; McLeod ingestion is the committed next build (FINANCIAL-STORE-PLAN)"],
  ["mcleod_settlements", "0257 staging for the financial-store ingestion, same plan as financial_entries"],
  ["mcleod_ap_vouchers", "0257 staging for the financial-store ingestion, same plan as financial_entries"],
  ["mcleod_billing", "0257 staging for the financial-store ingestion, same plan as financial_entries"],
  ["import_rows", "the ingestion audit trail 0007 promised and nobody wired — drop or build in the manual-uploads carve-out"],
]);

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;
const DROP_RE = /drop\s+table\s+(?:if\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;

const live = new Map(); // table → migration that created it
let allSql = "";
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  allSql += `\n${sql}`;
  for (const m of sql.matchAll(CREATE_RE)) if (!live.has(m[1].toLowerCase())) live.set(m[1].toLowerCase(), f);
  for (const m of sql.matchAll(DROP_RE)) live.delete(m[1].toLowerCase());
}

// Application source: every .from("<table>") in non-test, non-generated TS/Vue.
const SCAN_ROOTS = ["apps", "packages"].map((d) => join(ROOT, d));
const fromRefs = new Set();
const FROM_RE = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".expo" || name === "ios" || name === "android") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|vue|mjs)$/.test(name) || /\.test\.|\.spec\./.test(name)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(FROM_RE)) fromRefs.add(m[1]);
  }
}
for (const r of SCAN_ROOTS) walk(r);

// DML in migration function bodies reaches RPC-fed tables.
const dmlRefs = new Set();
for (const m of allSql.matchAll(/insert\s+into\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi)) dmlRefs.add(m[1].toLowerCase());
for (const m of allSql.matchAll(/update\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+set\s/gi)) dmlRefs.add(m[1].toLowerCase());
for (const m of allSql.matchAll(/delete\s+from\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi)) dmlRefs.add(m[1].toLowerCase());

const orphans = [...live.entries()].filter(([t]) => !fromRefs.has(t) && !dmlRefs.has(t) && !WAIVERS.has(t));
const stale = [...WAIVERS.keys()].filter((t) => !live.has(t) || fromRefs.has(t) || dmlRefs.has(t));

if (stale.length) {
  console.error(`✗ ${stale.length} waiver(s) are stale — the table gained a producer or was dropped. Ratchet down:`);
  for (const t of stale) console.error(`   ${t}`);
  process.exit(1);
}
if (orphans.length) {
  console.error(`✗ ${orphans.length} table(s) have no producer anywhere:`);
  for (const [t, f] of orphans) console.error(`   ${t}  (created in ${f})`);
  console.error(
    "  A table needs application code that writes it (or an RPC whose body does) in the same PR" +
      " that merges its migration — or a pinned waiver here naming the plan that owes the producer.",
  );
  process.exit(1);
}
console.log(
  `✓ table producers ok — ${live.size} live tables, ${live.size - WAIVERS.size} produced, ${WAIVERS.size} waived pending their named plans.`,
);
