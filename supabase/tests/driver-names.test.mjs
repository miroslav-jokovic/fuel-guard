// Silvicom 360 — driver_names(), the name-only surface (migration 0436, DATABASE-AUDIT Q-DA3 step 1).
//
//   1. ORG SCOPED BY THE JWT — a fleet manager of org A gets A's drivers, never B's.
//   2. NAMES ONLY — exactly two columns, id and full_name; nothing else about a driver leaves.
//   3. HISTORY INCLUDED — a terminated driver's name is still returned (old fills need it).
//   4. A DRIVER SEES ONLY ITSELF — the rule drivers_driver_scope enforces on the table.
//   5. ANON CANNOT CALL IT.
//
// Run:  node supabase/tests/driver-names.test.mjs
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

for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: mcleod-gl-day-replace -------------------------------");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const U_DRIVER = "00000000-0000-0000-0000-0000000000d1";
await db.query(`insert into organizations (id, name) values ($1,'A'), ($2,'B')`, [ORG_A, ORG_B]);
await db.query(`insert into auth.users (id, email) values ($1, 'ann@a.test')`, [U_DRIVER]);
await db.query(
  `insert into drivers (org_id, full_name, status, user_id) values ($1,'Ann A','active',$3), ($1,'Old Al','terminated',null), ($2,'Bob B','active',null)`,
  [ORG_A, ORG_B, U_DRIVER],
);

const as = async (role, claims, sql) => {
  await db.exec(`begin; set local role ${role};`);
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await db.query(sql);
    return { rows: r.rows, fields: r.fields.map((f) => f.name) };
  } catch (e) {
    return { error: e.code ?? e.message };
  } finally {
    await db.exec(`rollback;`);
  }
};

console.log("\n---- Matrix: driver-names -----------------------------------------");
const mgr = await as("authenticated", { org_id: ORG_A, user_role: "fleet_manager", sub: "00000000-0000-0000-0000-000000000001" }, `select * from driver_names()`);
ok("a fleet manager of org A gets org A's drivers only", JSON.stringify(mgr.rows?.map((r) => r.full_name)) === JSON.stringify(["Ann A", "Old Al"]), JSON.stringify(mgr));
ok("exactly two columns: id and full_name", JSON.stringify(mgr.fields) === JSON.stringify(["id", "full_name"]), JSON.stringify(mgr.fields));
ok("a terminated driver's name is still returned", mgr.rows?.some((r) => r.full_name === "Old Al"));
const drv = await as("authenticated", { org_id: ORG_A, user_role: "driver", sub: U_DRIVER }, `select * from driver_names()`);
ok("a driver login sees only itself", JSON.stringify(drv.rows?.map((r) => r.full_name)) === JSON.stringify(["Ann A"]), JSON.stringify(drv));
const anon = await as("anon", {}, `select * from driver_names()`);
ok("anon cannot call it", anon.error === "42501", JSON.stringify(anon));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
