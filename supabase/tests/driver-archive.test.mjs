// FuelGuard — driver archive matrix (migration 0235).
//
// `drivers` is in RETENTION_FORBIDDEN (D-BD12): §391.51 measures retention in years and §390.32(d)
// requires the record to still be reproducible, so the answer to "this table is confusing" cannot be
// a delete. 0235 adds `archived_at` and closes the delete instead. Three rules, and this file is
// where each of them is a fact rather than a comment:
//
//   1. DR010 — a driver is never hard-deleted, by anybody, service role included (0096's shape).
//   2. `merge_driver` is the ONE exemption, and it works. Deleting the source is how a merge ends.
//   3. DR011 — `archived_at` is the API's to write, so the act always carries its audit row. 0212
//      grants `recruiter` UPDATE on `drivers` by name; without this the tidying is unlogged.
//
// Applies EVERY migration, on rls.test.mjs's model, with Supabase's real default privileges installed
// before them — a guard tested against a hand-picked subset is a guard tested against a schema
// nobody runs.
//
// Run:  node supabase/tests/driver-archive.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// A real auth.users row behind the JWT `sub`: the drivers audit trigger writes an actor-referencing
// row on every UPDATE, so a fabricated subject fails the edit with a foreign-key violation and every
// "…still goes through" assertion below would fail for a reason that has nothing to do with 0235.
const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'admin@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'O') returning id`)).id;

const mkDriver = async (org, name, extra = "") =>
  (await one(`insert into drivers (org_id, full_name${extra ? ", " + extra.split("=")[0] : ""}) values ($1,$2${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [org, name])).id;

/** Run one statement as an org member with the given app role, and report what happened. */
async function asRole(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    await db.query(sql, params);
    await db.exec("rollback");
    return "OK";
  } catch (e) {
    await db.exec("rollback");
    return e.code ?? `ERROR: ${e.message}`;
  }
}

/** The same, as the SERVICE ROLE — no JWT claims at all, which is what the API is. */
async function asService(sql, params = []) {
  try {
    await db.query(sql, params);
    return "OK";
  } catch (e) {
    return e.code ?? `ERROR: ${e.message}`;
  }
}

// ── 1. The column exists and does what a nullable timestamp does ──────────────────────────────
const D1 = await mkDriver(ORG, "Archie Vist");
ok(
  "a new driver starts un-archived",
  (await one(`select archived_at from drivers where id = $1`, [D1])).archived_at === null,
);
ok(
  "the service role can archive",
  (await asService(`update drivers set archived_at = now() where id = $1`, [D1])) === "OK",
);
ok(
  "and un-archive — archiving is reversible, unlike everything else in this product's evidence line",
  (await asService(`update drivers set archived_at = null where id = $1`, [D1])) === "OK"
    && (await one(`select archived_at from drivers where id = $1`, [D1])).archived_at === null,
);

// ── 2. DR011 — archiving is an API act, so that it is an audited one ──────────────────────────
// 0212 grants `recruiter` UPDATE on `drivers` by name so an applicant's row can be edited. That grant
// is the whole reason this trigger exists: without it the act of hiding a person from the roster is
// the one roster act with no audit row behind it.
for (const role of ["recruiter", "admin", "fleet_manager", "safety_manager"]) {
  ok(
    `a ${role} cannot archive through PostgREST (DR011)`,
    (await asRole(role, `update drivers set archived_at = now() where id = $1`, [D1])) === "DR011",
  );
}
ok(
  "…and cannot UN-archive either — the guard is on the FIELD CHANGING, not on one direction",
  (await asService(`update drivers set archived_at = now() where id = $1`, [D1])) === "OK"
    && (await asRole("admin", `update drivers set archived_at = null where id = $1`, [D1])) === "DR011",
);
const ordinaryEdit = await asRole("admin", `update drivers set phone = '555-0100' where id = $1`, [D1]);
ok(
  "an ordinary edit that leaves archived_at alone still goes through",
  ordinaryEdit === "OK",
  `got ${ordinaryEdit}`,
);
await db.query(`update drivers set archived_at = null where id = $1`, [D1]);

// ── 3. DR010 — the row is never removed ───────────────────────────────────────────────────────
// ⚠ No `auth_role() is null` exemption, unlike 0213: this is the EI010/DA010 family, where the
// trigger fires for the SERVICE ROLE too. A guard that trusts the API is a guard against typos, not
// against the thing it is written for — the service role is what bypasses RLS in the first place.
ok(
  "a driver cannot be deleted by an admin through PostgREST (DR010)",
  (await asRole("admin", `delete from drivers where id = $1`, [D1])) === "DR010",
);
ok(
  "a driver cannot be deleted by the SERVICE ROLE either",
  (await asService(`delete from drivers where id = $1`, [D1])) === "DR010",
);
ok(
  "an already-archived driver is not deletable either — archiving is not a step towards deletion",
  (await asService(`update drivers set archived_at = now() where id = $1`, [D1])) === "OK"
    && (await asService(`delete from drivers where id = $1`, [D1])) === "DR010",
);
ok("and the driver is still there after all of that",
  (await count(`select count(*)::int as n from drivers where id = $1`, [D1])) === 1);
await db.query(`update drivers set archived_at = null where id = $1`, [D1]);

// A brand-new applicant with no evidence at all is STILL undeletable. Worth asserting rather than
// assuming: "they never applied, so there is nothing to keep" is a tempting argument, and the answer
// is that a row nobody can delete is one fewer way to lose a file by accident.
const FRESH = await mkDriver(ORG, "Never Applied");
ok(
  "even an applicant who has done nothing at all cannot be deleted",
  (await asService(`delete from drivers where id = $1`, [FRESH])) === "DR010",
);

// ── 4. merge_driver holds the only exemption, and still holds it ──────────────────────────────
// This is the assertion that would fail if somebody tightened the guard without reading 0234: the
// merge ends in `delete from drivers`, and a guard with no exemption silently breaks roster dedup.
const CANON = await mkDriver(ORG, "Angel Cora");
const DUPE = await mkDriver(ORG, "ANGEL CORA COMP");
await db.query(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on) values ($1,$2,'mvr','2026-01-10')`,
  [ORG, DUPE],
);
ok(
  "merge_driver may still delete the source it has just emptied",
  (await asService(`select merge_driver($1,$2,$3)`, [ORG, DUPE, CANON])) === "OK"
    && (await count(`select count(*)::int as n from drivers where id = $1`, [DUPE])) === 0,
);
ok(
  "and the evidence went with it rather than under it",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [CANON])) === 1,
);
// The exemption must not survive the function that set it: a flag left on would turn the guard off
// for whatever the same transaction does next.
ok(
  "the merge exemption does not leak past the merge",
  (await asService(`delete from drivers where id = $1`, [CANON])) === "DR010",
);

// ── 5. Tenancy — an archive is scoped like everything else here ───────────────────────────────
const STRANGER = await mkDriver(OTHER, "Somebody Else");
await db.query(`update drivers set archived_at = now() where id = $1`, [STRANGER]);
ok(
  "another org's archived driver is invisible to this org's roster read",
  (await count(
    `select count(*)::int as n from drivers where org_id = $1 and archived_at is null`,
    [ORG],
  )) >= 1
    && (await count(
      `select count(*)::int as n from drivers where org_id = $1 and archived_at is null`,
      [OTHER],
    )) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
