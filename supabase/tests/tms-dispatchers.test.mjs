// Silvicom 360 — tms_dispatchers (migration 0344, LIVE-MAP-PLAN.md LM2 / LOADS-GO-LIVE-PLAN.md L3).
//
// `movement.dispatcher_user_id` is populated on 110 of 110 dispatched loads (measured on the live
// board, 2026-09-17) and the ingest has been throwing it away for want of somewhere to put it. Four
// properties have to hold in the DATABASE rather than in the service, because the service is the
// thing most likely to be wrong:
//
//   · THE KEY IS (org, provider, external_id). McLeod ids like 'loadmaster' are not globally unique —
//     two carriers both have one, and a carrier running two TMS instances has two. If the key were
//     just the external id, one org's dispatcher would collide with another's, which is a
//     cross-tenant defect and not merely a duplicate.
//   · `user_id` SURVIVES THE USER. `on delete set null`, never cascade: removing a Silvicom login
//     must not delete the record that a McLeod dispatcher exists, or the next sweep would recreate
//     the row with the office's hand-made link silently gone.
//   · A LOAD MAY NAME A DISPATCHER WE HAVE NOT SYNCED YET. Loads and dispatchers are two separate
//     pushes, so there is deliberately NO foreign key. This matrix pins that ABSENCE, because it is
//     the kind of thing a later reader "fixes" — and the fix would make one unknown account reject a
//     157-load batch.
//   · NOTHING READS THIS FROM A BROWSER. RLS on, zero policies, deny-all on purpose.
//
// Run:  node supabase/tests/tms-dispatchers.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;

const put = (org, external, cols = "", vals = "") =>
  sqlstate(
    `insert into tms_dispatchers (org_id, provider, external_id ${cols})
     values ($1, 'mcleod', $2 ${vals})`,
    [org, external],
  );

// ── the happy path, and the defaults a sweep relies on ───────────────────────────────────────────
ok("a dispatcher stores for an org", (await put(ORG_A, "jsmith")) === null);
const row = await one(
  `select user_id, is_system, is_active from tms_dispatchers where org_id = $1 and external_id = 'jsmith'`,
  [ORG_A],
);
ok("unlinked is the NORMAL state — 15 McLeod accounts against 2 Silvicom memberships (D-LM4)",
  row.user_id === null);
ok("a new account is assumed to be a person until configuration says otherwise", row.is_system === false);
ok("and assumed active, because the feed sends is_active explicitly when it is not", row.is_active === true);

// ── the key: the same McLeod id is a DIFFERENT dispatcher in another carrier ─────────────────────
ok("the same external id in another org is a different dispatcher, not a collision",
  (await put(ORG_B, "jsmith")) === null);
ok("but the same id twice in ONE org is refused", (await put(ORG_A, "jsmith")) === "23505");
ok("and the same id under another provider is allowed — that is why provider is in the key",
  (await sqlstate(
    `insert into tms_dispatchers (org_id, provider, external_id) values ($1, 'other_tms', 'jsmith')`,
    [ORG_A],
  )) === null);

// ── the link is the office's, and it outlives the login ──────────────────────────────────────────
const USER = (await one(`insert into auth.users (email) values ('dispatcher@carrier.test') returning id`)).id;
await db.query(`update tms_dispatchers set user_id = $1 where org_id = $2 and external_id = 'jsmith' and provider = 'mcleod'`,
  [USER, ORG_A]);
await db.query(`delete from auth.users where id = $1`, [USER]);
const survived = await one(
  `select count(*)::int n, bool_and(user_id is null) cleared from tms_dispatchers
    where org_id = $1 and external_id = 'jsmith' and provider = 'mcleod'`, [ORG_A]);
ok("deleting the Silvicom user CLEARS the link rather than deleting the dispatcher (on delete set null)",
  survived.n === 1 && survived.cleared === true, JSON.stringify(survived));

// ── the deliberate absence: no FK from loads, because the two feeds arrive separately ────────────
// ⚠ `provider` is set, and that is the whole point of this fixture. A composite foreign key
// containing a NULL is not enforced (MATCH SIMPLE), so a load with a null provider would sail past
// the very constraint this test exists to forbid — measured 2026-09-17: adding the FK left the
// matrix 14/14 green until this line set it. The real ingest always writes provider.
const LOAD = await sqlstate(
  `insert into loads (org_id, ref, status, source, provider, dispatcher_external_id)
   values ($1, 'LD-1', 'pending_approval', 'tms', 'mcleod', 'nobody_we_have_synced_yet')`,
  [ORG_A],
);
ok("a load may name a dispatcher we have not synced yet — there is NO foreign key, on purpose",
  LOAD === null, String(LOAD));
ok("and the column is nullable, because an unassigned load has no dispatcher at all (46 of 157 on the live board)",
  (await sqlstate(
    `insert into loads (org_id, ref, status, source) values ($1, 'LD-2', 'pending_approval', 'tms')`,
    [ORG_A],
  )) === null);

// ── tenancy and reachability ─────────────────────────────────────────────────────────────────────
await db.query(`delete from organizations where id = $1`, [ORG_B]);
ok("deleting an org takes its dispatchers with it",
  Number((await one(`select count(*)::int n from tms_dispatchers where org_id = $1`, [ORG_B])).n) === 0);

const rls = await one(
  `select c.relrowsecurity enabled,
          (select count(*)::int from pg_policies p where p.tablename = 'tms_dispatchers') policies
     from pg_class c where c.relname = 'tms_dispatchers'`);
ok("RLS is on", rls.enabled === true);
ok("with zero policies — deny-all on purpose, the API reads it with the service role", rls.policies === 0);

ok("the board's dispatcher filter has an index to read (org, status, dispatcher)",
  Number((await one(
    `select count(*)::int n from pg_indexes
      where tablename = 'loads' and indexname = 'loads_org_status_dispatcher_idx'`)).n) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
