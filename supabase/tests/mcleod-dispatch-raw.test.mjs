// Silvicom 360 — mcleod_dispatch_movements / mcleod_dispatch_stops (migration 0364,
// LOADS-MIRROR-PLAN.md LR1, D-LMR3).
//
// The raw half of the dispatch mirror: what McLeod said, verbatim, so the core `loads` rows can be
// rebuilt from it at any time (D-LMR4). Five properties have to hold in the DATABASE, because the
// writer (LR3) is the thing most likely to be wrong about them:
//
//   · THE KEY CARRIES company_id. McLeod ids are unique per company only (`orders.id` collides 16,948
//     times across companies), so the same movement id under a second company is a new row, never an
//     overwrite — and the same id in another org is another carrier's movement entirely.
//   · A STOP CANNOT HANG OFF ANOTHER ORG'S MOVEMENT, and dies with its own. The FK is composite on
//     (org, company, movement) and cascades, so retention deletes movements and nothing else.
//   · `stop_type` IS VERBATIM. VA and SP are exactly the stops the old agent dropped; a CHECK listing
//     "known" types would re-drop them at the database instead.
//   · `longitude` IS WEST-NEGATIVE. McLeod stores it west-positive at this carrier and the agent
//     negates it; a positive value here means that negation was lost, and every truck would draw in
//     western China. The sync must fail instead.
//   · MISSING IS NULL, NEVER ZERO. No numeric column defaults to 0 — a load with no recorded weight
//     is not a weightless load.
//
// Run:  node supabase/tests/mcleod-dispatch-raw.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;

const movement = (org, company, id) =>
  sqlstate(`insert into mcleod_dispatch_movements (org_id, company_id, movement_id) values ($1, $2, $3)`,
    [org, company, id]);
const stop = (org, company, stopId, movementId, cols = "", vals = "", extra = []) =>
  sqlstate(
    `insert into mcleod_dispatch_stops (org_id, company_id, stop_id, movement_id ${cols})
     values ($1, $2, $3, $4 ${vals})`,
    [org, company, stopId, movementId, ...extra],
  );

// ── the key: company_id is in it, and so is the org ──────────────────────────────────────────────
ok("a movement stores with nothing but its key", (await movement(ORG_A, "TMS", "11787")) === null);
ok("the same movement id under ANOTHER company in the same org is a different row, not an overwrite",
  (await movement(ORG_A, "TMS2", "11787")) === null);
ok("the same id in another org is another carrier's movement", (await movement(ORG_B, "TMS", "11787")) === null);
ok("but the same (org, company, movement) twice is refused", (await movement(ORG_A, "TMS", "11787")) === "23505");

// ── missing is null, never zero; bookkeeping stamps itself ───────────────────────────────────────
const fresh = await one(
  `select weight, pieces, pallets_how_many, move_distance, loaded, driver_codes, closed_at,
          first_seen_at is not null seen, first_seen_at = last_seen_at same
     from mcleod_dispatch_movements where org_id = $1 and company_id = 'TMS' and movement_id = '11787'`, [ORG_A]);
ok("weight, pieces, pallets and distance are NULL when McLeod recorded none — never 0",
  fresh.weight === null && fresh.pieces === null && fresh.pallets_how_many === null && fresh.move_distance === null,
  JSON.stringify(fresh));
ok("loaded is not guessed — null until McLeod says L or E", fresh.loaded === null);
ok("a movement with no driver continuity has an empty driver list, not a null one",
  Array.isArray(fresh.driver_codes) && fresh.driver_codes.length === 0);
ok("first_seen_at and last_seen_at stamp themselves, identically, on the first sync", fresh.seen && fresh.same);
ok("and a movement is open until McLeod STATES it closed (closed_at null)", fresh.closed_at === null);
const numericDefaults = await one(
  `select count(*)::int n from information_schema.columns
    where table_name in ('mcleod_dispatch_movements', 'mcleod_dispatch_stops')
      and data_type in ('numeric', 'integer') and column_default is not null`);
ok("no numeric column in either table carries a default", numericDefaults.n === 0, JSON.stringify(numericDefaults));
ok("the withdrawn L6 change-tracking column is absent — no feed would ever write it",
  (await one(`select count(*)::int n from information_schema.columns
               where table_name = 'mcleod_dispatch_movements' and column_name = 'source_version'`)).n === 0);

// ── stops: the parent is composite, and it must be this org's ────────────────────────────────────
ok("a stop stores under its movement", (await stop(ORG_A, "TMS", "S1", "11787")) === null);
ok("a stop naming a movement we do not hold is refused", (await stop(ORG_A, "TMS", "S2", "nope")) === "23503");
await movement(ORG_B, "TMS", "only-in-b");
ok("a stop cannot hang off ANOTHER org's movement, even with the right company and id",
  (await stop(ORG_A, "TMS", "S3", "only-in-b")) === "23503");
ok("nor off the same movement id under another company", (await stop(ORG_A, "TMS3", "S4", "11787")) === "23503");

// ── verbatim stop types: VA and SP are what the old agent dropped ────────────────────────────────
for (const [id, type] of [["S-VA", "VA"], ["S-SP", "SP"], ["S-XX", "ZZ"]]) {
  ok(`stop_type '${type}' is stored verbatim — the database names no "known" list`,
    (await stop(ORG_A, "TMS", id, "11787", ", stop_type", ", $5", [type])) === null);
}

// ── longitude: west-negative, checked ────────────────────────────────────────────────────────────
ok("a west-negative longitude stores (Green Bay, -88.0)",
  (await stop(ORG_A, "TMS", "S-LON1", "11787", ", latitude, longitude", ", $5, $6", [44.5, -88.0])) === null);
ok("a POSITIVE longitude is refused — the agent's negation was lost, and that must fail the sync",
  (await stop(ORG_A, "TMS", "S-LON2", "11787", ", latitude, longitude", ", $5, $6", [44.5, 88.0])) === "23514");
ok("a stop with no coordinates at all still stores",
  (await stop(ORG_A, "TMS", "S-LON3", "11787", ", longitude", ", $5", [null])) === null);

// ── times are instants ───────────────────────────────────────────────────────────────────────────
const timeCols = await one(
  `select count(*) filter (where data_type = 'timestamp with time zone')::int tz, count(*)::int n
     from information_schema.columns
    where table_name = 'mcleod_dispatch_stops'
      and column_name in ('sched_arrive_early','sched_arrive_late','actual_arrival','actual_departure','eta')`);
ok("all five McLeod stop times are timestamptz — the collector converts Central wall-clock once (LR3)",
  timeCols.n === 5 && timeCols.tz === 5, JSON.stringify(timeCols));

// ── the cascade: stops die with their movement, movements with their org ────────────────────────
const before = Number((await one(`select count(*)::int n from mcleod_dispatch_stops where org_id = $1`, [ORG_A])).n);
const refused = await sqlstate(
  `delete from mcleod_dispatch_movements where org_id = $1 and company_id = 'TMS' and movement_id = '11787'`, [ORG_A]);
const after = Number((await one(`select count(*)::int n from mcleod_dispatch_stops where org_id = $1`, [ORG_A])).n);
ok("deleting a movement deletes its stops — retention deletes movements and nothing else",
  refused === null && before > 0 && after === 0, `${refused} ${before} -> ${after}`);
ok("and leaves the same id under another company alone",
  Number((await one(`select count(*)::int n from mcleod_dispatch_movements where org_id = $1 and movement_id = '11787'`,
    [ORG_A])).n) === 1);

await stop(ORG_B, "TMS", "SB1", "only-in-b");
const orgRefused = await sqlstate(`delete from organizations where id = $1`, [ORG_B]);
ok("deleting an org takes its movements and their stops with it",
  orgRefused === null &&
    Number((await one(`select (select count(*) from mcleod_dispatch_movements where org_id = $1)
                            + (select count(*) from mcleod_dispatch_stops where org_id = $1) n`, [ORG_B])).n) === 0,
  String(orgRefused));

// ── reachability: raw staging is never read by a browser ─────────────────────────────────────────
for (const t of ["mcleod_dispatch_movements", "mcleod_dispatch_stops"]) {
  const rls = await one(
    `select c.relrowsecurity enabled, (select count(*)::int from pg_policies p where p.tablename = $1) policies
       from pg_class c where c.relname = $1`, [t]);
  ok(`${t}: RLS on, zero policies — deny-all on purpose`, rls.enabled === true && rls.policies === 0,
    JSON.stringify(rls));
}
ok("the projection's ordered read of a movement's stops has an index",
  Number((await one(`select count(*)::int n from pg_indexes where indexname = 'mcleod_dispatch_stops_movement_idx'`)).n) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
