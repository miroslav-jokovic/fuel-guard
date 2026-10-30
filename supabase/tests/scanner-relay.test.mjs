// Silvicom 360 — scanner relay matrix (migration 0532, SCANNER-RELAY-PLAN.md step SR1).
//
// What is pinned is what "a trigger pull lands on exactly one screen, now" rests on:
//   1. Nothing crosses organizations: a scanner on another org's station, a read or a port report
//      filed under another org (SR001).
//   2. One live scanner per station port; a lease is whole or absent; a retired scanner is unheld.
//   3. The lease (D-SR3): one tab at a time, the holder named to anybody else, renewed by its own
//      tab without losing when it began, taken over only when asked, free once it lapses.
//   4. Routing (D-SR4): a read goes to the tab holding the scanner at that instant, or to nobody —
//      never to a lapsed lease — and only from the station that reads that scanner (SR002). The
//      station's age is capped at 30 s and never dates a read in the future (D-SR5).
//   5. A read is fixed once recorded (SR003); retention may still delete it (D-SR7).
//   6. Browsers see nothing and can call neither function.
//
// Run: node supabase/tests/scanner-relay.test.mjs


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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ACTOR = "00000000-0000-4000-8000-000000000001";
const TECH = "00000000-0000-4000-8000-000000000002";
await db.query(`insert into auth.users (id, email) values ($1,'office@test'), ($2,'tech@test')`, [ACTOR, TECH]);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const RIVAL = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const HASH = (c) => c.repeat(64);
const station = async (name, org = ORG, token = null) =>
  (
    await one(
      `insert into print_stations (org_id, name, token_hash, paired_at)
       values ($1, $2, $3, case when $3::text is null then null else now() end) returning id`,
      [org, name, token],
    )
  ).id;
const scanner = async (stationId, name, port, org = ORG) =>
  (
    await one(`insert into scanners (org_id, station_id, name, port_name) values ($1,$2,$3,$4) returning id`, [
      org,
      stationId,
      name,
      port,
    ])
  ).id;
const take = async (scannerId, user, session, force = false, org = ORG) =>
  one(`select * from scanner_take($1,$2,$3,$4,$5)`, [org, scannerId, user, session, force]);
const record = async (stationId, scannerId, code, ageMs = 0) =>
  one(`select * from scanner_record_read($1,$2,$3,$4)`, [stationId, scannerId, code, ageMs]);

const OFFICE = await station("Office PC", ORG, HASH("a"));
const SHOP_PC = await station("Shop PC", ORG, HASH("b"));
const RIVAL_PC = await station("Rival PC", RIVAL, HASH("c"));
const DESK = await scanner(OFFICE, "Desk scanner", "COM3");
const SHOP = await scanner(SHOP_PC, "Shop scanner", "/dev/cu.usbmodem1101");
const TAB_A = randomUUID();
const TAB_B = randomUUID();

// ── 1. Nothing crosses organizations ────────────────────────────────────────────────────────────
ok(
  "a scanner cannot sit on another organization's station",
  (await refuses(`insert into scanners (org_id, station_id, name, port_name) values ($1,$2,'X','COM9')`, [ORG, RIVAL_PC])) === "SR001",
);
ok(
  "a read cannot be filed under another organization",
  (await refuses(`insert into scanner_reads (org_id, scanner_id, code) values ($1,$2,'SIL1:TEST:Ok-42z')`, [RIVAL, DESK])) === "SR001",
);
ok(
  "a station's port report cannot be filed under another organization",
  (await refuses(`insert into print_station_ports (station_id, org_id) values ($1,$2)`, [OFFICE, RIVAL])) === "SR001",
);
ok(
  "a scanner's organization cannot change",
  (await refuses(`update scanners set org_id = $1 where id = $2`, [RIVAL, DESK])) !== null,
);

// ── 2. One live scanner per port ────────────────────────────────────────────────────────────────
ok(
  "two live scanners cannot share a station's port",
  (await refuses(`insert into scanners (org_id, station_id, name, port_name) values ($1,$2,'Second','COM3')`, [ORG, OFFICE])) === "23505",
);
ok(
  "the same port name on ANOTHER station is a different port",
  (await refuses(`insert into scanners (org_id, station_id, name, port_name) values ($1,$2,'Shop COM3','COM3')`, [ORG, SHOP_PC])) === null,
);
const OLD = await scanner(OFFICE, "Old scanner", "COM7");
await db.query(`update scanners set retired_at = now() where id = $1`, [OLD]);
ok(
  "a retired scanner frees its port",
  (await refuses(`insert into scanners (org_id, station_id, name, port_name) values ($1,$2,'New scanner','COM7')`, [ORG, OFFICE])) === null,
);
ok(
  "a lease is whole or absent",
  (await refuses(`update scanners set held_session = gen_random_uuid() where id = $1`, [SHOP])) === "23514",
);
ok(
  "a retired scanner cannot be held",
  (await refuses(
    `update scanners set held_session = gen_random_uuid(), held_since = now(), held_until = now() + interval '1 minute' where id = $1`,
    [OLD],
  )) === "23514",
);
ok("USB ids are four lower-case hex digits", (await refuses(`update scanners set usb_vendor_id = '0X81' where id = $1`, [SHOP])) === "23514");

// ── 3. The lease: one tab at a time ─────────────────────────────────────────────────────────────
const first = await take(DESK, ACTOR, TAB_A);
ok("a free scanner is taken", first.outcome === "taken" && first.holder === ACTOR);
const since = (await one(`select held_since from scanners where id = $1`, [DESK])).held_since;
const refused = await take(DESK, TECH, TAB_B);
ok("another tab is told who holds it", refused.outcome === "held" && refused.holder === ACTOR);
ok(
  "and the lease is unchanged",
  (await one(`select held_session from scanners where id = $1`, [DESK])).held_session === TAB_A,
);
ok(
  "another person presenting the holder's tab id is refused, not renewed",
  (await take(DESK, TECH, TAB_A)).outcome === "held" &&
    (await one(`select held_by from scanners where id = $1`, [DESK])).held_by === ACTOR,
);
await db.query(`update scanners set held_until = now() + interval '5 seconds' where id = $1`, [DESK]);
const renewed = await take(DESK, ACTOR, TAB_A);
const afterRenew = await one(`select held_since, held_until > now() + interval '80 seconds' as long from scanners where id = $1`, [DESK]);
ok("the holder's own take renews the lease to 90 s", renewed.outcome === "taken" && afterRenew.long === true);
ok("a renewal keeps when it was first taken", afterRenew.held_since.getTime() === since.getTime());
const forced = await take(DESK, TECH, TAB_B, true);
ok("taking it over, once asked, moves it", forced.outcome === "taken" && forced.holder === TECH);
ok(
  "the old tab's renewal is now refused, naming the new holder",
  (await take(DESK, ACTOR, TAB_A)).holder === TECH && (await take(DESK, ACTOR, TAB_A)).outcome === "held",
);
await db.query(`update scanners set held_until = now() - interval '1 second' where id = $1`, [DESK]);
ok("a lapsed lease is free to anybody", (await take(DESK, ACTOR, TAB_A)).outcome === "taken");
ok("a retired scanner cannot be taken", (await take(OLD, ACTOR, TAB_A)).outcome === "retired");
ok("another organization's scanner does not exist", (await take(DESK, ACTOR, TAB_A, false, RIVAL)).outcome === "missing");

// ── 4. A read goes to the holder at that instant, or to nobody ─────────────────────────────────
await db.query(`update print_stations set last_seen_at = now() - interval '1 hour' where id = $1`, [OFFICE]);
const routed = await record(OFFICE, DESK, "SIL1:AST:7K3M9P");
const routedRow = await one(`select delivered_session, delivered_to from scanner_reads where id = $1`, [routed.read_id]);
ok("a read is routed to the tab holding the scanner", routed.delivered === true && routedRow.delivered_session === TAB_A);
ok("and names the person", routedRow.delivered_to === ACTOR);
ok(
  "a read is the station's heartbeat",
  (await one(`select last_seen_at > now() - interval '5 seconds' as fresh from print_stations where id = $1`, [OFFICE])).fresh === true,
);
await db.query(`update scanners set held_until = now() - interval '1 second' where id = $1`, [DESK]);
const lapsed = await record(OFFICE, DESK, "SIL1:AST:7K3M9Q");
ok(
  "a lapsed lease receives nothing",
  lapsed.delivered === false &&
    (await one(`select delivered_session from scanner_reads where id = $1`, [lapsed.read_id])).delivered_session === null,
);
const nobody = await record(SHOP_PC, SHOP, "012345678905");
ok("with nobody holding it, the read is kept undelivered", nobody.delivered === false && (await num(`select count(*)::int as n from scanner_reads where id = $1`, [nobody.read_id])) === 1);
ok(
  "a station cannot put reads on another station's scanner",
  (await refuses(`select * from scanner_record_read($1,$2,'x',0)`, [SHOP_PC, DESK])) === "SR002",
);
ok("nor on a retired scanner", (await refuses(`select * from scanner_record_read($1,$2,'x',0)`, [OFFICE, OLD])) === "SR002");
ok(
  "nor on a scanner that does not exist",
  (await refuses(`select * from scanner_record_read($1,$2,'x',0)`, [OFFICE, randomUUID()])) === "SR002",
);
const aged = await record(SHOP_PC, SHOP, "AGED-READ-1", 999_999);
ok(
  "a station's age is capped at 30 s",
  (await one(`select now() - read_at between interval '29 seconds' and interval '31 seconds' as capped from scanner_reads where id = $1`, [aged.read_id])).capped === true,
);
const future = await record(SHOP_PC, SHOP, "FUTURE-READ", -50_000);
ok(
  "a negative age cannot date a read in the future",
  (await one(`select read_at <= now() as past from scanner_reads where id = $1`, [future.read_id])).past === true,
);
ok("an empty read is refused", (await refuses(`select * from scanner_record_read($1,$2,'',0)`, [SHOP_PC, SHOP])) === "23514");

// ── 5. A read is fixed once recorded; retention may still delete it ───────────────────────────
ok("a read's routing cannot be rewritten", (await refuses(`update scanner_reads set delivered_session = null where id = $1`, [routed.read_id])) === "SR003");
ok("a read's code cannot be rewritten", (await refuses(`update scanner_reads set code = 'other' where id = $1`, [routed.read_id])) === "SR003");
ok("retention can delete a read", (await refuses(`delete from scanner_reads where id = $1`, [aged.read_id])) === null);

// ── 6. Browsers see nothing ─────────────────────────────────────────────────────────────────────
const asRole = async (role, fn) => {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("rollback");
  }
};
for (const t of ["scanners", "scanner_reads", "print_station_ports"]) {
  ok(`an admin's browser session reads no ${t}`, (await asRole("admin", () => num(`select count(*)::int as n from ${t}`))) === 0);
}
ok(
  "a browser session cannot record a read",
  (await asRole("admin", () => refuses(`select * from scanner_record_read($1,$2,'x',0)`, [OFFICE, DESK]))) === "42501",
);
ok(
  "a browser session cannot take a scanner",
  (await asRole("admin", () => refuses(`select * from scanner_take($1,$2,$3,$4,false)`, [ORG, DESK, ACTOR, TAB_A]))) === "42501",
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
