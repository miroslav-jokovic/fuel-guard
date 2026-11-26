// Silvicom 360 — the warning desk's tables (migration 0653, WARNING-DESK-PLAN WD1).
//
// What the database itself promises: one open follow-up per problem, a status that moves only through
// transition_follow_up (validated, versioned, logged), an action record nobody can edit — the service
// role included — and a Samsara warning that converges on re-read.
//
// Run: node supabase/tests/warning-desk.test.mjs
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('desk@example.test') returning id`)).id;

// ── samsara_warnings converges on re-read ──────────────────────────────────────────────────────
const writeWarning = (key, active) =>
  sqlstate(
    `insert into samsara_warnings (org_id, source, source_key, kind, subject_kind, trailer_samsara_id, label, happened_at, still_active, updated_at)
     values ($1,'atis',$2,'atis','trailer','T1','ATIS lamp on','2026-11-26T08:00:00Z',$3, now())
     on conflict (org_id, source, source_key) do update set still_active = excluded.still_active, updated_at = excluded.updated_at`,
    [ORG, key, active],
  );
ok("a warning lands", (await writeWarning("T1:atis:a", true)) === null);
ok("the same warning re-read updates in place", (await writeWarning("T1:atis:a", false)) === null &&
  (await one(`select count(*)::int n, bool_or(still_active) a from samsara_warnings where org_id = $1`, [ORG])).n === 1);
ok("an unknown source is refused", (await sqlstate(
  `insert into samsara_warnings (org_id, source, source_key, kind, subject_kind, label, happened_at) values ($1,'email','k','x','truck','x',now())`, [ORG])) === "23514");
ok("a detail larger than 2 KB is refused", (await sqlstate(
  `insert into samsara_warnings (org_id, source, source_key, kind, subject_kind, label, happened_at, detail) values ($1,'alert','big','x','truck','x',now(), jsonb_build_object('a', repeat('x', 3000)))`, [ORG])) === "23514");

// ── one open follow-up per problem ─────────────────────────────────────────────────────────────
const openFollowUp = () =>
  db.query(
    `insert into follow_ups (org_id, rule_key, category, severity, subject_kind, subject_samsara_id, first_at, last_at)
     values ($1,'atis','maintenance','normal','trailer','T1', now() - interval '2 days', now()) returning id, version`,
    [ORG],
  );
const first = (await openFollowUp()).rows[0];
ok("a second open follow-up for the same problem is refused", (await sqlstate(
  `insert into follow_ups (org_id, rule_key, category, severity, subject_kind, subject_samsara_id, first_at, last_at)
   values ($1,'atis','maintenance','normal','trailer','T1', now(), now())`, [ORG])) === "23505");

// ── the one door ───────────────────────────────────────────────────────────────────────────────
const act = (id, action, note, version) =>
  sqlstate(`select transition_follow_up($1, $2, $3, $4, $5, $6)`, [ORG, id, USER, action, note, version]);
ok("Called driver moves New → called", (await act(first.id, "called", null, 1)) === null &&
  (await one(`select status, version, contacted_at is not null c, assignee_id = $2 mine from follow_ups where id = $1`, [first.id, USER])).status === "called");
ok("a stale version is refused (WD013)", (await act(first.id, "no_answer", null, 1)) === "WD013");
ok("No answer keeps the status and is logged", (await act(first.id, "no_answer", null, 2)) === null &&
  (await one(`select status from follow_ups where id = $1`, [first.id])).status === "called");
ok("a note action needs a note (WD015)", (await act(first.id, "note", "  ", 3)) === "WD015");
ok("closing as not a problem needs a note (WD015)", (await act(first.id, "closed_not_a_problem", null, 3)) === "WD015");
ok("an unknown action is refused (WD014)", (await act(first.id, "deleted", null, 3)) === "WD014");
ok("Close — fixed closes with outcome, time and who", (await act(first.id, "closed_fixed", "aired up at Pilot", 3)) === null &&
  (await one(`select status = 'closed' and outcome = 'fixed' and closed_at is not null and closed_by = $2 ok from follow_ups where id = $1`, [first.id, USER])).ok === true);
ok("a closed follow-up takes no further action (WD014)", (await act(first.id, "called", null, 4)) === "WD014");
ok("a follow-up in another org is not found (WD012)", (await sqlstate(`select transition_follow_up(gen_random_uuid(), $1, $2, 'called', null, 4)`, [first.id, USER])) === "WD012");
ok("every action is one row", (await one(`select count(*)::int n from follow_up_actions where follow_up_id = $1`, [first.id])).n === 3);

// After closing, the same problem may open again.
ok("a new follow-up for the same problem opens once the last is closed", (await openFollowUp()).rows.length === 1);

// ── the record is append-only, for everybody ───────────────────────────────────────────────────
ok("an action cannot be edited (WD011)", (await sqlstate(`update follow_up_actions set note = 'changed' where follow_up_id = $1`, [first.id])) === "WD011");
ok("an action cannot be deleted (WD011)", (await sqlstate(`delete from follow_up_actions where follow_up_id = $1`, [first.id])) === "WD011");

ok("status and outcome must agree", (await sqlstate(`update follow_ups set outcome = 'fixed' where id <> $1 and org_id = $2`, [first.id, ORG])) === "23514");

for (const t of ["samsara_warnings", "follow_up_rules", "follow_ups", "follow_up_actions"]) {
  ok(`${t}: row level security on, no client policy`,
    (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true &&
    (await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n === 0);
}
ok("transition_follow_up is closed to the browser",
  (await one(`select has_function_privilege('authenticated', 'transition_follow_up(uuid,uuid,uuid,text,text,int)', 'execute') p`)).p === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
