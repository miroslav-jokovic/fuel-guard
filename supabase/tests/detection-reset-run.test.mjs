// FuelGuard — running the detection reset for Silvicom (migration 0441; D-CF9, Q-CF1 (a); F02-F04
// PLAN.md chunk 7c).
//
// WHY THIS FILE EXISTS. 0441 runs once on production and closes the whole fill-alert queue. Its function
// is proven in detection-reset.test.mjs; this proves the FILE: that it calls the function for the right
// org, with the right actor, exactly once, and that a database without that org or user (staging, these
// matrices) skips cleanly rather than failing the release train.
//
// What can be wrong, each asserted below:
//   • IT FAILS WHERE SILVICOM IS ABSENT. Applying the ledger here, with no such org, must change nothing.
//   • IT RESETS THE WRONG ORG, OR AS NOBODY. With Silvicom and the owner present, only Silvicom's open
//     alerts are retired, and the audit row names the owner.
//   • IT RUNS TWICE. Running the file again must skip and leave one audit row.
//
// Run:  node supabase/tests/detection-reset-run.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// Supabase-managed objects (present in a real project; shimmed here), as in rls.test.mjs.
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
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const FILE = MIGRATIONS.find((f) => f.startsWith("0441_"));
ok("0441 present", Boolean(FILE));
const runFile = () => db.exec(read(`migrations/${FILE}`));
const SILVICOM = "86d6b3ea-4361-4f71-877f-e8373615769b";
const OWNER = "2607d9c1-9e12-47f4-ad53-aa5a5bde4713";
const resets = () => count(`select count(*) n from audit_logs where action = 'anomalies.detection_reset'`);

console.log("\n-- a database without Silvicom --");
ok("applying the ledger reset nothing: no start date, no audit row",
  (await resets()) === 0 && (await count(`select count(*) n from organizations where detection_epoch is not null`)) === 0);

// Another person, whose email sorts first: an act run as "somebody" rather than as the owner shows.
await db.query(`insert into auth.users (email) values ('aaa-first@x.test')`);

console.log("\n-- the owner is there, the org is not --");
await db.query(`insert into auth.users (id, email) values ($1, 'owner@x.test')`, [OWNER]);
const noOrg = await err(runFile());
ok("without Silvicom it skips: no error, no start date, no audit row",
  noOrg === null && (await resets()) === 0, String(noOrg));
await db.query(`delete from auth.users where id = $1`, [OWNER]);

// Silvicom, with the shape production has: open alerts on old fills.
await db.query(`insert into organizations (id, name) values ($1, 'Silvicom Inc')`, [SILVICOM]);
const OTHER = (await one(`insert into organizations (name) values ('Other Co') returning id`)).id;
const fill = async (org) =>
  (await one(`insert into fuel_transactions (org_id, fueled_at, gallons) values ($1, '2026-09-30T18:00:00Z', 100) returning id`, [org])).id;
const alert = async (org) =>
  (await one(`insert into anomalies (org_id, transaction_id, rule_id, severity, status, message, source, fueled_at)
              values ($1, $2, 'theft_case', 'critical', 'open', 'seeded', 'rules', '2026-09-30T18:00:00Z') returning id`, [org, await fill(org)])).id;
const mine = [await alert(SILVICOM), await alert(SILVICOM), await alert(SILVICOM)];
const theirs = await alert(OTHER);

console.log("\n-- the org is there, the owner is not --");
const noOwner = await err(runFile());
ok("without the owner's user it skips: no error, nothing retired, no audit row",
  noOwner === null && (await resets()) === 0 && (await count(`select count(*) n from anomalies where status = 'open'`)) === 4);

await db.query(`insert into auth.users (id, email) values ($1, 'owner@x.test')`, [OWNER]);

console.log("\n-- the act --");
const ran = await err(runFile());
ok("it runs without an error", ran === null, String(ran));
ok("Silvicom's three open alerts are retired",
  (await count(`select count(*) n from anomalies where id = any($1::uuid[]) and status = 'dismissed' and disposition = 'retired_reset_2026_10' and resolved_by = $2`, [mine, OWNER])) === 3);
ok("another org's alert stays open", (await one(`select status::text s from anomalies where id = $1`, [theirs])).s === "open");
const a = (await db.query(`select * from audit_logs where action = 'anomalies.detection_reset'`)).rows;
ok("one audit row, for Silvicom, naming the owner, with the count", a.length === 1 && a[0].org_id === SILVICOM && a[0].actor_id === OWNER && a[0].meta.retired === 3, JSON.stringify(a));
const epoch = (await one(`select detection_epoch from organizations where id = $1`, [SILVICOM])).detection_epoch;
ok("the start date is the moment it ran", epoch && Math.abs(Date.now() - new Date(epoch).getTime()) < 120_000, String(epoch));
ok("only Silvicom has a start date", (await count(`select count(*) n from organizations where detection_epoch is not null`)) === 1);

console.log("\n-- run again --");
const second = await err(runFile());
ok("a second run skips without an error", second === null, String(second));
ok("…and leaves one audit row and the same start date",
  (await resets()) === 1 &&
  new Date((await one(`select detection_epoch from organizations where id = $1`, [SILVICOM])).detection_epoch).getTime() === new Date(epoch).getTime());

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
