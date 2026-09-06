// FuelGuard — McLeod roster link matrix (migration 0239).
//
// 0239 adds the columns that let the carrier's LoadMaster own the roster. Three things about it can
// break silently, so each gets a row here:
//
//   1. `merge_driver` must carry `mcleod_driver_id`. The function has been left stale TWICE already
//      (0203 for qualification_records/documents, 0234 for nine recruiting tables), and nothing lints
//      it. Here the failure is louder but worse: `uq_drivers_org_mcleod` is a partial unique index, so
//      a merge that claims the source's link while the source still holds it raises 23505 and aborts
//      halfway. The fix is to clear the source first; the test below is what proves it happened.
//   2. The partial unique indexes must reject a second row per (org, McLeod id) while still allowing
//      unlimited NULLs — every row in the product is NULL until M3 links it, so a non-partial index
//      would make the migration unshippable.
//   3. `identity_source` must admit 'mcleod' on all three tables and still reject anything else.
//
// Applies EVERY migration, same as rls.test.mjs and merge-driver-dqf.test.mjs, so the function under
// test is the one production runs — a hand-picked list is how a stale merge_driver escaped notice before.
//
// Run:  node supabase/tests/mcleod-roster-links.test.mjs
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
/** Run a statement expected to fail; return its SQLSTATE (or null if it unexpectedly succeeded). */
const sqlstate = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? String(e.message);
  }
};

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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;

// ── 1. merge_driver carries the McLeod link ──────────────────────────────────────────────────────
//
// The shape that matters: the DUPLICATE is the row that carries the McLeod link (an EFS stub gets
// reconciled against the real employment record, so the McLeod id arrives on the row being folded in),
// and the CANONICAL has none. That is precisely the case that raises 23505 without the clear-first fix.
const CANON = (
  await one(
    `insert into drivers (org_id, full_name, identity_source) values ($1,'Angel Cora','efs') returning id`,
    [ORG],
  )
).id;
const DUPE = (
  await one(
    `insert into drivers (org_id, full_name, identity_source, mcleod_driver_id, mcleod_company_id)
     values ($1,'ANGEL CORA','mcleod','D0001','TMS') returning id`,
    [ORG],
  )
).id;

const mergeErr = await sqlstate(`select merge_driver($1, $2, $3)`, [ORG, DUPE, CANON]);
ok("merge_driver completes when only the duplicate carries a McLeod link", mergeErr === null, `got ${mergeErr}`);

const merged = await one(
  `select mcleod_driver_id, mcleod_company_id from drivers where id = $1`,
  [CANON],
);
ok(
  "the McLeod id moved to the canonical driver",
  merged?.mcleod_driver_id === "D0001",
  `got ${JSON.stringify(merged)}`,
);
ok(
  "the company it came from moved with it — a link without its entity cannot be re-resolved",
  merged?.mcleod_company_id === "TMS",
  `got ${JSON.stringify(merged)}`,
);
ok(
  "the duplicate row is gone",
  Number((await one(`select count(*)::int as n from drivers where id = $1`, [DUPE])).n) === 0,
);

// The other direction: canonical already linked, duplicate linked to something else. The canonical's
// link WINS (coalesce keeps it) and the duplicate's is discarded with the row — a merge must never
// silently repoint an established roster link at a different McLeod record.
const CANON2 = (
  await one(
    `insert into drivers (org_id, full_name, mcleod_driver_id) values ($1,'Bo Reed','D0002') returning id`,
    [ORG],
  )
).id;
const DUPE2 = (
  await one(
    `insert into drivers (org_id, full_name, mcleod_driver_id) values ($1,'BO REED','D0003') returning id`,
    [ORG],
  )
).id;
const mergeErr2 = await sqlstate(`select merge_driver($1, $2, $3)`, [ORG, DUPE2, CANON2]);
ok("merge_driver completes when BOTH rows carry a McLeod link", mergeErr2 === null, `got ${mergeErr2}`);
ok(
  "the canonical driver keeps its own link rather than adopting the duplicate's",
  (await one(`select mcleod_driver_id from drivers where id = $1`, [CANON2]))?.mcleod_driver_id === "D0002",
);

// ── 2. the partial unique indexes ────────────────────────────────────────────────────────────────
await db.query(`insert into drivers (org_id, full_name, mcleod_driver_id) values ($1,'Cy Vance','D0100')`, [ORG]);
ok(
  "a second driver claiming the same McLeod id in the same org is rejected",
  (await sqlstate(`insert into drivers (org_id, full_name, mcleod_driver_id) values ($1,'Impostor','D0100')`, [ORG])) ===
    "23505",
);
ok(
  "the SAME McLeod id in a DIFFERENT org is fine — the index is org-scoped",
  (await sqlstate(
    `insert into drivers (org_id, full_name, mcleod_driver_id) values ($1,'Cy Vance','D0100')`,
    [OTHER_ORG],
  )) === null,
);
// Every row in the product is NULL here until M3 links it, so this is the assertion that makes the
// migration shippable at all rather than a nicety.
await db.query(`insert into drivers (org_id, full_name) values ($1,'Unlinked One'),($1,'Unlinked Two')`, [ORG]);
ok(
  "many drivers may have NO McLeod link — the index is partial",
  Number(
    (await one(`select count(*)::int as n from drivers where org_id = $1 and mcleod_driver_id is null`, [ORG])).n,
  ) >= 2,
);

// `tank_capacity_gal` is NOT NULL with no default — which is exactly why the Samsara path reports a
// new truck in `needsCompletion` instead of inventing a capacity, and why the McLeod sync must do the
// same rather than writing dbo.tractor.fuel_capacity blind (plan §4.2).
await db.query(
  `insert into vehicles (org_id, unit_number, tank_capacity_gal, mcleod_tractor_id) values ($1,'789',0,'789')`,
  [ORG],
);
ok(
  "a second vehicle claiming the same McLeod tractor id is rejected",
  (await sqlstate(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal, mcleod_tractor_id) values ($1,'789-dup',0,'789')`,
    [ORG],
  )) === "23505",
);
await db.query(`insert into trailers (org_id, unit_number, mcleod_trailer_id) values ($1,'532159','532159')`, [ORG]);
ok(
  "a second trailer claiming the same McLeod trailer id is rejected",
  (await sqlstate(
    `insert into trailers (org_id, unit_number, mcleod_trailer_id) values ($1,'R532159','532159')`,
    [ORG],
  )) === "23505",
);

// ── 3. identity_source admits 'mcleod' on all three tables ───────────────────────────────────────
ok(
  "drivers.identity_source accepts 'mcleod'",
  (await sqlstate(
    `insert into drivers (org_id, full_name, identity_source) values ($1,'From McLeod','mcleod')`,
    [ORG],
  )) === null,
);
ok(
  "vehicles.identity_source accepts 'mcleod'",
  (await sqlstate(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal, identity_source) values ($1,'790',0,'mcleod')`,
    [ORG],
  )) === null,
);
ok(
  "trailers.identity_source accepts 'mcleod'",
  (await sqlstate(
    `insert into trailers (org_id, unit_number, identity_source) values ($1,'532160','mcleod')`,
    [ORG],
  )) === null,
);
// The constraint still has to constrain — a typo'd provenance must not fall through as a fourth value.
ok(
  "drivers.identity_source still rejects an unknown provenance",
  (await sqlstate(
    `insert into drivers (org_id, full_name, identity_source) values ($1,'Typo','mcload')`,
    [ORG],
  )) === "23514",
);
ok(
  "vehicles.identity_source still rejects 'efs' — that value is drivers-only (0204)",
  (await sqlstate(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal, identity_source) values ($1,'791',0,'efs')`,
    [ORG],
  )) === "23514",
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
