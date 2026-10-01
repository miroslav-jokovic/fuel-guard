// Silvicom 360 — one key per Samsara idling event (migration 0398, FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md I0).
//
// What can be wrong is the ORDER and the SCOPE:
//
//   · EXISTING PAIRS DO NOT BLOCK THE INDEX. Production holds 58,143 twin pairs when 0398 applies;
//     the key is null on all of them, so the unique index must create over them.
//   · ONCE KEYED, A TWIN CANNOT BE KEYED BESIDE IT. That is the whole point of the index.
//   · DELETE BEFORE KEY. The clean-up deletes one spelling and keys the other in one call; keying the
//     survivor while the twin still holds the key would collide.
//   · TENANT SCOPE IS THE ARGUMENT. A row id from another org in the payload is neither deleted nor
//     keyed.
//   · SERVICE ROLE ONLY. The browser cannot call the function.
//
// Run:  node supabase/tests/idle-event-key.test.mjs
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
const throws = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.message; }
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

const apply = async (fs) => {
  for (const f of fs) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};

// Everything before 0398, with a production-shaped twin pair already stored.
await apply(MIGRATIONS.filter((f) => f < "0398"));
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;
const ev = async (org, sid) => (await one(
  `insert into idle_events (org_id, samsara_event_id, started_at, duration_sec, classification)
   values ($1, $2, '2026-09-02T19:10:32Z', 600, 'discretionary') returning id`, [org, sid])).id;
const PLAIN = await ev(ORG, "3411b05c-3d84-4ad3-bcbe-4c6d819a6f15");
const HEX = await ev(ORG, "33343131-4230-3543-3344-383434414433");
const FOREIGN = await ev(OTHER, "3411b05c-3d84-4ad3-bcbe-4c6d819a6f15");
await apply(MIGRATIONS.filter((f) => f >= "0398"));

const col = await one(
  `select data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'idle_events' and column_name = 'event_key'`);
ok("idle_events.event_key is a nullable text column with no default",
  col?.data_type === "text" && col?.is_nullable === "YES" && col?.column_default === null, JSON.stringify(col ?? null));
ok("the unique index created over an existing, still-unkeyed twin pair",
  (await one(`select count(*)::int n from idle_events where org_id = $1`, [ORG])).n === 2);

// Keying the survivor while its twin still holds the key collides — the index is real.
await db.query(`update idle_events set event_key = '3411b05c3d844ad3' where id = $1`, [HEX]);
const collide = await throws(`update idle_events set event_key = '3411b05c3d844ad3' where id = $1`, [PLAIN]);
ok("a second row of the same org cannot take a key already held", /duplicate key|unique/i.test(collide ?? ""), String(collide));

// The function deletes first, so keying the survivor in the same call succeeds.
const r = await one(`select public.resolve_idle_event_twins($1, $2::uuid[], $3::jsonb) r`, [
  ORG, [HEX], JSON.stringify([{ id: PLAIN, event_key: "3411b05c3d844ad3" }]),
]).catch((e) => ({ r: { error: e.message } }));
ok("one call deletes the twin and keys the survivor", r.r.deleted === 1 && r.r.keyed === 1, JSON.stringify(r.r));
const left = (await db.query(`select id, event_key from idle_events where org_id = $1`, [ORG])).rows;
ok("the survivor is the plain-UUID row, keyed",
  left.length === 1 && left[0].id === PLAIN && left[0].event_key === "3411b05c3d844ad3", JSON.stringify(left));

// Another org's row named in the payload is untouched.
const s = await one(`select public.resolve_idle_event_twins($1, $2::uuid[], $3::jsonb) r`, [
  ORG, [FOREIGN], JSON.stringify([{ id: FOREIGN, event_key: "3411b05c3d844ad3" }]),
]);
const foreign = await one(`select event_key from idle_events where id = $1`, [FOREIGN]);
ok("another org's row is neither deleted nor keyed", s.r.deleted === 0 && s.r.keyed === 0 && foreign?.event_key === null,
  JSON.stringify({ r: s.r, foreign }));

// The same key may exist once per org.
await db.query(`update idle_events set event_key = '3411b05c3d844ad3' where id = $1`, [FOREIGN]);
ok("the same key may be held once in each org",
  (await one(`select count(*)::int n from idle_events where event_key = '3411b05c3d844ad3'`)).n === 2);

const grants = await one(
  `select has_function_privilege('authenticated', 'public.resolve_idle_event_twins(uuid, uuid[], jsonb)', 'execute') a,
          has_function_privilege('anon', 'public.resolve_idle_event_twins(uuid, uuid[], jsonb)', 'execute') n,
          has_function_privilege('service_role', 'public.resolve_idle_event_twins(uuid, uuid[], jsonb)', 'execute') s`);
ok("only the service role may call the clean-up", grants.a === false && grants.n === false && grants.s === true, JSON.stringify(grants));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
