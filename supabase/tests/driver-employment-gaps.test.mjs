// Silvicom 360 — driver_employment_gaps matrix (migration 0538, HIRING-WORKFLOW-AUDIT-2026-10-31 HW5c).
// append-only, one pinned, kept in the carrier, moved by a roster merge, removed by the purge (that half
// is `purge-applicant.test.mjs`).
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
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org, name) => (await one(`insert into drivers (org_id, full_name) values ($1, $2) returning id`, [org, name])).id;
const A = await driver(ORG, "Driver A");
const A2 = await driver(ORG, "Driver A (duplicate)");
const X = await driver(OTHER, "Someone else's driver");

const gap = (org, d, from = "2024-01-01", to = "2024-03-01", why = "Cared for a parent") =>
  sqlstate(`insert into driver_employment_gaps (org_id, driver_id, started_on, ended_on, explanation, recorded_by_name)
            values ($1, $2, $3, $4, $5, 'Dana')`, [org, d, from, to, why]);
const idOf = async (why) => (await one(`select id from driver_employment_gaps where explanation = $1`, [why])).id;

// ── writing ───────────────────────────────────────────────────────────────────────────────────
ok("a gap on this carrier's driver is recorded", (await gap(ORG, A)) === null);
ok("a gap on another carrier's driver is refused (EG013)", (await gap(ORG, X, undefined, undefined, "cross")) === "EG013");
ok("a gap that ends before it starts is refused (23514)", (await gap(ORG, A, "2024-05-01", "2024-04-01", "backwards")) === "23514");
ok("a gap with no explanation is refused (23514)", (await gap(ORG, A, undefined, undefined, "  ")) === "23514");
ok("a gap born withdrawn is refused (EG014)", (await sqlstate(
  `insert into driver_employment_gaps (org_id, driver_id, started_on, ended_on, explanation, recorded_by_name, withdrawn_at)
   values ($1, $2, '2024-01-01', '2024-02-01', 'x', 'Dana', now())`, [ORG, A])) === "EG014");

// ── append-only, withdrawable once ────────────────────────────────────────────────────────────
const G1 = await idOf("Cared for a parent");
ok("the explanation is never edited (EG011)", (await sqlstate(`update driver_employment_gaps set explanation = 'changed' where id = $1`, [G1])) === "EG011");
ok("the dates are never edited (EG011)", (await sqlstate(`update driver_employment_gaps set ended_on = '2024-06-01' where id = $1`, [G1])) === "EG011");
ok("who recorded it is never edited (EG011)", (await sqlstate(`update driver_employment_gaps set recorded_by_name = 'Eve' where id = $1`, [G1])) === "EG011");
ok("a gap is never deleted (EG010)", (await sqlstate(`delete from driver_employment_gaps where id = $1`, [G1])) === "EG010");
ok("a gap is withdrawn", (await sqlstate(`update driver_employment_gaps set withdrawn_at = now() where id = $1`, [G1])) === null);
ok("a withdrawal is never undone (EG012)", (await sqlstate(`update driver_employment_gaps set withdrawn_at = null where id = $1`, [G1])) === "EG012");

// ── the roster merge moves it; nothing else may ───────────────────────────────────────────────
ok("the merge moves a gap to the surviving driver", (await sqlstate(`update driver_employment_gaps set driver_id = $1 where id = $2`, [A2, G1])) === null);
ok("but never to another carrier's driver (EG013)", (await sqlstate(`update driver_employment_gaps set driver_id = $1 where id = $2`, [X, G1])) === "EG013");
// A direct `delete from drivers` is refused earlier by the driver guard (DR010), so the FK's own rule is
// read from the catalog: restrict, never cascade — the merge-driver cascade trap.
const fk = await one(`select confdeltype from pg_constraint
  where conrelid = 'public.driver_employment_gaps'::regclass and contype = 'f'
    and confrelid = 'public.drivers'::regclass`);
ok("driver_id is ON DELETE RESTRICT, never cascade", fk?.confdeltype === "r", JSON.stringify(fk));

// ── the API's only door ───────────────────────────────────────────────────────────────────────
const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = 'driver_employment_gaps'`)).n);
ok("RLS is on with no client policy — deny-all from a browser", policies === 0
  && (await one(`select relrowsecurity r from pg_class where relname = 'driver_employment_gaps'`)).r === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
