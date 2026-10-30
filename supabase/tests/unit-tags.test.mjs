// Silvicom 360 — a truck's and a trailer's QR code (migration 0531; DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md
// §3 DE3, D-DE5).
//
// 1. Exactly one unit per row: a truck or a trailer, never both, never neither.
// 2. One tag per unit, one unit per code per org — another org may draw the same code.
// 3. Issued once: no column of a row changes, service role included (IV022). A reprint prints the same code.
// 4. The unit is this org's (IV012) — a code cannot be pinned to another carrier's truck.
// 5. The code is six Crockford characters, the id `formatTag` prints.
// 6. RLS on with no client policy; a vehicle with a tag cannot be deleted out from under it.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to inventory-integrity.test.mjs.
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const truck = async (org, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [org, unit])).id;
const trailer = async (org, unit) => (await one(`insert into trailers (org_id, unit_number) values ($1,$2) returning id`, [org, unit])).id;
const T654 = await truck(ORG, "654");
const T702 = await truck(ORG, "702");
const R1203 = await trailer(ORG, "1203");
const RIVAL = await truck(OTHER, "654");
const tag = (org, vehicle, trailerId, code) =>
  refuses(`insert into unit_tags (org_id, vehicle_id, trailer_id, tag_code) values ($1,$2,$3,$4)`, [org, vehicle, trailerId, code]);

// ── 1: one unit per row ─────────────────────────────────────────────────────────────────────
ok("a truck takes a tag", (await tag(ORG, T654, null, "7K3M9P")) === null);
ok("a trailer takes a tag", (await tag(ORG, null, R1203, "X4Q2VW")) === null);
ok("a row naming both a truck and a trailer is refused", (await tag(ORG, T702, R1203, "AAAAAA")) === "23514");
ok("a row naming no unit is refused", (await tag(ORG, null, null, "BBBBBB")) === "23514");

// ── 2: one tag per unit, one unit per code ──────────────────────────────────────────────────
ok("a second tag for the same truck is refused", (await tag(ORG, T654, null, "CCCCCC")) === "23505");
ok("a second tag for the same trailer is refused", (await tag(ORG, null, R1203, "DDDDDD")) === "23505");
ok("one code cannot answer two units in an org", (await tag(ORG, T702, null, "7K3M9P")) === "23505");
ok("another org may draw the same code", (await tag(OTHER, RIVAL, null, "7K3M9P")) === null);

// ── 3: issued once ──────────────────────────────────────────────────────────────────────────
ok("the code never changes", (await refuses(`update unit_tags set tag_code = 'EEEEEE' where vehicle_id = $1`, [T654])) === "IV022");
ok("a tag never moves to another unit", (await refuses(`update unit_tags set vehicle_id = $2 where vehicle_id = $1`, [T654, T702])) === "IV022");
ok("not even its issue time is rewritten", (await refuses(`update unit_tags set issued_at = now() where trailer_id = $1`, [R1203])) === "IV022");
ok("the truck still answers its first code", (await one(`select tag_code from unit_tags where vehicle_id = $1`, [T654])).tag_code === "7K3M9P");

// ── 4: the unit is this org's ───────────────────────────────────────────────────────────────
ok("a code cannot be pinned to another org's truck", (await tag(ORG, RIVAL, null, "FFFFFF")) === "IV012");

// ── 5: the code's shape ─────────────────────────────────────────────────────────────────────
ok("five characters are refused", (await tag(ORG, T702, null, "7K3M9")) === "23514");
ok("lower case is refused (the API normalises first)", (await tag(ORG, T702, null, "7k3m9q")) === "23514");
ok("a letter Crockford leaves out (U) is refused", (await tag(ORG, T702, null, "7K3M9U")) === "23514");
ok("a full SIL1 string is refused — the row holds the id alone", (await tag(ORG, T702, null, "SIL1:VEH:7K3M9Q")) === "23514");

// ── 6: RLS, and the unit outlives nothing ───────────────────────────────────────────────────
ok("row level security is on", (await one(`select relrowsecurity from pg_class where relname = 'unit_tags'`)).relrowsecurity === true);
ok("no client policy exists", Number((await one(`select count(*) from pg_policies where tablename = 'unit_tags'`)).count) === 0);
const del = await refuses(`delete from vehicles where id = $1`, [T654]);
// `on delete restrict` raises 23001 (restrict_violation), not the 23503 a `no action` key would.
ok("a tagged truck cannot be deleted", del === "23001", del);
ok("the guard function is closed to clients", (await one(`select has_function_privilege('authenticated', 'guard_unit_tag()', 'execute') as x`)).x === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
