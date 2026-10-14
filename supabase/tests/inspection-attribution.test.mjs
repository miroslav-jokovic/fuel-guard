// FuelGuard — who was driving at a roadside inspection, and the Samsara answers frozen around it
// (migration 0473, INSPECTION-CHALLENGE-PLAN.md IC5; D-IC4, D-IC7, D-IC8).
//
// Properties that would each fail quietly, because the engine would simply write a row nobody can trust:
//
//   0. ONE VOCABULARY. Every CHECK list equals its array in `roadsideAttributionContract.ts`, read back
//      from the APPLIED catalog — a value added on one side only is a build failure, not a refused insert.
//   1. A READING SAYS WHAT IT IS. Every row carries an engine version (a person's, the reading it
//      decided over); a person's row carries its decider and an engine row none. A driver, a basis and a confidence exist together and only for one driver.
//      An instant is a zone and both ends, or none of them.
//   2. ONE ENGINE READING PER VERSION. A second at the same version is refused (the backlog's guard
//      against two processes); a new version and any number of people's rows are not.
//   3. APPEND-ONLY, FOR THE SERVICE ROLE TOO (IA010), on both tables.
//   4. ONE ORG. A reading or a snapshot cannot name another carrier's inspection (composite FK), and a
//      snapshot's object must sit under its own org's prefix. RLS on, no policy: a browser reads nothing.
//   5. THE BUCKET. Private, 10 MB.
//
// Run:  node supabase/tests/inspection-attribution.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ATTRIBUTION_BASES,
  ATTRIBUTION_CONFIDENCES,
  ATTRIBUTION_LOCATION_CHECKS,
  ATTRIBUTION_OUTCOMES,
  ATTRIBUTION_SOURCES,
  ATTRIBUTION_ZONE_METHODS,
  EVIDENCE_KINDS,
  EVIDENCE_TEMPORAL_CLASSES,
} from "../../packages/shared/dist/index.js";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** The SQLSTATE a statement raised, or null when it succeeded. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
ok("0473 present", MIGRATIONS.some((f) => f.startsWith("0473_inspection_attribution")));
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── 0. one vocabulary ─────────────────────────────────────────────────────────────────────────────
const checkValues = async (table, column) => {
  const c = await one(
    `select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = 'c' and conname = $2`,
    [`public.${table}`, `${table}_${column}_check`]);
  return c ? [...c.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]) : null;
};
for (const [table, column, values] of [
  ["inspection_attributions", "source", ATTRIBUTION_SOURCES],
  ["inspection_attributions", "zone_method", ATTRIBUTION_ZONE_METHODS],
  ["inspection_attributions", "location_check", ATTRIBUTION_LOCATION_CHECKS],
  ["inspection_attributions", "outcome", ATTRIBUTION_OUTCOMES],
  ["inspection_attributions", "basis", ATTRIBUTION_BASES],
  ["inspection_attributions", "confidence", ATTRIBUTION_CONFIDENCES],
  ["inspection_evidence_snapshots", "kind", EVIDENCE_KINDS],
  ["inspection_evidence_snapshots", "temporal_class", EVIDENCE_TEMPORAL_CLASSES],
]) {
  const lits = await checkValues(table, column);
  ok(`${table}.${column}'s CHECK equals the shared contract`, values.length > 0 && JSON.stringify(lits) === JSON.stringify([...values]), JSON.stringify(lits));
}

// ── fixtures: one inspection each for two carriers, through the real feed and projection ─────────
const ORG = (await one(`insert into organizations (name) values ('Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('safety@x.test') returning id`)).id;
const inspectionOf = async (org, fmcsaId) => {
  const row = { inspection_id: fmcsaId, report_number: `R${fmcsaId}`, report_state: "LA", insp_date: "20260922", insp_start_time: "1304" };
  await one(`select * from fmcsa_snapshot_record($1, 'fx4q-ay7w', '1864495', $2::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`,
    [org, JSON.stringify([{ k: fmcsaId, p: row }])]);
  await one(`select * from roadside_project($1)`, [org]);
  return (await one(`select id from roadside_inspections where org_id = $1 and fmcsa_inspection_id = $2`, [org, Number(fmcsaId)])).id;
};
const INSP = await inspectionOf(ORG, "1001");
const THEIRS = await inspectionOf(OTHER, "2001");
ok("the fixtures project one inspection per carrier", Boolean(INSP && THEIRS));

const engineRow = {
  source: "engine", engine_version: "ic5.1", zone: "America/Chicago", zone_method: "gps",
  started_at: "2026-09-22T18:04:00Z", ended_at: "2026-09-22T18:27:00Z", location_check: "confirmed",
  outcome: "one_driver", samsara_driver_id: "53867066", samsara_driver_name: "GREGORY GRIGGS", basis: "bracketing", confidence: "high",
  decided_by: null, candidates: "[]",
};
const COLS = Object.keys(engineRow);
const attribute = (o = {}, org = ORG, insp = INSP) => {
  const r = { ...engineRow, ...o };
  return sqlstate(
    `insert into inspection_attributions (org_id, inspection_id, ${COLS.join(", ")}) values ($1, $2, ${COLS.map((_, i) => `$${i + 3}`).join(", ")})`,
    [org, insp, ...COLS.map((c) => r[c])]);
};

// ── 1. a reading says what it is ─────────────────────────────────────────────────────────────────
ok("an engine reading of one driver, bracketing, high, is accepted", (await attribute()) === null);
ok("an engine row without its version is refused", (await attribute({ engine_version: null, source: "engine" })) === "23502");
ok("a blank version is refused", (await attribute({ engine_version: "  " })) === "23514");
ok("an engine row naming a decider is refused", (await attribute({ engine_version: "ic5.2", decided_by: USER })) === "23514");
ok("a person's row without a decider is refused", (await attribute({ source: "person" })) === "23514");
ok("a person's row with a decider, over the reading it decided, is accepted", (await attribute({ source: "person", decided_by: USER })) === null);
ok("a person's row with no version is refused", (await attribute({ source: "person", engine_version: null, decided_by: USER })) === "23502");
ok("one driver without a driver is refused", (await attribute({ engine_version: "ic5.3", samsara_driver_id: null })) === "23514");
ok("a driver without a basis is refused", (await attribute({ engine_version: "ic5.3", basis: null })) === "23514");
ok("a basis without a confidence is refused", (await attribute({ engine_version: "ic5.3", confidence: null })) === "23514");
ok("several drivers with a driver named is refused", (await attribute({ engine_version: "ic5.3", outcome: "several_drivers" })) === "23514");
ok("several drivers with nobody named is accepted",
  (await attribute({ engine_version: "ic5.4", outcome: "several_drivers", samsara_driver_id: null, samsara_driver_name: null, basis: null, confidence: null })) === null);
ok("an instant with a zone but no ends is refused", (await attribute({ engine_version: "ic5.5", started_at: null, ended_at: null })) === "23514");
ok("an unresolved instant with no zone and no ends is accepted",
  (await attribute({ engine_version: "ic5.6", zone: null, started_at: null, ended_at: null, zone_method: "unresolved" })) === null);
ok("candidates that are not an array are refused", (await attribute({ engine_version: "ic5.7", candidates: '{"a":1}' })) === "23514");

// ── 2. one engine reading per version ────────────────────────────────────────────────────────────
ok("a second engine reading at the same version is refused", (await attribute()) === "23505");
ok("a person may add any number of readings over the same version",
  (await attribute({ source: "person", decided_by: USER })) === null);

// ── 3. append-only ───────────────────────────────────────────────────────────────────────────────
ok("an attribution cannot be updated", (await sqlstate(`update inspection_attributions set confidence = 'low' where org_id = $1`, [ORG])) === "IA010");
ok("an attribution cannot be deleted", (await sqlstate(`delete from inspection_attributions where org_id = $1`, [ORG])) === "IA010");

const snapshot = (o = {}, org = ORG, insp = INSP) => {
  const r = {
    kind: "gps_window", temporal_class: "contemporaneous", source_endpoint: "/fleet/vehicles/stats/history", request: '{"vehicleIds":"1"}',
    window_start: "2026-09-22T16:04:00Z", window_end: "2026-09-22T20:27:00Z", retrieved_at: "2026-10-14T15:00:00Z", http_status: 200,
    sha256: "a".repeat(64), byte_size: 10, storage_path: `${org}/${insp}/gps_window-${"a".repeat(64)}.json.gz`, item_count: 4, ...o,
  };
  const cols = Object.keys(r);
  return sqlstate(
    `insert into inspection_evidence_snapshots (org_id, inspection_id, ${cols.join(", ")}) values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")})`,
    [org, insp, ...cols.map((c) => r[c])]);
};
ok("a frozen answer is accepted", (await snapshot()) === null);
ok("a refusal (HTTP 403) is frozen like any answer", (await snapshot({ http_status: 403, item_count: 0 })) === null);
ok("a snapshot cannot be updated", (await sqlstate(`update inspection_evidence_snapshots set http_status = 500 where org_id = $1`, [ORG])) === "IA010");
ok("a snapshot cannot be deleted", (await sqlstate(`delete from inspection_evidence_snapshots where org_id = $1`, [ORG])) === "IA010");
ok("a hash that is not sha256 hex is refused", (await snapshot({ sha256: "nothex" })) === "23514");
ok("a window that ends before it starts is refused", (await snapshot({ window_end: "2026-09-22T10:00:00Z" })) === "23514");
ok("an endpoint that is not a path is refused", (await snapshot({ source_endpoint: "https://api.samsara.com/x" })) === "23514");

// ── 4. one org ───────────────────────────────────────────────────────────────────────────────────
ok("a reading cannot name another carrier's inspection", (await attribute({ engine_version: "ic9" }, ORG, THEIRS)) === "23503");
ok("a snapshot cannot name another carrier's inspection", (await snapshot({ storage_path: `${ORG}/x.json.gz` }, ORG, THEIRS)) === "23503");
ok("a snapshot's object must sit under its own org's prefix", (await snapshot({ storage_path: `${OTHER}/${INSP}/x.json.gz` })) === "23514");

async function asClient(org, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: "admin", role: "authenticated" }),
    ]);
    return { rows: (await db.query(sql)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.code ?? String(e.message) };
  } finally {
    await db.exec("rollback");
  }
}
for (const t of ["inspection_attributions", "inspection_evidence_snapshots"]) {
  const q = await asClient(ORG, `select count(*)::int as n from ${t}`);
  ok(`an admin's browser session reads nothing from ${t} (no client policy)`, q.error === null && q.rows[0].n === 0, JSON.stringify(q));
  const rls = await one(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`]);
  ok(`${t} has row level security on`, rls.relrowsecurity === true);
}

// ── 5. the bucket ────────────────────────────────────────────────────────────────────────────────
const bucket = await one(`select public, file_size_limit::int as cap from storage.buckets where id = 'inspection-evidence'`);
ok("the inspection-evidence bucket is private and capped at 10 MB", bucket?.public === false && bucket?.cap === 10 * 1024 * 1024, JSON.stringify(bucket));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
