// FuelGuard — setting Silvicom's fuel queue owner (migration 0443; Q-F1; F02-F04 PLAN.md chunk 8b).
//
// WHY THIS FILE EXISTS. 0443 runs once on production and hands the owner every open fuel item. Its
// function is proven in fuel-queue-owner.test.mjs; this proves the FILE: that it acts for the right org,
// as the right person, once, and that a database without that org, user or membership (staging, these
// matrices) skips cleanly rather than failing the release train.
//
// What can be wrong, each asserted below:
//   • IT FAILS WHERE SILVICOM OR THE OWNER IS ABSENT, or where he is not a member.
//   • IT ACTS FOR THE WRONG ORG, OR AS NOBODY. Only Silvicom's open, unassigned items go to him, and the
//     audit row names him.
//   • IT RUNS TWICE, or overrides an owner somebody already chose.
//
// Run:  node supabase/tests/fuel-queue-owner-run.test.mjs
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

const FILE = MIGRATIONS.find((f) => f.startsWith("0443_"));
ok("0443 present", Boolean(FILE));
const runFile = () => db.exec(read(`migrations/${FILE}`));
const SILVICOM = "86d6b3ea-4361-4f71-877f-e8373615769b";
const OWNER = "2607d9c1-9e12-47f4-ad53-aa5a5bde4713";
const acts = () => count(`select count(*) n from audit_logs where action = 'fuel.queue_owner_set'`);
const ownerOf = async (org) => (await one(`select fuel_queue_owner from organizations where id = $1`, [org])).fuel_queue_owner;

console.log("\n-- a database without Silvicom --");
ok("applying the ledger set no owner and wrote no audit row",
  (await acts()) === 0 && (await count(`select count(*) n from organizations where fuel_queue_owner is not null`)) === 0);

// Another admin, created first: an act run as "somebody" rather than as the owner shows.
const SOMEBODY = (await one(`insert into auth.users (email) values ('aaa-first@x.test') returning id`)).id;
await db.query(`insert into auth.users (id, email) values ($1, 'owner@x.test')`, [OWNER]);

console.log("\n-- the owner is there, the org is not --");
const noOrg = await err(runFile());
ok("without Silvicom it skips: no error, no audit row", noOrg === null && (await acts()) === 0, String(noOrg));

await db.query(`insert into organizations (id, name) values ($1, 'Silvicom Inc')`, [SILVICOM]);
const OTHER = (await one(`insert into organizations (name) values ('Other Co') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin'), ($3, $2, 'admin')`, [SILVICOM, SOMEBODY, OTHER]);
let seq = 0;
const finding = async (org, assignee = null) =>
  (await one(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint, assigned_to)
              values ($1, 'recon_amount', 'overbilled', $2, $3) returning id`, [org, `fp-${++seq}`, assignee])).id;
const mine = [await finding(SILVICOM), await finding(SILVICOM)];
const taken = await finding(SILVICOM, SOMEBODY);
const theirs = await finding(OTHER);

console.log("\n-- the org and the user are there, but he is not a member --");
const notMember = await err(runFile());
ok("it skips: no error, no owner, no audit row, nothing assigned",
  notMember === null && (await acts()) === 0 && (await ownerOf(SILVICOM)) === null &&
  (await count(`select count(*) n from fuel_exceptions where assigned_to is not null`)) === 1, String(notMember));

await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [SILVICOM, OWNER]);

console.log("\n-- the act --");
const ran = await err(runFile());
ok("it runs without an error", ran === null, String(ran));
ok("he is Silvicom's fuel queue owner", (await ownerOf(SILVICOM)) === OWNER);
ok("Silvicom's two open, unassigned findings are his",
  (await count(`select count(*) n from fuel_exceptions where id = any($1::uuid[]) and assigned_to = $2`, [mine, OWNER])) === 2);
ok("the finding somebody took stays theirs",
  (await one(`select assigned_to from fuel_exceptions where id = $1`, [taken])).assigned_to === SOMEBODY);
ok("another org's finding and owner are untouched",
  (await one(`select assigned_to from fuel_exceptions where id = $1`, [theirs])).assigned_to === null && (await ownerOf(OTHER)) === null);
const a = (await db.query(`select * from audit_logs where action = 'fuel.queue_owner_set'`)).rows;
ok("one audit row, for Silvicom, naming him, with the count",
  a.length === 1 && a[0].org_id === SILVICOM && a[0].actor_id === OWNER && a[0].meta.owner === OWNER && a[0].meta.assigned_findings === 2,
  JSON.stringify(a));
ok("a new finding goes to him", (await one(`select assigned_to from fuel_exceptions where id = $1`, [await finding(SILVICOM)])).assigned_to === OWNER);

console.log("\n-- run again, after somebody chose a different owner --");
await db.query(`select * from set_fuel_queue_owner($1, $2, $2)`, [SILVICOM, SOMEBODY]);
const second = await err(runFile());
ok("a second run skips without an error", second === null, String(second));
ok("…and leaves the owner somebody chose, with no extra audit row from the file",
  (await ownerOf(SILVICOM)) === SOMEBODY && (await acts()) === 2);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
