// Silvicom 360 — the daily page-view count (migration 0435, product readiness X1, Q-PR4).
//
// What must hold for the count to answer "is this screen used, and by which role":
//   1. one row per (org, day, screen, role) — a second view adds to the count, never adds a row;
//   2. repeats inside one batch are counted, and a batch touching several screens is one call;
//   3. orgs, days and roles are kept apart;
//   4. nothing but a catalogue-shaped key and a role-shaped word can be stored — no path, no query
//      string, no user id (the table has no column for one);
//   5. the function and the table are service-role only.
//
// Run: node supabase/tests/surface-page-views.test.mjs
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
const refuses = async (q, p = []) => {
  try { await db.query(q, p); return false; } catch { return true; }
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
ok("0435 is present", MIGRATIONS.some((f) => f.startsWith("0435_surface_page_views")));
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

const record = async (org, day, role, keys) =>
  (await one(`select record_surface_views($1, $2::date, $3, $4::text[]) n`, [org, day, role, keys])).n;
const views = async (org, day, key, role) =>
  (await one(
    `select coalesce(sum(views), 0)::int v, count(*)::int r from surface_page_views
      where org_id = $1 and day = $2::date and surface_key = $3 and role = $4`,
    [org, day, key, role],
  ));

// 1 + 2: a batch with a repeat, then a second batch on the same day.
ok("a batch over two screens touches two rows",
  (await record(ORG, "2026-10-07", "admin", ["fuel.log", "fuel.log", "fuel.cards"])) === 2);
await record(ORG, "2026-10-07", "admin", ["fuel.log"]);
const log = await views(ORG, "2026-10-07", "fuel.log", "admin");
ok("repeats in a batch and across batches add up (2 + 1 = 3)", log.v === 3, JSON.stringify(log));
ok("…in ONE row, not one per view", log.r === 1, JSON.stringify(log));
ok("the other screen in the batch counts once", (await views(ORG, "2026-10-07", "fuel.cards", "admin")).v === 1);

// 3: org, day and role are each their own count.
await record(OTHER, "2026-10-07", "admin", ["fuel.log"]);
await record(ORG, "2026-10-08", "admin", ["fuel.log"]);
await record(ORG, "2026-10-07", "dispatcher", ["fuel.log"]);
ok("another org's view does not touch this org's count", (await views(ORG, "2026-10-07", "fuel.log", "admin")).v === 3);
ok("another org has its own row", (await views(OTHER, "2026-10-07", "fuel.log", "admin")).v === 1);
ok("the next day is its own row", (await views(ORG, "2026-10-08", "fuel.log", "admin")).v === 1);
ok("another role is its own row", (await views(ORG, "2026-10-07", "fuel.log", "dispatcher")).v === 1);

// An empty or null batch is a no-op, not an error: the browser may flush with nothing queued.
ok("an empty batch writes nothing", (await record(ORG, "2026-10-07", "admin", [])) === 0);
ok("a null batch writes nothing", (await one(`select record_surface_views($1, '2026-10-07', 'admin', null) n`, [ORG])).n === 0);

// 4: the shape guard. A path or a query string is refused, so is a role that is not a role word.
ok("a path is refused as a screen key", await refuses(`select record_surface_views($1, '2026-10-07', 'admin', array['/drivers/abc'])`, [ORG]));
ok("a query string is refused as a screen key",
  await refuses(`select record_surface_views($1, '2026-10-07', 'admin', array['fuel.log?card=4111111111111111'])`, [ORG]));
ok("an over-long key is refused", await refuses(`select record_surface_views($1, '2026-10-07', 'admin', array[repeat('a', 65)])`, [ORG]));
ok("an email in the role slot is refused", await refuses(`select record_surface_views($1, '2026-10-07', 'a@b.com', array['fuel.log'])`, [ORG]));
ok("a refused batch writes nothing, not even its valid keys",
  (await refuses(`select record_surface_views($1, '2026-10-09', 'admin', array['fuel.log', '/x?y=1'])`, [ORG]))
    && (await views(ORG, "2026-10-09", "fuel.log", "admin")).r === 0);
const cols = (await db.query(
  `select column_name from information_schema.columns where table_name = 'surface_page_views' order by ordinal_position`,
)).rows.map((r) => r.column_name);
ok("the table has no column that could hold a person or a path",
  cols.join(",") === "org_id,day,surface_key,role,views", cols.join(","));

// Deleting an org takes its counts with it.
await db.query(`delete from organizations where id = $1`, [OTHER]);
ok("an org's counts go with the org", (await one(`select count(*)::int n from surface_page_views where org_id = $1`, [OTHER])).n === 0);

// 5: service role only.
ok("row level security is on", (await one(`select relrowsecurity r from pg_class where relname = 'surface_page_views'`)).r === true);
ok("no client policy exists", (await one(`select count(*)::int n from pg_policies where tablename = 'surface_page_views'`)).n === 0);
const g = await one(
  `select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n,
          has_function_privilege('service_role', $1, 'execute') s`,
  ["public.record_surface_views(uuid, date, text, text[])"],
);
ok("record_surface_views: service role only", !g.a && !g.n && g.s, JSON.stringify(g));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
