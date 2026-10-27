// Silvicom 360 — inventory integrity matrix (migration 0522; DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md
// §5, PR-R3).
//
//   1.  One serial number, one asset, per org (R8) — compared trimmed and case-folded, because two
//       people typing one sticker produce "R9TW40" and "r9tw40 ". A blank serial repeats freely, and
//       another org's asset may carry the same serial.
//   2.  A shelf line's label code is assigned once (R13): null → code is the one change allowed,
//       and changing or clearing it afterwards is `IV022`, the service role included.
//   3.  One open kit check per unit. The migration closes the duplicates already open — keeping the
//       NEWEST, which is the one "Check this unit" resumes — and the index then refuses a second.
//       Shelf walks repeat freely (a D-INV21 recount is its own walk).
//
// ⚠ 0522 is applied SEPARATELY, after the duplicates it has to clean up are seeded on 0521's schema.
// Applied with the rest, the cleanup would run over an empty table and prove nothing.

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
const num = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to inventory-stock.test.mjs and rls.test.mjs.
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
const BEFORE = MIGRATIONS.filter((f) => f < "0522");
const REST = MIGRATIONS.filter((f) => f >= "0522");
const apply = async (files) => {
  for (const f of files) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(BEFORE);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'654',240) returning id`, [ORG])).id;
const TRUCK2 = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'720',240) returning id`, [ORG])).id;
const TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1,'T-4102') returning id`, [ORG])).id;
const BAY = (await one(`insert into stock_locations (org_id,name,code) values ($1,'Main','MAIN') returning id`, [ORG])).id;

const openedAt = (iso) => iso;
const unitCheck = async (cols, opened) =>
  (
    await one(
      `insert into stock_count_sessions (org_id, kind, vehicle_id, trailer_id, blind, opened_at)
       values ($1,'unit',$2,$3,false,$4) returning id`,
      [ORG, cols.vehicleId ?? null, cols.trailerId ?? null, opened],
    )
  ).id;

// ── seeded on 0521's schema: production's shape, four open checks of one truck ──
const OLD1 = await unitCheck({ vehicleId: TRUCK }, openedAt("2026-09-10T13:00:00Z"));
const OLD2 = await unitCheck({ vehicleId: TRUCK }, openedAt("2026-09-10T15:00:00Z"));
const OLD3 = await unitCheck({ vehicleId: TRUCK }, openedAt("2026-10-15T15:00:00Z"));
const NEWEST = await unitCheck({ vehicleId: TRUCK }, openedAt("2026-10-19T15:00:00Z"));
const ALONE = await unitCheck({ vehicleId: TRUCK2 }, openedAt("2026-09-01T15:00:00Z"));
const TRL = await unitCheck({ trailerId: TRAILER }, openedAt("2026-09-01T15:00:00Z"));
await db.query(`update stock_count_sessions set note = 'started at the fuel island' where id = $1`, [OLD1]);
// Two open walks of one bay: a count and its recount (D-INV21). Neither is a duplicate to clean up.
const COUNT = (await one(`insert into stock_count_sessions (org_id, kind, location_id, opened_at) values ($1,'location',$2,'2026-10-01T10:00:00Z') returning id`, [ORG, BAY])).id;
const RECOUNT = (await one(`insert into stock_count_sessions (org_id, kind, location_id, opened_at) values ($1,'location',$2,'2026-10-01T11:00:00Z') returning id`, [ORG, BAY])).id;

await apply(REST);

// ── 3: the cleanup ───────────────────────────────────────────────────────────────────────────
const status = async (id) => (await one(`select status, closed_at, note from stock_count_sessions where id=$1`, [id]));
ok("the newest open check of the truck stays open", (await status(NEWEST)).status === "open");
ok(
  "the three older ones are closed, with a closing time",
  (await num(`select count(*) n from stock_count_sessions where id = any($1) and status='closed' and closed_at is not null`, [[OLD1, OLD2, OLD3]])) === 3,
);
ok("...and nothing was deleted", (await num(`select count(*) n from stock_count_sessions`)) === 8);
ok(
  "a bay's count and its recount are both left open — shelf walks are not unit checks",
  (await num(`select count(*) n from stock_count_sessions where id = any($1) and status='open'`, [[COUNT, RECOUNT]])) === 2,
);
const kept = await status(OLD1);
ok(
  "a closed one keeps its own note and says why it was closed",
  kept.note.startsWith("started at the fuel island") && kept.note.includes("Closed by migration 0522"),
);
ok("a unit with a single open check is left alone", (await status(ALONE)).status === "open");
ok("...and so is a trailer's", (await status(TRL)).status === "open");

// ── 3: the index ─────────────────────────────────────────────────────────────────────────────
ok(
  "a second open check of the same truck is refused",
  (await refuses(`insert into stock_count_sessions (org_id, kind, vehicle_id, blind) values ($1,'unit',$2,false)`, [ORG, TRUCK])) === "23505",
);
ok(
  "...and of the same trailer",
  (await refuses(`insert into stock_count_sessions (org_id, kind, trailer_id, blind) values ($1,'unit',$2,false)`, [ORG, TRAILER])) === "23505",
);
await db.query(`update stock_count_sessions set status='closed', closed_at=now() where id=$1`, [NEWEST]);
ok(
  "once it is closed, the truck can be checked again",
  (await refuses(`insert into stock_count_sessions (org_id, kind, vehicle_id, blind) values ($1,'unit',$2,false)`, [ORG, TRUCK])) === null,
);
await db.query(`insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`, [ORG, BAY]);
ok(
  "two open walks of one BAY are still allowed — a recount is its own walk (D-INV21)",
  (await refuses(`insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`, [ORG, BAY])) === null,
);

// ── 1: one serial, one asset ─────────────────────────────────────────────────────────────────
const TYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity) values ($1,'Tablet',true,1) returning id`, [ORG])).id;
const RTYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity) values ($1,'Tablet',true,1) returning id`, [OTHER])).id;
const asset = (org, type, serial) =>
  refuses(`insert into inventory_assets (org_id, asset_type_id, name, serial_number) values ($1,$2,'Cab tablet',$3)`, [org, type, serial]);
ok("an asset with a serial is accepted", (await asset(ORG, TYPE, "R9TW40")) === null);
ok("the same serial again is refused", (await asset(ORG, TYPE, "R9TW40")) === "23505");
ok("...typed in lower case with a trailing space, too", (await asset(ORG, TYPE, " r9tw40 ")) === "23505");
ok("another org may hold the same serial", (await asset(OTHER, RTYPE, "R9TW40")) === null);
ok("two assets with no serial are fine", (await asset(ORG, TYPE, null)) === null && (await asset(ORG, TYPE, null)) === null);
ok("...and two with a blank one", (await asset(ORG, TYPE, "  ")) === null && (await asset(ORG, TYPE, "")) === null);
const err = await (async () => {
  try {
    await db.query(`insert into inventory_assets (org_id, asset_type_id, name, serial_number) values ($1,$2,'x','R9TW40')`, [ORG, TYPE]);
  } catch (e) {
    return e.message;
  }
})();
ok("the refusal names the index the API reads it by", /idx_inventory_assets_serial_unique/.test(err ?? ""), err);

// ── 2: a shelf's label code is assigned once ─────────────────────────────────────────────────
const PART = (await one(`insert into parts (org_id, part_number, description, unit_of_measure) values ($1,'LF-9009','Oil filter','each') returning id`, [ORG])).id;
await db.query(`insert into part_stock (org_id, part_id, location_id) values ($1,$2,$3)`, [ORG, PART, BAY]);
const setTag = (code) =>
  refuses(`update part_stock set tag_code = $1 where org_id=$2 and part_id=$3 and location_id=$4`, [code, ORG, PART, BAY]);
ok("a shelf line gets its first code", (await setTag("7K3M9P")) === null);
ok("...and setting the same code again changes nothing and is allowed", (await setTag("7K3M9P")) === null);
ok("a different code is refused (IV022)", (await setTag("ABCDEF")) === "IV022");
ok("...and so is clearing it", (await setTag(null)) === "IV022");
ok(
  "the line's other columns still change freely",
  (await refuses(`update part_stock set bin = 'B4' where org_id=$1 and part_id=$2`, [ORG, PART])) === null,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
