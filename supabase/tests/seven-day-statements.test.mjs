// FuelGuard — seven-day work statement matrix (migration 0236).
//
// §395.8(j)(2): before using a driver for the first time, the carrier must obtain a signed statement
// of the hours they worked in the seven preceding days and when they were last relieved from duty.
// The table exists because that arithmetic is what §395.3's 60/70-hour limits are measured against.
//
// Four rules, and this file is where each is a fact rather than a comment:
//
//   1. SD010 — the statement is IMMUTABLE on UPDATE, for everybody including the service role. A
//      driver signed it; a signed statement somebody can edit afterwards is not a statement.
//   2. It IS deletable, unlike `drivers` (0235) or `driver_applications` (0220). §395.8(k)(1) asks
//      for six months of supporting documents, and retention must be able to prune.
//   3. The shape is exactly seven days, pinned in the database — a partial statement is an
//      arithmetic base with a hole in it, which is worse than none because it looks complete.
//   4. `merge_driver` carries it (0234's lesson, applied on the day the table was created).
//
// Run:  node supabase/tests/seven-day-statements.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);

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
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'admin@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'O') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id,full_name) values ($1,'Susan Godfrey') returning id`, [ORG])).id;

const DAYS = JSON.stringify(
  ["2026-08-01","2026-08-02","2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07"]
    .map((date, i) => ({ date, hours: i < 5 ? 8 : 0 })),
);

const insert = async (driver = DRIVER, org = ORG, days = DAYS) =>
  one(
    `insert into seven_day_statements
       (org_id, driver_id, statement_date, days, last_relieved_at, signed_name, signed_on, recorded_by)
     values ($1, $2, '2026-08-08', $3::jsonb, '2026-08-07T18:30:00Z', 'Susan Godfrey', '2026-08-08', $4)
     returning id`,
    [org, driver, days, ACTOR],
  );

const attempt = async (sql, params = []) => {
  try { await db.query(sql, params); return "OK"; } catch (e) { return e.code ?? `ERROR: ${e.message}`; }
};

// ── 1. It records ─────────────────────────────────────────────────────────────────────────────
const ID = (await insert()).id;
ok("a statement is recorded", (await count(`select count(*)::int as n from seven_day_statements where id = $1`, [ID])) === 1);
ok(
  "the seven days come back as an array, in order",
  (await one(`select days from seven_day_statements where id = $1`, [ID])).days.length === 7,
);

// ── 2. Exactly seven days, enforced by the DATABASE ───────────────────────────────────────────
// The contract checks this too. Both, deliberately: the API is not the only writer of this schema,
// and a partial statement is the one defect here that looks complete.
for (const [label, n] of [["six", 6], ["eight", 8]]) {
  const wrong = JSON.stringify(
    Array.from({ length: n }, (_v, i) => ({ date: `2026-08-0${(i % 9) + 1}`, hours: 1 })),
  );
  ok(
    `a statement of ${label} days is refused by the check constraint`,
    (await attempt(
      `insert into seven_day_statements
         (org_id, driver_id, statement_date, days, last_relieved_at, signed_name, signed_on)
       values ($1, $2, '2026-08-08', $3::jsonb, now(), 'X', '2026-08-08')`,
      [ORG, DRIVER, wrong],
    )) === "23514",
  );
}
ok(
  "and an OBJECT where the seven days should be is refused too",
  (await attempt(
    `insert into seven_day_statements
       (org_id, driver_id, statement_date, days, last_relieved_at, signed_name, signed_on)
     values ($1, $2, '2026-08-08', '{}'::jsonb, now(), 'X', '2026-08-08')`,
    [ORG, DRIVER],
  )) === "23514",
);

// ── 3. SD010 — immutable on UPDATE, for everybody ─────────────────────────────────────────────
// ⚠ No `auth_role() is null` exemption. The service role is what bypasses RLS in the first place, so
// a guard that trusts the API is a guard against typos rather than against the thing it protects.
const ALTERED_DAYS = JSON.stringify(
  ["2026-08-01","2026-08-02","2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07"]
    .map((date) => ({ date, hours: 1 })),
);
ok(
  "the service role cannot edit the hours",
  (await attempt(`update seven_day_statements set days = $1::jsonb where id = $2`, [ALTERED_DAYS, ID])) === "SD010",
);
// ⚠ Writing a column its OWN value is a no-op and passes, because the guard compares old to new
// rather than counting UPDATE statements. Asserted rather than left as a surprise: a caller that
// re-sends an unchanged row is not editing anything, and the same is true of `employer_inquiries`.
ok(
  "but re-writing an unchanged value is a no-op, not a violation",
  (await attempt(`update seven_day_statements set days = $1::jsonb where id = $2`, [DAYS, ID])) === "OK",
);
ok(
  "nor the signature",
  (await attempt(`update seven_day_statements set signed_name = 'Someone Else' where id = $1`, [ID])) === "SD010",
);
ok(
  "nor a column nobody would think to protect",
  (await attempt(`update seven_day_statements set statement_date = '2026-09-01' where id = $1`, [ID])) === "SD010",
);
ok(
  "and the row is untouched after all of that",
  (await one(`select signed_name from seven_day_statements where id = $1`, [ID])).signed_name === "Susan Godfrey",
);

// A correction is a NEW statement — which is why the immutability above costs nothing.
const SECOND = (await insert()).id;
ok(
  "a correction is a second row, and the newest is first",
  SECOND !== ID
    && (await one(
      `select id from seven_day_statements where driver_id = $1
        order by statement_date desc, created_at desc limit 1`,
      [DRIVER],
    )).id === SECOND,
);

// ── 4. Prunable, unlike the evidence tables ───────────────────────────────────────────────────
// §395.8(k)(1) asks for six months. Holding somebody's working hours for ever, when the rule asks for
// six months, is over-retention dressed as diligence — so `dataRetention.ts` has a rule, and the rule
// can only run if DELETE works.
ok(
  "retention can delete a statement",
  (await attempt(`delete from seven_day_statements where id = $1`, [SECOND])) === "OK"
    && (await count(`select count(*)::int as n from seven_day_statements where id = $1`, [SECOND])) === 0,
);

// ── 5. merge_driver carries it (0234's lesson) ────────────────────────────────────────────────
// The assertion that would fail if a future table were added without teaching merge_driver — which is
// exactly how nine tables were lost between 0203 and 0234.
const CANON = (await one(`insert into drivers (org_id,full_name) values ($1,'Susan Godfrey') returning id`, [ORG])).id;
const DUPE = (await one(`insert into drivers (org_id,full_name) values ($1,'SUSAN GODFREY') returning id`, [ORG])).id;
await insert(DUPE);
await db.query(`select merge_driver($1,$2,$3)`, [ORG, DUPE, CANON]);
ok(
  "a merge carries the statement to the surviving driver instead of destroying it",
  (await count(`select count(*)::int as n from seven_day_statements where driver_id = $1`, [CANON])) === 1
    && (await count(`select count(*)::int as n from seven_day_statements where driver_id = $1`, [DUPE])) === 0,
);

// ── 6. Tenancy ────────────────────────────────────────────────────────────────────────────────
const STRANGER = (await one(`insert into drivers (org_id,full_name) values ($1,'Somebody Else') returning id`, [OTHER])).id;
await insert(STRANGER, OTHER);
const mine = await count(`select count(*)::int as n from seven_day_statements where org_id = $1`, [ORG]);
ok(
  "another org's statement is its own, and does not join this org's list",
  (await count(`select count(*)::int as n from seven_day_statements where org_id = $1`, [OTHER])) === 1
    && (await count(`select count(*)::int as n from seven_day_statements where driver_id = $1`, [STRANGER])) === 1
    && (await count(
      `select count(*)::int as n from seven_day_statements where org_id = $1 and driver_id = $2`,
      [ORG, STRANGER],
    )) === 0
    && mine >= 1,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
