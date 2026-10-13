// Silvicom 360 — Med-Stop requests and tests (migrations 0464 + 0465, MEDSTOP-PLAN.md §6 F-4/F-5, MS2).
//
// Unlike MS1's snapshot, this mirror is MERGED by Med-Stop's id and never emptied. What would quietly
// go wrong, none of it visible at the application layer:
//
//   1. A MERGE FORGETS WHAT WE DID. `first_seen_at`, `baseline` and `outcome_handled*` are ours: a
//      sweep that overwrote them would re-alert the DER every hour, or turn a year-old positive into
//      news — or news into history.
//   2. A SWEEP WITHOUT A TRAIL ERASES THE TRAIL. `stages` is fetched only when a test moves; the
//      sweeps in between carry none and must keep what is there.
//   3. ONE ORG'S MERGE TOUCHES ANOTHER'S ROWS.
//   4. A RESULT REACHES A BROWSER. `result` is a §382.401(a) testing record: RLS on, no policies.
//   5. THE NOTIFICATION CATEGORY THE NEXT MERGE EMITS IS REFUSED by the CHECK.
//
// Run:  node supabase/tests/medstop-tests.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('der@silvicom.test') returning id`)).id;

const merge = (org, kind, rows) =>
  sqlstate(`select public.medstop_merge($1, $2, $3::jsonb)`, [org, kind, JSON.stringify(rows)]);
const test = (org, id) => one(`select * from medstop_tests where org_id=$1 and medstop_id=$2`, [org, id]);
const count = async (t, org) => (await one(`select count(*)::int n from ${t} where org_id=$1`, [org])).n;

// ── 1. a merge inserts, then updates Med-Stop's columns and nothing of ours ─────────────────────
const trail = [{ status: "COMPLETED", at: "2026-10-12T13:04:34" }];
ok("a first merge stores the test, with the baseline the sweep chose",
  (await merge(ORG, "tests", [{ medstop_id: "t1", employee_medstop_id: "e1", service: "TD", status: "COMPLETED", collected_local: "2026-10-12T13:04:34", stages: trail, baseline: false },
    { medstop_id: "t0", service: "TD", status: "CLOSED", result: "POSITIVE", baseline: true }])) === null
  && (await count("medstop_tests", ORG)) === 2 && (await test(ORG, "t0")).baseline === true);
const before = await test(ORG, "t1");
ok("the zoneless stamp is stored as written — no zone invented", String(before.collected_local).length > 0 && (await one(`select collected_local::text s from medstop_tests where medstop_id='t1'`)).s === "2026-10-12 13:04:34");
await db.query(`update medstop_tests set outcome_handled='negative', outcome_handled_at=now() where org_id=$1 and medstop_id='t1'`, [ORG]);
ok("the next merge moves the status and the result",
  (await merge(ORG, "tests", [{ medstop_id: "t1", employee_medstop_id: "e1", service: "TD", status: "CLOSED", result: "NEGATIVE", baseline: true }])) === null);
const after = await test(ORG, "t1");
ok("…and keeps first_seen_at", after.first_seen_at.getTime() === before.first_seen_at.getTime());
ok("…and keeps baseline as inserted — a later sweep cannot turn news into history", after.baseline === false);
ok("…and keeps what was acted on", after.outcome_handled === "negative" && after.outcome_handled_at !== null);
ok("…and keeps the trail when the sweep carried none", Array.isArray(after.stages) && after.stages.length === 1 && after.status === "CLOSED" && after.result === "NEGATIVE");
await merge(ORG, "tests", [{ medstop_id: "t1", status: "CLOSED", stages: [...trail, { status: "CLOSED", at: "2026-10-14T04:00:01" }] }]);
ok("a fresh trail replaces the old one", (await test(ORG, "t1")).stages.length === 2);

// ── 2. requests merge the same way ─────────────────────────────────────────────────────────────
ok("requests merge by id",
  (await merge(ORG, "requests", [{ medstop_id: "r1", employee_medstop_id: "e1", status: "OPEN", observed: false }])) === null
  && (await merge(ORG, "requests", [{ medstop_id: "r1", employee_medstop_id: "e1", status: "COMPLETED", test_medstop_id: "t1" }])) === null
  && (await count("medstop_requests", ORG)) === 1
  && (await one(`select status, test_medstop_id from medstop_requests where org_id=$1`, [ORG])).test_medstop_id === "t1");
ok("an empty merge is a no-op, not an error — a quiet week has no new tests", (await merge(ORG, "tests", [])) === null && (await count("medstop_tests", ORG)) === 2);
ok("a non-array is refused (MS003)", (await merge(ORG, "tests", { medstop_id: "x" })) === "MS003");
ok("an unknown kind is refused (MS002)", (await merge(ORG, "employees", [{ medstop_id: "x" }])) === "MS002");
ok("a stages value that is not an array is refused", (await merge(ORG, "tests", [{ medstop_id: "t9", stages: { status: "X" } }])) === "23514");

// ── 3. one org's merge never touches another's ─────────────────────────────────────────────────
await merge(OTHER, "tests", [{ medstop_id: "t1", status: "OPEN" }]);
ok("the same Med-Stop id in another org is another row", (await count("medstop_tests", OTHER)) === 1 && (await test(ORG, "t1")).status === "CLOSED");
ok("org_id is the function's argument, not the payload's",
  (await merge(ORG, "tests", [{ medstop_id: "t2", org_id: OTHER, status: "OPEN" }])) === null && (await count("medstop_tests", OTHER)) === 1);

// ── 4. the category the next merge emits ───────────────────────────────────────────────────────
const checkDef = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='notification_events_category_check'`)).d;
ok("drug_alcohol_result is a notification category", checkDef.includes("'drug_alcohol_result'"));
ok("and card_status_changed survived the rewrite", checkDef.includes("'card_status_changed'"));

// ── 5. clients read and write none of it ───────────────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
for (const role of ["admin", "safety_manager", "recruiter"]) {
  for (const t of ["medstop_requests", "medstop_tests"]) {
    const sel = await asClient(ORG, role, `select count(*)::int n from ${t} where org_id=$1`, [ORG]);
    ok(`${role} reads nothing from ${t} directly`, sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
  }
  const rpc = await asClient(ORG, role, `select public.medstop_merge($1,'tests','[{"medstop_id":"x"}]'::jsonb)`, [ORG]);
  ok(`${role} cannot call the merge`, rpc.error === "42501", JSON.stringify(rpc));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
