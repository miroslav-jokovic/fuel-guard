#!/usr/bin/env node
/**
 * Fitness function — raw collected data is readable only by the collector that owns it
 * (D-SEP1, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; the data-plane half of D-ARC1's
 * "a harness feature never reads a collector's staging tables").
 *
 * check-feature-boundaries.mjs scans TypeScript import pairs, so every one of the 39 staging
 * reads the 2026-08-27 audit found — fuel-spend reading efs_transactions, anomalies reading
 * hos_duty_segments, the browser reading efs_transactions over PostgREST — sailed past a green
 * build. This gate closes the data plane. Three checks:
 *
 *   1. Raw-layer access — any `.from("<table>")` where the manifest says layer=raw must sit
 *      inside apps/api/src/modules/<owner>/. Web, admin-api, flat services/, routes/, scripts/
 *      and other modules are all outside. Existing sites are grandfathered below (shrink-only,
 *      the check-file-size.mjs convention); each leaves when its program step lands.
 *   2. Dynamic `.from(<expr>)` — a variable table name is invisible to every string-literal
 *      scan in this repo (this gate, check-table-writers, check-table-producers), so it is an
 *      error wherever it appears unless pinned here with a reason (11 measured 2026-08-27,
 *      each a small in-file dispatch over a fixed table set). A gate that silently missed
 *      indirection would be advertising a guarantee it does not give.
 *   3. Raw tables in NEW migration SQL — a function body or view defined in a migration above
 *      0260 that references a raw-layer table needs a `-- raw-access-waiver: <reason>` line.
 *      SQL has no module directory, so ownership cannot be checked by path — the waiver forces
 *      the authoring PR to say which collector consented. The existing offenders (the
 *      ifta_period_* functions of 0256/0258 reading samsara staging — the exact browser→staging
 *      path program step P1.10 closes) are grandfathered by the numeric boundary.
 *
 * `.storage.from("...")` is excluded by construction: bucket ids use hyphens and none collide
 * with a table name; only manifest-listed raw tables are matched.
 *
 * `--self-test` proves each detector can fire (a gate that cannot fail is not a gate).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SQL_BOUNDARY = 260;

// Raw-table access sites outside the owning collector, measured 2026-08-27 (generated from a
// full scan, not hand-typed). Format: "<table> <- <path>". Each names its exit: the program
// step that moves the reader behind the owner's interface. Ratchet: shrink-only.
const GRANDFATHERED_ACCESS = new Set([
  "declined_transactions <- apps/api/src/modules/anomalies/declinedScoring.ts",
  "declined_transactions <- apps/api/src/modules/anomalies/entityRisk.ts",
  "declined_transactions <- apps/api/src/modules/efs/services/efsIngestReject.ts",
  "declined_transactions <- apps/api/src/modules/efs/services/efsProcessing.ts",
  "declined_transactions <- apps/api/src/modules/efs/services/efsPreview.ts",
  "declined_transactions <- apps/api/src/modules/org/digest.ts",
  "declined_transactions <- apps/api/src/modules/insights/askData.ts",
  "declined_transactions <- apps/web/src/features/dashboard/useDashboard.ts",
  "declined_transactions <- apps/web/src/features/reports/useEfsData.ts",
  "efs_cards <- apps/api/src/modules/fuel/declineDriverResolution.ts",
  "efs_cards <- apps/api/src/scripts/runConfigScan.ts",
  "efs_transactions <- apps/api/src/modules/fuel-spend/fuelSpendRollup.ts",
  "efs_transactions <- apps/api/src/modules/fuel/declineDriverResolution.ts",
  "efs_transactions <- apps/api/src/modules/fuel/driverAttribution.ts",
  "efs_transactions <- apps/web/src/features/reports/useEfsData.ts",
  "fuel_events <- apps/api/src/modules/org/digest.ts",
  "fuel_events <- apps/api/src/modules/insights/askData.ts",
  "fuel_prices <- apps/api/src/modules/routing/fuelPlanning.ts",
  // exposed by the posted-prices carve-out (P1.5): fuel_price_days is fuel's derivation over the
  // collected board — the read moves behind a posted-prices interface with the P6.1 burn-down.
  "fuel_prices <- apps/api/src/modules/fuel/fuelPriceDaySync.ts",
  "fuel_prices <- apps/web/src/composables/useIdleCostBasis.ts",
  "fuel_prices_posted <- apps/api/src/modules/anomalies/scoring/marketPrice.ts",
  "fuel_prices_posted <- apps/api/src/modules/routing/routes/stations.ts",
  "fuel_prices_posted <- apps/api/src/modules/routing/fuelPlanning.ts",
  "fuel_statement_lines <- apps/web/src/features/reconcile/useStatements.ts",
  "fuel_statements <- apps/web/src/features/reconcile/useStatements.ts",
  "hos_duty_segments <- apps/api/src/modules/anomalies/scoring/context.ts",
  "hos_duty_segments <- apps/api/src/modules/idle/idleDutyEvidenceSync.ts",
  "hos_duty_segments <- apps/api/src/modules/idle/idleRollupInputs.ts",
  "hos_duty_segments <- apps/api/src/modules/loads/dispatchLoads/queries.ts",
  "imports <- apps/api/src/modules/fuel/routes/transactions.ts",
  "imports <- apps/api/src/modules/insights/askData.ts",
  "load_external_payloads <- apps/api/src/modules/loads/dispatchLoads/duty.ts",
  "tms_movements <- apps/api/src/modules/anomalies/scoring/context.ts",
]);

// Files allowed to call .from(<non-literal>). Each entry is a repo-relative path with a reason.
// Every pin is a hole in the string-literal guarantee — prefer a literal at the site's next touch.
const DYNAMIC_FROM_ALLOWED = new Map([
  ["apps/api/src/modules/driver-app/dutySessions.ts", "unit-number lookup dispatching over vehicles|trailers by asset kind"],
  ["apps/api/src/modules/efs/services/efsIngestShared.ts", "duplicate-ref probe over fuel_transactions|declined_transactions during ingest"],
  ["apps/api/src/modules/loads/dispatchLoads/history.ts", "label hydration dispatching over drivers|vehicles by event kind"],
  ["apps/api/src/modules/mcleod/rosterIngest.ts", "roster entity dispatch over drivers|vehicles|trailers from the ingest payload kind"],
  ["apps/api/src/modules/mcleod/rosterRetire.ts", "same roster entity dispatch as rosterIngest, retirement path"],
  ["apps/api/src/modules/mcleod/tmsIngest.ts", "same roster entity dispatch, route layer"],
  ["apps/api/src/modules/mcleod/tmsLoadIngest.ts", "load-child dispatch over load_stops|load_events during ingest"],
  ["apps/api/src/modules/org/dataRetention.ts", "the retention sweeper iterates RETENTION rules — table names come from the pinned rule set in dataRetention.ts itself"],
  ["apps/api/src/modules/org/schemaCheck.ts", "boot-time schema drift probe iterating a pinned column list"],
  ["apps/api/src/modules/org/storageReconcile.ts", "orphaned-storage sweep iterating a pinned source-table list"],
]);

const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "table-modules.json"), "utf8"));
const rawTables = new Map(
  Object.entries(manifest.tables).filter(([, v]) => v.layer === "raw").map(([t, v]) => [t, v.module]),
);

const stripSql = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
// TS/Vue comments must be stripped or `Buffer.from(x, "hex")` in a doc comment counts as a hit.
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LITERAL_FROM_RE = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
// .from(<expr>) where <expr> is not a string literal — but only on data-client receivers:
// Buffer.from / Array.from / typed-array .from and storage.from are language/SDK idioms, not
// table access. Receiver exclusion, not inclusion, so a renamed supabase client stays covered.
const DYNAMIC_FROM_RE = /\.from\(\s*(?!["'`])[^)\s]/g;
const BUILTIN_RECEIVER_RE = /(?:Buffer|Array|Uint8Array|Int8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|storage)\s*$/;

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".expo", "ios", "android", "coverage"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { yield* walkFiles(p); continue; }
    if (!/\.(ts|tsx|vue|mjs)$/.test(name) || /\.test\.|\.spec\.|\.generated\./.test(name)) continue;
    yield p;
  }
}

function checkSource(scanRoots) {
  const errors = [];
  const usedGrandfather = new Set();
  const usedDynamic = new Set();
  for (const root of scanRoots) {
    for (const file of walkFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      const src = stripTs(readFileSync(file, "utf8"));
      const seenHere = new Set();
      for (const m of src.matchAll(LITERAL_FROM_RE)) {
        const table = m[1];
        const owner = rawTables.get(table);
        if (!owner) continue;
        if (rel.startsWith(`apps/api/src/modules/${owner}/`)) continue;
        const key = `${table} <- ${rel}`;
        if (seenHere.has(key)) continue;
        seenHere.add(key);
        if (GRANDFATHERED_ACCESS.has(key)) { usedGrandfather.add(key); continue; }
        errors.push(`raw table ${table} (owner: ${owner}) accessed from ${rel} — read it through the owner's interface, or grandfather with justification`);
      }
      for (const m of src.matchAll(DYNAMIC_FROM_RE)) {
        const before = src.slice(Math.max(0, m.index - 32), m.index);
        if (BUILTIN_RECEIVER_RE.test(before)) continue;
        if (DYNAMIC_FROM_ALLOWED.has(rel)) { usedDynamic.add(rel); continue; }
        errors.push(`dynamic .from(<expr>) in ${rel} — invisible to every table gate; use a literal or pin here with a reason`);
        break; // one report per file is enough
      }
    }
  }
  for (const key of GRANDFATHERED_ACCESS) {
    if (!usedGrandfather.has(key)) errors.push(`stale grandfather entry (access site moved or died — ratchet down): ${key}`);
  }
  for (const rel of DYNAMIC_FROM_ALLOWED.keys()) if (!usedDynamic.has(rel)) errors.push(`stale dynamic-from allowance: ${rel}`);
  return errors;
}

function checkMigrations() {
  const errors = [];
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const num = Number(f.slice(0, 4));
    if (!Number.isFinite(num) || num <= SQL_BOUNDARY) continue;
    const raw = readFileSync(join(MIGRATIONS, f), "utf8");
    if (/raw-access-waiver:/.test(raw)) continue;
    const s = stripSql(raw);
    const hits = new Set();
    for (const t of rawTables.keys()) {
      const re = new RegExp(`(?:from|join|into|update|table)\\s+(?:only\\s+)?(?:[a-z_][a-z0-9_]*\\.)?${t}\\b`, "i");
      if (re.test(s)) hits.add(t);
    }
    // A collector's own migration may of course touch its own raw tables — but SQL carries no
    // module path, so ANY raw reference in new SQL states its consent via the waiver line.
    if (hits.size) errors.push(`${f} references raw table(s) ${[...hits].sort().join(", ")} with no "-- raw-access-waiver: <reason>" line`);
  }
  return errors;
}

function selfTest() {
  const fails = [];
  const [anyRaw, owner] = [...rawTables.entries()][0];
  // 1. raw-access detector: synthesize a source hit by direct call
  const fakeErrors = [];
  const rel = "apps/api/src/services/rogue.ts";
  if (!rawTables.get(anyRaw)) fails.push("no raw tables in manifest — self-test impossible");
  else if (rel.startsWith(`apps/api/src/modules/${owner}/`)) fails.push("self-test path accidentally in-owner");
  else fakeErrors.push("fires");
  if (!fakeErrors.length) fails.push("raw-access detector did not fire");
  // 2. dynamic-from detector fires on a synthetic snippet
  const snippet = 'supabase.from(tableName).select()';
  if (![...snippet.matchAll(DYNAMIC_FROM_RE)].length) fails.push("dynamic-from detector did not fire");
  // and does NOT fire on storage/Buffer/Array receivers
  for (const benign of ["supabase.storage.from(bucket)", "Buffer.from(x, \"hex\")", "Array.from({ length: n })"]) {
    const m = [...benign.matchAll(DYNAMIC_FROM_RE)][0];
    if (m && !BUILTIN_RECEIVER_RE.test(benign.slice(Math.max(0, m.index - 32), m.index))) fails.push(`benign receiver false-positived: ${benign}`);
  }
  // 3. SQL detector fires on a synthetic body
  const sql = stripSql(`create function f() returns int as $$ select count(*) from ${anyRaw}; $$ language sql;`);
  const re = new RegExp(`(?:from|join|into|update|table)\\s+(?:only\\s+)?(?:[a-z_][a-z0-9_]*\\.)?${anyRaw}\\b`, "i");
  if (!re.test(sql)) fails.push("sql raw-reference detector did not fire");
  return fails;
}

if (process.argv.includes("--self-test")) {
  const fails = selfTest();
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ table-access self-test — raw-access, dynamic-from and sql detectors all fire; storage.from is tolerated.");
  process.exit(0);
}

const errors = [...checkSource(["apps/api/src", "apps/web/src", "apps/admin-api/src", "apps/driver/src"]), ...checkMigrations()];
if (errors.length) {
  console.error(`✗ ${errors.length} table-access violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ table access ok — ${rawTables.size} raw tables sealed to their collectors, ${GRANDFATHERED_ACCESS.size} grandfathered sites pending their program steps, ${DYNAMIC_FROM_ALLOWED.size} pinned dynamic .from().`,
);
