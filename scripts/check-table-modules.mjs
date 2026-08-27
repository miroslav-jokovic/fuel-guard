#!/usr/bin/env node
/**
 * Fitness function — every table has exactly one owning module and a declared layer (D-SEP2,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; D-ARC3, docs/ARCHITECTURE.md §3).
 *
 * The 2026-08-27 audit measured what prose ownership costs: 537 cross-owner table access sites
 * under a green build, ~60 write sites outside their owner's directory a year after "only the
 * owner writes it" was written down, and 63 of 258 migrations spanning more than one module's
 * tables. `scripts/table-modules.json` makes ownership machine-readable; this gate makes it
 * binding. Three checks:
 *
 *   1. Manifest completeness — every live table (computed from migrations, comments stripped;
 *      the naive regex in older gates counted "-- Rollback: drop table x" comments as drops and
 *      silently lost efs_soap_credentials/efs_soap_client_certs) appears in the manifest, and
 *      the manifest carries no dead tables. Both directions ratchet.
 *   2. Writer paths — every write site pinned in scripts/table-writers.json lives under its
 *      owner's module directory (apps/api/src/modules/<owner>/), or is pinned in the
 *      grandfather list below. The list may only shrink — the check-file-size.mjs convention.
 *      A NEW out-of-owner writer is a deliberate act: either the code moves into the owner, or
 *      the owner exports an interface and the writer calls that instead.
 *   3. Cross-module migrations — a migration numbered above 0260 whose DDL/DML touches tables
 *      of more than one module fails unless it carries a `-- cross-module-waiver:` line naming
 *      the reason. The 63 existing offenders (mostly merge_driver's eight re-issues, retired by
 *      program step P2.5) are grandfathered by the numeric boundary, not by name.
 *
 * `--self-test` proves each detector can fire (fuel-spend working rule: a gate that cannot fail
 * is not a gate).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const CROSS_MODULE_BOUNDARY = 260; // migrations ≤ this predate the gate; the plan retires the worst offender (merge_driver) at P2.5

// Out-of-owner write sites measured 2026-08-27 (each is either an uncarved module's expected
// home, or a violation the program plan names a step for). Format: "<table> <- <path>".
// Ratchet: entries leave when the writer moves into the owner or calls an owner interface;
// additions need a written justification in the same commit.
const GRANDFATHERED_WRITERS = new Set([
  // 70 sites measured 2026-08-27 (generated from table-writers.json vs the manifest, not
  // hand-typed). Groups: uncarved-module homes (routing/orchestration, P1.6-P1.8), flat
  // services//lib/ writers (P1.1-P1.4), browser writers awaiting API endpoints (P2.1+),
  // cross-module writes with a named tolerance (anomalies->fuel is D-ARC3's pinned
  // exception) or a program step, admin-api's platform writes (own carve-out decision),
  // and one-shot scripts (delete candidates).
  "anomaly_thresholds <- apps/web/src/features/settings/useThresholds.ts",
  "audit_logs <- apps/admin-api/src/lib/impersonation.ts",
  "audit_logs <- apps/api/src/lib/audit.ts",
  "declined_transactions <- apps/api/src/modules/anomalies/declinedScoring.ts",
  "declined_transactions <- apps/api/src/modules/efs/services/efsIngestReject.ts",
  "documents <- apps/api/src/modules/psp/pspOrder.ts",
  "documents <- apps/api/src/modules/recruiting/applicationPdf/file.ts",
  "driver_authorizations <- apps/api/src/scripts/seedPspQaDrivers.ts",
  "driver_performance_settings <- apps/web/src/features/drivers/useDriverPerformanceSettings.ts",
  "driver_time_off <- apps/api/src/modules/mcleod/tmsIngest.ts",
  "driver_vehicle_assignments <- apps/api/src/modules/idle/idleSync.ts",
  "driver_vehicle_assignments <- apps/api/src/modules/samsara/samsaraVehicleSync.ts",
  "drivers <- apps/api/src/modules/efs/services/efsIngest.ts",
  "drivers <- apps/api/src/modules/fuel/driverAttribution.ts",
  "drivers <- apps/api/src/modules/org/routes/invites.ts",
  "drivers <- apps/api/src/modules/org/routes/members.ts",
  "drivers <- apps/api/src/modules/samsara/hosSync.ts",
  "drivers <- apps/api/src/modules/samsara/samsaraDriverSync.ts",
  "drivers <- apps/api/src/scripts/seedPspQaDrivers.ts",
  "drivers <- apps/web/src/composables/useDrivers.ts",
  "efs_soap_credentials <- apps/api/src/scripts/backfillEfsSoapPasswords.ts",
  "fuel_discount_rules <- apps/web/src/features/fueling/useDiscountRules.ts",
  "fuel_plans <- apps/api/src/routes/fueling/plans.ts",
  "fuel_plans <- apps/api/src/services/fuelPlanHistory.ts",
  "fuel_transactions <- apps/api/src/modules/anomalies/anomalyFlagReconcile.ts",
  "fuel_transactions <- apps/api/src/modules/anomalies/scoring/context.ts",
  "fuel_transactions <- apps/api/src/modules/anomalies/scoring/scoreTransaction.ts",
  "fuel_transactions <- apps/api/src/modules/efs/services/efsIngest.ts",
  "fuel_transactions <- apps/api/src/modules/efs/services/efsIngestShared.ts",
  "fuel_transactions <- apps/api/src/modules/efs/services/efsSync.ts",
  "fuel_transactions <- apps/api/src/modules/org/routes/audit.ts",
  "fuel_transactions <- apps/web/src/features/fuel/useFuelLog.ts",
  "geocode_cache <- apps/api/src/modules/posted-prices/pilotPriceIngest.ts",
  "geocode_cache <- apps/api/src/modules/posted-prices/roadRangerIngest.ts",
  // fuel_stations: collector->core direct writes, same posture as mcleod's load ingest today.
  // Added at the posted-prices carve-out (P1.5) — previously invisible because the scrapers
  // lived INSIDE fuel. The fuel station-upsert interface is the P6.1 burn-down that removes them.
  "fuel_stations <- apps/api/src/modules/posted-prices/kwikTripIngest.ts",
  "fuel_stations <- apps/api/src/modules/posted-prices/lovesIngest.ts",
  "fuel_stations <- apps/api/src/modules/posted-prices/pilotLocationsIngest.ts",
  "fuel_stations <- apps/api/src/modules/posted-prices/pilotPriceIngest.ts",
  "fuel_stations <- apps/api/src/modules/posted-prices/roadRangerIngest.ts",
  "geocode_cache <- apps/api/src/services/geocode.ts",
  "idle_settings <- apps/web/src/features/fleet/useIdleSettings.ts",
  "integration_credentials <- apps/api/src/modules/samsara/lib/samsaraToken.ts",
  "integration_credentials <- apps/api/src/modules/samsara/samsaraScheduler.ts",
  "invites <- apps/api/src/modules/roster/routes/drivers.ts",
  "load_events <- apps/api/src/modules/mcleod/tmsLoadIngest.ts",
  "load_stops <- apps/api/src/modules/mcleod/tmsLoadIngest.ts",
  "loads <- apps/api/src/modules/mcleod/tmsLoadIngest.ts",
  "memberships <- apps/api/src/modules/roster/driverCredentials.ts",
  "org_integrations <- apps/admin-api/src/lib/members.ts",
  "org_integrations <- apps/api/src/modules/mcleod/routes/tmsRosterMaster.ts",
  "org_integrations <- apps/api/src/modules/mcleod/tmsIngest.ts",
  "org_modules <- apps/admin-api/src/lib/orgs.ts",
  "organizations <- apps/web/src/composables/useOrgSettings.ts",
  "platform_admins <- apps/admin-api/src/lib/platformAdmins.ts",
  "platform_audit_log <- apps/admin-api/src/lib/audit.ts",
  "qualification_records <- apps/api/src/modules/psp/pspImport.ts",
  "qualification_records <- apps/api/src/modules/psp/pspOrder.ts",
  "route_fuel_settings <- apps/api/src/routes/fueling/networks.ts",
  "route_fuel_settings <- apps/web/src/composables/useRouteFuelSettings.ts",
  "route_geometries <- apps/api/src/services/routeGeometry.ts",
  "seven_day_statements <- apps/api/src/modules/roster/routes/sevenDay.ts",
  "support_impersonation_grants <- apps/admin-api/src/lib/impersonation.ts",
  "trailers <- apps/api/src/modules/samsara/samsaraTrailerSync.ts",
  "trailers <- apps/web/src/composables/useTrailers.ts",
  "vehicles <- apps/api/src/modules/anomalies/scoring/learnVehicle.ts",
  "vehicles <- apps/api/src/modules/anomalies/scoring/persist.ts",
  "vehicles <- apps/api/src/modules/idle/idleCapabilitySync.ts",
  "vehicles <- apps/api/src/modules/samsara/samsaraVehicleSync.ts",
  "vehicles <- apps/web/src/composables/useDrivers.ts",
  "vehicles <- apps/web/src/composables/useVehicles.ts",
  "vehicles <- apps/web/src/features/fleet/useVehicleSetupImport.ts",
]);

const stripSql = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;
const DROP_RE = /drop\s+table\s+(?:if\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;

function liveTables(migrationsDir) {
  const live = new Map();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = stripSql(readFileSync(join(migrationsDir, f), "utf8"));
    for (const m of sql.matchAll(CREATE_RE)) if (!live.has(m[1].toLowerCase())) live.set(m[1].toLowerCase(), f);
    for (const m of sql.matchAll(DROP_RE)) live.delete(m[1].toLowerCase());
  }
  return live;
}

function checkManifest(live, manifest) {
  const errors = [];
  const tables = manifest.tables ?? {};
  for (const t of live.keys()) if (!tables[t]) errors.push(`table ${t} is live but absent from scripts/table-modules.json — assign it a module and layer`);
  for (const t of Object.keys(tables)) if (!live.has(t)) errors.push(`manifest entry ${t} names a table that no longer exists — remove it`);
  for (const [t, v] of Object.entries(tables)) {
    if (!v?.module) errors.push(`manifest entry ${t} has no module`);
    if (!["raw", "core", "derived", "infra"].includes(v?.layer)) errors.push(`manifest entry ${t} has invalid layer ${v?.layer}`);
  }
  return errors;
}

function checkWriters(manifest, writers, grandfathered) {
  const errors = [];
  const usedGrandfather = new Set();
  for (const [table, paths] of Object.entries(writers)) {
    const owner = manifest.tables?.[table]?.module;
    if (!owner) continue; // manifest completeness is check 1's job
    const ownerPrefix = `apps/api/src/modules/${owner}/`;
    for (const p of paths) {
      if (p.startsWith(ownerPrefix)) continue;
      const key = `${table} <- ${p}`;
      if (grandfathered.has(key)) { usedGrandfather.add(key); continue; }
      errors.push(`${table} is written from ${p}, outside its owner ${owner} — move the code, call an owner interface, or (with written justification) grandfather it`);
    }
  }
  for (const key of grandfathered) if (!usedGrandfather.has(key)) errors.push(`stale grandfather entry (writer moved or died — ratchet down): ${key}`);
  return errors;
}

function migrationTouches(sql, manifest) {
  const touched = new Set();
  const names = new Set(Object.keys(manifest.tables ?? {}));
  const patterns = [
    CREATE_RE,
    /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi,
    /insert\s+into\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi,
    /update\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+set\s/gi,
    /delete\s+from\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi,
    /create\s+policy\s+.*?\son\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi,
    /comment\s+on\s+table\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi,
  ];
  const s = stripSql(sql);
  for (const re of patterns) for (const m of s.matchAll(re)) if (names.has(m[1].toLowerCase())) touched.add(m[1].toLowerCase());
  return touched;
}

function checkCrossModule(migrationsDir, manifest) {
  const errors = [];
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    const num = Number(f.slice(0, 4));
    if (!Number.isFinite(num) || num <= CROSS_MODULE_BOUNDARY) continue;
    const raw = readFileSync(join(migrationsDir, f), "utf8");
    if (/cross-module-waiver:/.test(raw)) continue;
    const modules = new Set([...migrationTouches(raw, manifest)].map((t) => manifest.tables[t].module));
    if (modules.size > 1)
      errors.push(`${f} touches tables of ${modules.size} modules (${[...modules].sort().join(", ")}) with no "-- cross-module-waiver: <reason>" line`);
  }
  return errors;
}

function selfTest(manifest) {
  const fails = [];
  // 1. completeness detector fires on a live table the manifest lacks
  const fakeLive = new Map([...Object.keys(manifest.tables).map((t) => [t, "0001"]), ["ghost_table", "9999"]]);
  if (!checkManifest(fakeLive, manifest).length) fails.push("completeness detector did not fire");
  // 2. writer detector fires on an out-of-owner path
  const anyTable = Object.keys(manifest.tables)[0];
  if (!checkWriters(manifest, { [anyTable]: ["apps/api/src/services/rogue.ts"] }, new Set()).length) fails.push("writer detector did not fire");
  // 3. cross-module detector fires on a two-module migration without waiver
  const byModule = {};
  for (const [t, v] of Object.entries(manifest.tables)) byModule[v.module] ??= t;
  const [a, b] = Object.values(byModule);
  const touched = migrationTouches(`alter table ${a} add column x int; alter table ${b} add column y int;`, manifest);
  const mods = new Set([...touched].map((t) => manifest.tables[t].module));
  if (mods.size < 2) fails.push("cross-module detector did not fire");
  return fails;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "table-modules.json"), "utf8"));

if (process.argv.includes("--self-test")) {
  const fails = selfTest(manifest);
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ table-modules self-test — all three detectors fire on synthetic violations.");
  process.exit(0);
}

const writers = JSON.parse(readFileSync(join(ROOT, "scripts", "table-writers.json"), "utf8"));
const live = liveTables(MIGRATIONS);
const errors = [
  ...checkManifest(live, manifest),
  ...checkWriters(manifest, writers, GRANDFATHERED_WRITERS),
  ...checkCrossModule(MIGRATIONS, manifest),
];
if (errors.length) {
  console.error(`✗ ${errors.length} table-module violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ table modules ok — ${live.size} live tables owned across ${new Set(Object.values(manifest.tables).map((v) => v.module)).size} modules, ${GRANDFATHERED_WRITERS.size} grandfathered writer sites pending their program steps.`,
);
