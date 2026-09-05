// Silvicom 360 — saved views: one reader's bookmarks, and nobody else's (0278).
//
// D-ROS14/15/16, docs/plans/roster/DRIVER-ROSTER-PLAN.md step R3c-2; owner ruling 2026-08-30
// answering that plan's §6 Q3.
//
// The ruling was "per user, private" — and "private" is a claim about the DATABASE, not about the
// UI, because the API reads with the service role and PostgREST is what this policy actually guards.
// So the load-bearing assertion here is the one that is easy to leave out: an ADMIN of the same
// organisation cannot read a colleague's saved views. Every other table in this product answers
// org-wide reads with yes; this one and `notification_events` are the two that must answer no, and a
// matrix that only proved cross-ORG isolation would pass just as happily on a policy that had
// dropped the `user_id` half.
//
// ⚠ The JWT subject must exist in auth.users: `saved_views.user_id` is a real FK, so a synthetic
// `sub` with no matching row fails every write on the FK — which looks exactly like an RLS refusal
// and would let this file "prove" a policy that was never exercised (HANDOFF-2026-08-30 §3).
//
// Run:  node supabase/tests/saved-views.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations run — full DML granted so that
// RLS is provably the only gate. Without this block a passing test proves nothing: the write would be
// refused by a missing GRANT rather than by the policy under test.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// The JWT subject must exist in auth.users. `drivers` and `vehicles` carry audit triggers whose
// audit_logs.actor_id is a real FK, so a synthetic `sub` with no matching row makes every write to
// those two tables fail on the FK — which looks exactly like an RLS refusal and would have let this
// matrix "prove" a revocation that had not happened. (`trailers` has no such trigger, which is how
// the discrepancy surfaced: it was the only table passing.) Modelling the user makes the policy the
// only thing under test, the same reason the default-privileges block above exists.
const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'tester@example.com')`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

// A second person in the SAME org, and a person in another org entirely.
const COLLEAGUE = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
await db.query(`insert into auth.users (id, email) values ($1,'colleague@example.com'), ($2,'outsider@example.com')`, [
  COLLEAGUE,
  OUTSIDER,
]);

/** Run one statement as `user` in `org`, holding `role`. */
async function asUser(user, org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

// Seeded with the service role, standing in for the API's own writes.
await db.query(
  `insert into saved_views (user_id, org_id, table_id, name, query)
   values ($1,$2,'roster.drivers','Terminated','status=terminated&sort=full_name')`,
  [ACTOR, ORG],
);

const SEE = "select count(*)::int as n from saved_views";
const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, SEE);
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};
const affected = async (user, org, role, sql, params) => {
  const res = await asUser(user, org, role, sql, params);
  return res.error ? `ERROR: ${res.error}` : (res.affectedRows ?? 0);
};

// ── The owner ───────────────────────────────────────────────────────────────────
ok("the reader who saved a view can read it back", (await countAs(ACTOR, ORG, "admin")) === 1);
ok(
  "…and can delete it",
  (await affected(ACTOR, ORG, "admin", "delete from saved_views where name = $1", ["Terminated"])) === 1,
);
ok(
  "…and can save another one",
  (await affected(ACTOR, ORG, "admin", `insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,'roster.drivers','Mine','q=a')`, [ACTOR, ORG])) === 1,
);

// ── Nobody else, INCLUDING an admin of the same organisation ────────────────────
// This is the assertion the whole file exists for. Every other table in the product answers an
// org-wide read with yes.
ok("a colleague in the SAME org reads nothing", (await countAs(COLLEAGUE, ORG, "admin")) === 0);
ok("a colleague cannot delete another person's view", (await affected(COLLEAGUE, ORG, "admin", "delete from saved_views")) === 0);
ok("a user in another org reads nothing", (await countAs(OUTSIDER, OTHER_ORG, "admin")) === 0);

// ── A row cannot be written INTO somebody else, or into another tenant ──────────
// `with check` is a separate clause from `using`, and a policy that had only the latter would let a
// reader plant a view in a colleague's list while still being unable to read it back.
const PLANT = `insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,'roster.drivers','Planted','q=x')`;
ok(
  "cannot save a view onto another user",
  String(await affected(COLLEAGUE, ORG, "admin", PLANT, [ACTOR, ORG])).startsWith("ERROR"),
);
ok(
  "cannot save a view into another org",
  String(await affected(ACTOR, ORG, "admin", PLANT, [ACTOR, OTHER_ORG])).startsWith("ERROR"),
);

// ── The key IS (user, table, name): saving over a name replaces rather than duplicates ──
await db.query(
  `insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,'roster.drivers','Dup','q=1')
   on conflict (user_id, table_id, name) do update set query = excluded.query`,
  [COLLEAGUE, ORG],
);
await db.query(
  `insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,'roster.drivers','Dup','q=2')
   on conflict (user_id, table_id, name) do update set query = excluded.query`,
  [COLLEAGUE, ORG],
);
const dup = await one(`select count(*)::int as n, max(query) as q from saved_views where name = 'Dup'`);
ok("saving over a name replaces it rather than making a second view", dup.n === 1 && dup.q === "q=2");

// …and the same name belongs to each person separately.
await db.query(`insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,'roster.drivers','Dup','q=3')`, [ACTOR, ORG]);
ok(
  "two people may each have a view called the same thing",
  (await one(`select count(*)::int as n from saved_views where name = 'Dup'`)).n === 2,
);

// ── The constraints the contract promises ───────────────────────────────────────
const refused = async (sql, params) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};
const INS = `insert into saved_views (user_id, org_id, table_id, name, query) values ($1,$2,$3,$4,$5)`;
ok(
  "an unknown table_id is refused, so the table cannot fill with rows no surface lists",
  await refused(INS, [ACTOR, ORG, "roster.unicorns", "X", "q=1"]),
);
ok("a blank name is refused", await refused(INS, [ACTOR, ORG, "roster.drivers", "   ", "q=1"]));
ok("an over-long query is refused", await refused(INS, [ACTOR, ORG, "roster.drivers", "Long", "x".repeat(2001)]));

// ── Org immutability (0161's invariant) ─────────────────────────────────────────
ok(
  "a view cannot be walked into another organisation by an update",
  await refused(`update saved_views set org_id = $1 where user_id = $2`, [OTHER_ORG, ACTOR]),
);

// ── Not evidence: the row goes when the account does ────────────────────────────
// `saved_views` is deliberately NOT in RETENTION_FORBIDDEN — a bookmark is the reader's, and nothing
// legal reads it. The cascade is the visible half of that decision.
await db.query(`delete from auth.users where id = $1`, [COLLEAGUE]);
ok(
  "deleting an account takes its saved views with it",
  (await one(`select count(*)::int as n from saved_views where user_id = $1`, [COLLEAGUE])).n === 0,
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
