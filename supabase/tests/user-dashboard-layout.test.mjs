// Silvicom 360 — user_dashboard_layout: one person's Dashboard arrangement (0343).
//
// D-DW2/D-DW3, docs/plans/livemap/LIVE-MAP-PLAN.md step LM10. The migration header carries the
// argument and `dashboardLayoutContract.ts` carries the meaning of the value; this matrix carries
// the part only the database can answer.
//
// It is the sibling of `user-surface-access.test.mjs`, and — exactly as that file says of ITS
// sibling — the DIFFERENCES are what this one exists to pin, because each of them is a decision
// somebody could mistake for an oversight:
//
//  1. **The read is OWN-ROW, and 0298's is org-wide.** What a role may REACH is not a secret from
//     the org that configured it, and the permissions page shows it. How somebody arranged their own
//     screen is not the org's business — `saved_views` (0278) and `notification_events` (0089) made
//     the same call. An admin reading a colleague's layout is asserted to be refused below, which is
//     the assertion most likely to be deleted by somebody "fixing" a support tool.
//  2. **A key is BOTH kept and hidden, or neither.** `not (widget_keys && hidden_keys)` is the only
//     CHECK in this table that encodes a rule rather than a ceiling: kept and hidden answer the same
//     question, and without the constraint the resolver would have to invent a winner in TypeScript
//     for a state the database was happy to store.
//  3. **A key in NEITHER array is the interesting one**, and SQL cannot see it. That is the state
//     LM10's Done-when turns on ("still inherits a later default change to widgets they did not
//     touch") and it is pinned in `dashboardLayoutContract.test.ts`, not here — noted so a reader
//     looking for it stops looking.
//  4. **No client may WRITE this table**, for a reason that is NOT 0298's. A layout is not
//     audit-worthy and the API writes no audit row for one. It is that the endpoint validates keys
//     against the widget catalogue and PostgREST cannot, plus this repo's one-writer-per-table rule.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records: a
// synthetic `sub` with no matching row fails writes on an FK, which looks exactly like an RLS
// refusal and lets a matrix "prove" a policy it never exercised. Here it is doubly true — the
// composite FK to `memberships` means an unmodelled member fails every insert.
//
// Run:  node supabase/tests/user-dashboard-layout.test.mjs
//
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

// ── The cast: one org with three members, and an outsider in another org ────────
const PLANNER = "00000000-0000-4000-8000-000000000001"; // dispatcher, the person who arranged a layout
const COLLEAGUE = "00000000-0000-4000-8000-000000000002"; // dispatcher, and must not be able to read it
const BOSS = "00000000-0000-4000-8000-000000000003"; // admin — and an admin may not read it either
const OUTSIDER = "00000000-0000-4000-8000-000000000004";
await db.query(
  `insert into auth.users (id, email) values
     ($1,'planner@example.com'), ($2,'colleague@example.com'), ($3,'boss@example.com'), ($4,'outsider@example.com')`,
  [PLANNER, COLLEAGUE, BOSS, OUTSIDER],
);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

const member = (org, user, role) =>
  db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3::user_role)`, [org, user, role]);
await member(ORG, PLANNER, "dispatcher");
await member(ORG, COLLEAGUE, "dispatcher");
await member(ORG, BOSS, "admin");
await member(OTHER_ORG, OUTSIDER, "dispatcher");

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
// ── Seeded with the service role, standing in for the API's own writes ──────────
// The planner kept the map first and hid the money chart; the outsider arranged their own, in an
// org this one may never learn anything about.
const SET = `insert into user_dashboard_layout (org_id, user_id, widget_keys, hidden_keys)
             values ($1,$2,$3,$4)`;
await db.query(SET, [ORG, PLANNER, ["dispatch.live-map", "fleet.kpi-hero"], ["fleet.spend-trend"]]);
await db.query(SET, [OTHER_ORG, OUTSIDER, ["fleet.kpi-hero"], []]);

const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, "select count(*)::int as n from user_dashboard_layout");
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};
/** Refused for a CLIENT: an insert with no INSERT policy RAISES rather than affecting zero rows,
 *  so asserting `affected === 0` would quietly pass on an error of any other kind too. */
const refusedAs = async (user, org, role, sql, params = []) => {
  const res = await asUser(user, org, role, sql, params);
  return typeof res.error === "string" && /row-level security/i.test(res.error);
};
const refused = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

// ── The read is OWN-ROW, which is the whole difference from 0298 ────────────────
ok("a person reads their own layout", (await countAs(PLANNER, ORG, "dispatcher")) === 1);
ok(
  "a colleague in the same org reads NOTHING, not even that a layout exists",
  (await countAs(COLLEAGUE, ORG, "dispatcher")) === 0,
);
// ⚠ The assertion most likely to be deleted by somebody building a support tool. An admin who needs
// to see a colleague's arrangement is asking for a feature, and the feature is a service-role
// endpoint that leaves an audit row — not a widened policy that silently applies to every admin.
ok("…and so does an ADMIN of that org", (await countAs(BOSS, ORG, "admin")) === 0);
ok("an outsider reads only their own, never this org's", (await countAs(OUTSIDER, OTHER_ORG, "dispatcher")) === 1);
ok(
  "…and a caller with no org claim at all sees nothing",
  (await countAs(PLANNER, "00000000-0000-4000-8000-0000000000ff", "dispatcher")) === 0,
);

// ── No client writes this table, whatever role they hold ────────────────────────
// A layout the client could write directly is a layout holding keys no widget answers to: the
// endpoint checks them against the catalogue, and PostgREST has no catalogue to check against.
const INSERT = `insert into user_dashboard_layout (org_id, user_id, widget_keys, hidden_keys)
                values ($1,$2,'{}','{}')`;
ok(
  "a person cannot INSERT even their OWN layout through PostgREST",
  await refusedAs(COLLEAGUE, ORG, "dispatcher", INSERT, [ORG, COLLEAGUE]),
);
ok("…nor can an admin insert one for somebody else", await refusedAs(BOSS, ORG, "admin", INSERT, [ORG, PLANNER]));
ok(
  "a person cannot UPDATE their own layout either",
  (await asUser(PLANNER, ORG, "dispatcher", `update user_dashboard_layout set widget_keys = '{}'`)).affectedRows === 0,
);
ok(
  "…nor DELETE it, which is how a reset would be smuggled past the endpoint",
  (await asUser(PLANNER, ORG, "dispatcher", `delete from user_dashboard_layout`)).affectedRows === 0,
);

// ── Kept and hidden are answers to the same question ────────────────────────────
ok(
  "a key cannot be both kept and hidden",
  await refused(SET, [ORG, COLLEAGUE, ["fleet.severity"], ["fleet.severity"]]),
);
ok(
  "…and the same key twice in one array is NOT refused — the resolver drops it, SQL does not care",
  !(await refused(SET, [ORG, COLLEAGUE, ["fleet.severity", "fleet.severity"], []])),
);
await db.query(`delete from user_dashboard_layout where user_id = $1`, [COLLEAGUE]);

// ── The ceilings are ceilings, not a description of the catalogue ───────────────
ok(
  "a row cannot be used as storage",
  await refused(SET, [ORG, COLLEAGUE, Array.from({ length: 65 }, (_, i) => `fleet.w${i}`), []]),
);
// A null element would read back as a key matching no widget and hiding nothing, which is harder to
// explain than a refusal.
ok("a null key is refused", await refused(SET, [ORG, COLLEAGUE, ["fleet.kpi-hero", null], []]));
ok(
  "an unknown key is NOT refused, because inertness is the design",
  !(await refused(SET, [ORG, COLLEAGUE, ["fleet.widget-that-never-existed"], []])),
);
await db.query(`delete from user_dashboard_layout where user_id = $1`, [COLLEAGUE]);

// ── The membership is a foreign key, not endpoint manners ───────────────────────
ok(
  "a layout cannot name somebody who is not a member of that org",
  await refused(SET, [ORG, OUTSIDER, ["fleet.kpi-hero"], []]),
);
ok(
  "…nor a user who exists in no org at all",
  await refused(SET, [ORG, "00000000-0000-4000-8000-00000000dead", ["fleet.kpi-hero"], []]),
);
ok(
  "removing a member takes their layout with them",
  await (async () => {
    const LEAVER = "00000000-0000-4000-8000-000000000009";
    await db.query(`insert into auth.users (id,email) values ($1,'leaver@example.com')`, [LEAVER]);
    await member(ORG, LEAVER, "dispatcher");
    await db.query(SET, [ORG, LEAVER, ["fleet.kpi-hero"], []]);
    await db.query(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, LEAVER]);
    const n = (await one(`select count(*)::int as n from user_dashboard_layout where user_id = $1`, [LEAVER])).n;
    return n === 0;
  })(),
);

// ── A row cannot be walked into another tenant, and stamps itself on the way ────
// ⚠ Moving PLANNER's row would be refused by the composite FK — they are not a member of the other
// org — so an assertion written that way passes with the trigger DELETED, which is exactly what the
// first draft of this file did and what mutating the migration caught. The row therefore moves
// between two orgs the person really belongs to, leaving the trigger as the only thing that can
// refuse, and the error message is checked rather than the mere fact of an error.
const DUAL = "00000000-0000-4000-8000-00000000d0a1";
await db.query(`insert into auth.users (id,email) values ($1,'dual@example.com')`, [DUAL]);
await member(ORG, DUAL, "dispatcher");
await member(OTHER_ORG, DUAL, "dispatcher");
await db.query(SET, [ORG, DUAL, ["fleet.kpi-hero"], []]);
ok(
  "the org_id of an existing row is immutable, refused by the trigger rather than by a foreign key",
  await (async () => {
    try {
      await db.query(`update user_dashboard_layout set org_id = $1 where org_id = $2 and user_id = $3`, [
        OTHER_ORG,
        ORG,
        DUAL,
      ]);
      return false;
    } catch (e) {
      return /org_id is immutable/.test(e.message);
    }
  })(),
);
ok(
  "an update stamps updated_at without the writer remembering to",
  await (async () => {
    await db.query(`update user_dashboard_layout set updated_at = '2020-01-01' where user_id = $1`, [PLANNER]);
    await db.query(`update user_dashboard_layout set hidden_keys = '{}' where user_id = $1`, [PLANNER]);
    const row = await one(`select updated_at from user_dashboard_layout where user_id = $1`, [PLANNER]);
    return new Date(row.updated_at).getUTCFullYear() > 2020;
  })(),
);

// ── An empty row is a real answer and must survive being stored ─────────────────
// "I chose to show nothing" is `widget_keys = '{}'` WITH a row, and the default on the column must
// not stand in the way of writing it deliberately.
ok(
  "a row with nothing kept is storable, and is not the same as no row",
  await (async () => {
    await db.query(SET, [ORG, COLLEAGUE, [], ["fleet.kpi-hero"]]);
    const row = await one(`select widget_keys, hidden_keys from user_dashboard_layout where user_id = $1`, [COLLEAGUE]);
    return row.widget_keys.length === 0 && row.hidden_keys.length === 1;
  })(),
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
