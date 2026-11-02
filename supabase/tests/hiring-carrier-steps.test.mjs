// §10 CE1 (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9.3), migration 0545: the carrier's own hiring steps
// (retired never deleted, the proof never changed) and the office's done / undone records on each
// applicant — append-only, checked against the carrier's steps and the driver's own papers, moved by a
// roster merge, removed by the purge (that half is `purge-applicant.test.mjs`).
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
const invite = async (org, d) => (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
   values ($1, $2, md5(random()::text), now() + interval '10 days') returning id`, [org, d])).id;
const paper = async (org, d) => (await one(
  `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
   values (gen_random_uuid(), $1, 'driver', $2, 'other', $3, 'application/pdf', repeat('a', 64)) returning id`,
  [org, d, `${org}/driver/${d}/${Math.random()}.pdf`])).id;
const A = await driver(ORG, "Applicant A");
const A2 = await driver(ORG, "Applicant A (duplicate)");
const B = await driver(ORG, "Applicant B");
const X = await driver(OTHER, "Someone else's applicant");
const INV = await invite(ORG, A);
const INV_B = await invite(ORG, B);
const DOC_A = await paper(ORG, A);
const DOC_B = await paper(ORG, B);

const step = async (org, label, extra = {}) => (await one(
  `insert into hiring_carrier_steps (org_id, label, after_step, proof, blocks_hire, owes)
   values ($1, $2, $3, $4, $5, $6) returning id`,
  [org, label, extra.after ?? "road_test", extra.proof ?? "tick", extra.blocks ?? false, extra.owes ?? "us"])).id;
const record = (org, s, d, act, extra = {}) => sqlstate(
  `insert into hiring_carrier_step_records (org_id, step_id, driver_id, invitation_id, act, note, document_id, recorded_by_name)
   values ($1, $2, $3, $4, $5, $6, $7, 'Dana')`,
  [org, s, d, extra.inv ?? null, act, extra.note ?? null, extra.doc ?? null]);

// ── the carrier's list ────────────────────────────────────────────────────────────────────────
const FUEL = await step(ORG, "Fuel card issued");
const HAIR = await step(ORG, "Hair test", { after: "drug_test", proof: "document", blocks: true, owes: "them" });
const OLD = await step(ORG, "Old step");
const THEIRS = await step(OTHER, "Another carrier's step");
const fuel = await one(`select proof, owes, blocks_hire, position from hiring_carrier_steps where id = $1`, [FUEL]);
ok("a step defaults to a tick, owed by the office, not holding the hire, first in its place",
  fuel.proof === "tick" && fuel.owes === "us" && fuel.blocks_hire === false && fuel.position === 0);
ok("nothing may follow the hire (23514)",
  (await sqlstate(`insert into hiring_carrier_steps (org_id, label, after_step) values ($1, 'x', 'hired')`, [ORG])) === "23514");
ok("a place that is not a step key's shape is refused (23514)",
  (await sqlstate(`insert into hiring_carrier_steps (org_id, label, after_step) values ($1, 'x', 'Drug Test!')`, [ORG])) === "23514");
ok("a blank name is refused (23514)",
  (await sqlstate(`insert into hiring_carrier_steps (org_id, label, after_step) values ($1, '   ', 'road_test')`, [ORG])) === "23514");
ok("an unknown proof is refused (23514)",
  (await sqlstate(`insert into hiring_carrier_steps (org_id, label, after_step, proof) values ($1, 'x', 'road_test', 'date')`, [ORG])) === "23514");
ok("the name, instructions, place, owes and the hire switch are the office's to edit",
  (await sqlstate(`update hiring_carrier_steps set label = 'Fuel card + PIN issued', instructions = 'At the desk',
     after_step = 'handbook', position = 2, owes = 'them', blocks_hire = true where id = $1`, [FUEL])) === null);
ok("what proves a step never changes (CS011)",
  (await sqlstate(`update hiring_carrier_steps set proof = 'document' where id = $1`, [FUEL])) === "CS011");
ok("a step never moves carrier (CS011)",
  (await sqlstate(`update hiring_carrier_steps set org_id = $1 where id = $2`, [OTHER, FUEL])) === "CS011");
ok("a step is never deleted (CS010)", (await sqlstate(`delete from hiring_carrier_steps where id = $1`, [OLD])) === "CS010");
ok("a step is retired", (await sqlstate(`update hiring_carrier_steps set retired_at = now() where id = $1`, [OLD])) === null);
ok("retiring is one-way (CS012)",
  (await sqlstate(`update hiring_carrier_steps set retired_at = null where id = $1`, [OLD])) === "CS012");

// ── the records ───────────────────────────────────────────────────────────────────────────────
ok("a tick step is done with no paper", (await record(ORG, FUEL, A, "done", { inv: INV })) === null);
ok("a tick step refuses a paper it did not ask for (CS027)", (await record(ORG, FUEL, A, "done", { doc: DOC_A })) === "CS027");
ok("a document step done without its paper is refused (CS026)", (await record(ORG, HAIR, A, "done")) === "CS026");
ok("…and with another applicant's paper (CS026)", (await record(ORG, HAIR, A, "done", { doc: DOC_B })) === "CS026");
ok("a document step is done with this applicant's own paper", (await record(ORG, HAIR, A, "done", { doc: DOC_A })) === null);
ok("an undo without a reason is refused (CS028)", (await record(ORG, FUEL, A, "undone")) === "CS028");
ok("an undo with a reason is recorded", (await record(ORG, FUEL, A, "undone", { note: "Card was for the wrong truck" })) === null);
ok("an undo carries no paper (CS027)", (await record(ORG, HAIR, A, "undone", { note: "x", doc: DOC_A })) === "CS027");
ok("another carrier's step reads as no step (CS024)", (await record(ORG, THEIRS, A, "done")) === "CS024");
ok("another carrier's driver is refused (CS022)", (await record(ORG, FUEL, X, "done")) === "CS022");
ok("another applicant's invitation is refused (CS023)", (await record(ORG, FUEL, A, "done", { inv: INV_B })) === "CS023");
ok("a retired step is never newly done (CS025)", (await record(ORG, OLD, A, "done")) === "CS025");
ok("…but a mistake on it can still be undone", (await record(ORG, OLD, A, "undone", { note: "Retired before use" })) === null);
const latest = await one(
  `select act from hiring_carrier_step_records where driver_id = $1 and step_id = $2 order by recorded_at desc, id desc limit 1`, [A, FUEL]);
ok("the records keep every act, and the latest is the undo", latest.act === "undone" &&
  Number((await one(`select count(*)::int n from hiring_carrier_step_records where driver_id = $1 and step_id = $2`, [A, FUEL])).n) === 2);
const R = (await one(`select id from hiring_carrier_step_records where driver_id = $1 and step_id = $2 limit 1`, [A, HAIR])).id;
ok("a record is never edited (CS021)", (await sqlstate(`update hiring_carrier_step_records set note = 'changed' where id = $1`, [R])) === "CS021");
ok("a record is never deleted (CS020)", (await sqlstate(`delete from hiring_carrier_step_records where id = $1`, [R])) === "CS020");
ok("a step with records still cannot be deleted (CS010)", (await sqlstate(`delete from hiring_carrier_steps where id = $1`, [HAIR])) === "CS010");
ok("the paper behind a record cannot be deleted out from under it (restrict)",
  (await sqlstate(`delete from documents where id = $1`, [DOC_A])) !== null);

// ── the roster merge moves the records, inside the carrier ────────────────────────────────────
ok("the merge's move to the canonical driver in this carrier is allowed",
  (await sqlstate(`update hiring_carrier_step_records set driver_id = $1 where driver_id = $2`, [A2, A])) === null);
ok("a move to another carrier's driver is refused (CS022)",
  (await sqlstate(`update hiring_carrier_step_records set driver_id = $1 where driver_id = $2`, [X, A2])) === "CS022");
ok("a driver with records cannot be deleted out from under them (restrict)",
  (await sqlstate(`delete from drivers where id = $1`, [A2])) !== null);

// ── the built-in steps a carrier does not run ─────────────────────────────────────────────────
await db.query(`insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 7, true, 48)`, [ORG]);
ok("a carrier starts hiding nothing",
  (await one(`select hidden_hiring_steps h from recruiting_settings where org_id = $1`, [ORG])).h.length === 0);
ok("the carrier's hidden list is stored",
  (await sqlstate(`update recruiting_settings set hidden_hiring_steps = array['psp', 'travel_booked'] where org_id = $1`, [ORG])) === null);

// ── the API's only door ───────────────────────────────────────────────────────────────────────
for (const t of ["hiring_carrier_steps", "hiring_carrier_step_records"]) {
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  const rls = (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r;
  ok(`${t}: RLS is on with no client policy — deny-all from a browser`, policies === 0 && rls === true);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
