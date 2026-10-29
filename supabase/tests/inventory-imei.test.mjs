// Silvicom 360 — a tablet's IMEI (migration 0527; MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.6, M9a).
//
// 1. The shape: 15 digits and nothing else. The Luhn check digit is `isImei()`'s, before a write
//    (M9b); this layer refuses anything that is not fifteen digits — a space, a dash, fourteen.
// 2. One IMEI, one asset, per org — 0522's serial rule, for the same reason. Null repeats freely,
//    and another org may hold the same IMEI (a resold tablet).
// 3. The refusal names the index, because `assetsWrite.ts` maps 23505 by name (M9b).

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
const TYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity, held_by) values ($1,'Tablet',true,1,'driver') returning id`, [ORG])).id;
const RTYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity, held_by) values ($1,'Tablet',true,1,'driver') returning id`, [OTHER])).id;
const tablet = (org, type, imei) =>
  refuses(`insert into inventory_assets (org_id, asset_type_id, name, imei) values ($1,$2,'Cab tablet',$3)`, [org, type, imei]);

// A real IMEI shape (the Luhn digit is M9b's question, not this layer's).
const IMEI = "490154203237518";

// ── 1: the shape ────────────────────────────────────────────────────────────────────────────────
ok("a 15-digit IMEI is accepted", (await tablet(ORG, TYPE, IMEI)) === null);
ok("fourteen digits are refused", (await tablet(ORG, TYPE, "49015420323751")) === "23514");
ok("sixteen digits are refused", (await tablet(ORG, TYPE, "4901542032375180")) === "23514");
ok("spaces or dashes are refused — stored digits only", (await tablet(ORG, TYPE, "49-015420-323751-8")) === "23514");
ok("...and a trailing space", (await tablet(ORG, TYPE, `${IMEI.slice(0, 14)}9 `)) === "23514");
ok("an empty string is refused (null is 'none')", (await tablet(ORG, TYPE, "")) === "23514");

// ── 2: one per org ──────────────────────────────────────────────────────────────────────────────
ok("the same IMEI again is refused", (await tablet(ORG, TYPE, IMEI)) === "23505");
ok("another org may hold the same IMEI", (await tablet(OTHER, RTYPE, IMEI)) === null);
ok("two devices with no IMEI are fine", (await tablet(ORG, TYPE, null)) === null && (await tablet(ORG, TYPE, null)) === null);
ok(
  "a later edit to an existing asset meets the same rule",
  (await refuses(`update inventory_assets set imei = $1 where org_id = $2 and imei is null and id = (select id from inventory_assets where org_id = $2 and imei is null limit 1)`, [IMEI, ORG])) === "23505",
);

// ── 3: the refusal's name ───────────────────────────────────────────────────────────────────────
const err = await (async () => {
  try {
    await db.query(`insert into inventory_assets (org_id, asset_type_id, name, imei) values ($1,$2,'x',$3)`, [ORG, TYPE, IMEI]);
  } catch (e) {
    return e.message;
  }
})();
ok("the refusal names the index the API reads it by", /idx_inventory_assets_imei_unique/.test(err ?? ""), err);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
