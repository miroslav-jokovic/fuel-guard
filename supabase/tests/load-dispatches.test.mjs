// Silvicom 360 — load_dispatches, the office's act of sending a load to a driver (migration 0370,
// LOADS-MIRROR-PLAN.md LR-D1; D-LMR5, D-LMR6).
//
// Four promises, each held by the DATABASE because LR-D2's endpoint writes with the service role:
//
//   · The outcome cannot lie. An SMS reads `sent` only with the number it went to and the provider's
//     message id; anything short of sent carries a reason. SMS is dark today, so every real row will
//     be `not_sent` — and nothing a caller does can write it as sent.
//   · Append-only. No column is edited and no row deleted — except `driver_id`, which a roster merge
//     moves onto the surviving record (the real DRIVER_REASSIGNMENTS list is driven here).
//   · One organization. The load and the driver must be the row's org, whatever the caller passes.
//   · Nobody reads it through the client: RLS on, no policy.
//
// Run:  node supabase/tests/load-dispatches.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

// The REAL merge list, parsed the way lint:driver-references parses it.
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) { console.error("could not parse DRIVER_REASSIGNMENTS"); process.exit(1); }

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
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
// Supabase's default privileges, before the migrations, as rls.test.mjs installs them: RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Someone else");
const DISPATCHER = (await one(`insert into auth.users (email) values ('dispatch@carrier.test') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'dispatcher')`, [ORG, DISPATCHER]);
const driver = async (o, name) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, 'active') returning id`, [o, name])).id;
const DRIVER = await driver(ORG, "Dana Kelly");
const DUP = await driver(ORG, "Dana Kelly (dup)");
const FOREIGN_DRIVER = await driver(OTHER, "Not ours");
let n = 0;
const load = async (o) => {
  n++;
  return (await one(
    `insert into loads (org_id, ref, status, source, provider, external_id) values ($1, $2, 'in_transit', 'tms', 'mcleod', $2) returning id`,
    [o, `MC-${n}`])).id;
};
const LOAD = await load(ORG);
const FOREIGN_LOAD = await load(OTHER);

const COLS = "org_id, load_id, driver_id, sent_by, channel, outcome, outcome_reason, recipient, body, provider_message_id";
const dispatch = (r) => sqlstate(
  `insert into load_dispatches (${COLS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [r.org ?? ORG, r.load ?? LOAD, r.driver ?? DRIVER, DISPATCHER, r.channel ?? "sms", r.outcome ?? "not_sent",
    "reason" in r ? r.reason : "sms_not_configured", r.recipient ?? null, "Load MC-1: pick up 09/25", r.msgId ?? null]);

// ── 1. the outcome cannot lie ────────────────────────────────────────────────────────────────────
ok("today's row — an SMS not sent because SMS is not configured — is accepted", (await dispatch({})) === null);
ok("an SMS cannot read `sent` without the provider's message id (23514)",
  (await dispatch({ outcome: "sent", reason: null, recipient: "+13125550100" })) === "23514");
ok("an SMS cannot read `sent` without the number it went to (23514)",
  (await dispatch({ outcome: "sent", reason: null, msgId: "tx-1" })) === "23514");
ok("an SMS with a number and a receipt may read `sent`",
  (await dispatch({ outcome: "sent", reason: null, recipient: "+13125550100", msgId: "tx-1" })) === null);
ok("a send that did not happen must say why (23514)", (await dispatch({ reason: null })) === "23514");
ok("a send that happened carries no failure reason (23514)",
  (await dispatch({ outcome: "sent", reason: "sms_not_configured", recipient: "+13125550100", msgId: "tx-2" })) === "23514");
ok("a channel outside sms / app is refused (23514)", (await dispatch({ channel: "email" })) === "23514");
ok("an outcome outside sent / not_sent / failed is refused (23514)", (await dispatch({ outcome: "queued" })) === "23514");

// ── 2. append-only ───────────────────────────────────────────────────────────────────────────────
const ROW = (await one(`select id from load_dispatches where outcome = 'not_sent' order by sent_at limit 1`)).id;
ok("what was sent cannot be rewritten (LD011)",
  (await sqlstate(`update load_dispatches set body = 'something else' where id = $1`, [ROW])) === "LD011");
ok("a not-sent row cannot be turned into a sent one (LD011)",
  (await sqlstate(`update load_dispatches set outcome = 'failed', outcome_reason = 'x' where id = $1`, [ROW])) === "LD011");
ok("when it was sent cannot be moved (LD011)",
  (await sqlstate(`update load_dispatches set sent_at = sent_at - interval '1 day' where id = $1`, [ROW])) === "LD011");
ok("a dispatch cannot be deleted (LD011)", (await sqlstate(`delete from load_dispatches where id = $1`, [ROW])) === "LD011");
ok("the load it records cannot be deleted from under it (23001, on delete restrict)",
  (await sqlstate(`delete from loads where id = $1`, [LOAD])) === "23001");
ok("the person who sent it cannot be deleted out of the record (23503)",
  (await sqlstate(`delete from auth.users where id = $1`, [DISPATCHER])) === "23503");

// ── 3. one organization ──────────────────────────────────────────────────────────────────────────
ok("another org's load cannot be dispatched under ours (LD010)", (await dispatch({ load: FOREIGN_LOAD })) === "LD010");
ok("nor sent to another org's driver (LD010)", (await dispatch({ driver: FOREIGN_DRIVER })) === "LD010");
ok("nor filed under another org when load and driver are ours (LD010)", (await dispatch({ org: OTHER })) === "LD010");
ok("a merge-shaped move of driver_id to another org's driver is refused (LD010)",
  (await sqlstate(`update load_dispatches set driver_id = $2 where id = $1`, [ROW, FOREIGN_DRIVER])) === "LD010");

// ── 4. a roster merge carries the dispatch onto the surviving driver ─────────────────────────────
ok("the real DRIVER_REASSIGNMENTS list names load_dispatches",
  MOVES.some((m) => m.table === "load_dispatches" && m.column === "driver_id" && m.org_scoped));
ok("a dispatch to the duplicate record is written", (await dispatch({ driver: DUP })) === null);
const withoutEntry = JSON.stringify(MOVES.filter((m) => m.table !== "load_dispatches"));
ok("WITHOUT the list entry the merge aborts (on delete restrict) instead of losing the row",
  (await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP, DRIVER, withoutEntry])) === "23001");
ok("with the real list the merge completes",
  (await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP, DRIVER, JSON.stringify(MOVES)])) === null);
ok("…and the dispatch now names the surviving driver, nothing else changed",
  (await one(`select count(*)::int c from load_dispatches where driver_id = $1`, [DUP])).c === 0 &&
  (await one(`select count(*)::int c from load_dispatches where driver_id = $1 and body = 'Load MC-1: pick up 09/25'`, [DRIVER])).c === 3);

// ── 5. RLS: on, no client policy ─────────────────────────────────────────────────────────────────
ok("RLS is enabled", (await one(`select relrowsecurity r from pg_class where relname = 'load_dispatches'`)).r === true);
ok("and no policy is declared — deny-all is the design",
  (await one(`select count(*)::int c from pg_policies where tablename = 'load_dispatches'`)).c === 0);
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)",
  [JSON.stringify({ sub: DISPATCHER, org_id: ORG, user_role: "dispatcher" })]);
const seen = (await db.query(`select id from load_dispatches`)).rows.length;
const wrote = await sqlstate(`insert into load_dispatches (${COLS}) values ($1,$2,$3,$4,'sms','not_sent','x',null,'b',null)`,
  [ORG, LOAD, DRIVER, DISPATCHER]);
await db.exec("rollback");
ok("an office user of the same org reads nothing through the client — the API is the only door", seen === 0);
ok("…and cannot write one either (42501)", wrote === "42501");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
