// Silvicom 360 — platform_scheduler_leases (migration 0506, PLATFORM-RELIABILITY-PLAN D-RLY2).
//
// The database is what lets a service run two replicas without running its schedulers twice: a
// process runs a lane only while `acquire_scheduler_lease` says it holds it. What must be true of the
// function itself, executed, not read:
//
//   · A free lane is taken; a held, live lane is NOT taken by anybody else — however often they ask.
//   · The holder renews without restarting its take-over time; an expired lease is taken by the next
//     asker, and that is a change of holder (acquired_at moves).
//   · `release_scheduler_lease` frees only the caller's own lease — a process can never release one
//     another process has since taken.
//   · The TTL is clamped, so a typo cannot park a lane for a day or spin it every second.
//   · Clients cannot call either function or read the table (service role only, 0412's default).
//
// Run: node supabase/tests/scheduler-leases.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const acquire = (lane, holder, ttl = 60) =>
  one(`select * from acquire_scheduler_lease($1, $2, $3, '{"service":"t"}'::jsonb)`, [lane, holder, ttl]);
const row = (lane) => one(`select * from platform_scheduler_leases where lane = $1`, [lane]);
// Moves a lease's expiry into the past, as a holder that stopped renewing a minute ago would leave it.
const expire = (lane) =>
  db.query(`update platform_scheduler_leases set renewed_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' where lane = $1`, [lane]);

// ── take, hold, refuse ───────────────────────────────────────────────────────────────────────────
const a1 = await acquire("general", "api:r1:1:aaaa");
ok("a free lane is taken by the first asker", a1.held === true && a1.holder === "api:r1:1:aaaa");
const b1 = await acquire("general", "api:r2:1:bbbb");
ok("a live lease is refused to a second process, which is told who holds it", b1.held === false && b1.holder === "api:r1:1:aaaa");
let refusedEveryTime = true;
for (let i = 0; i < 5; i++) if ((await acquire("general", "api:r2:1:bbbb")).held) refusedEveryTime = false;
ok("…however often it asks", refusedEveryTime);
ok("the refused process wrote nothing", (await row("general")).holder === "api:r1:1:aaaa");

const takenAt = (await row("general")).acquired_at;
const a2 = await acquire("general", "api:r1:1:aaaa");
const afterRenew = await row("general");
ok("the holder renews", a2.held === true);
ok("…and a renewal keeps the original take-over time", afterRenew.acquired_at.getTime() === takenAt.getTime());
ok("…and moves its expiry forward", afterRenew.expires_at.getTime() > afterRenew.renewed_at.getTime());

// ── expiry and take-over ─────────────────────────────────────────────────────────────────────────
await expire("general");
const b2 = await acquire("general", "worker:r1:1:cccc");
const afterTake = await row("general");
ok("an expired lease is taken by the next asker", b2.held === true && afterTake.holder === "worker:r1:1:cccc");
ok("…and that is a change of holder: the take-over time moves", afterTake.acquired_at.getTime() > takenAt.getTime());
const a3 = await acquire("general", "api:r1:1:aaaa");
ok("the old holder coming back finds the lane taken", a3.held === false && a3.holder === "worker:r1:1:cccc");

// ── lanes are independent ────────────────────────────────────────────────────────────────────────
const e1 = await acquire("egress", "api:r1:1:aaaa");
ok("holding one lane does not hold or block another", e1.held === true && (await row("general")).holder === "worker:r1:1:cccc");

// ── release ──────────────────────────────────────────────────────────────────────────────────────
ok("release by a non-holder is refused", (await one(`select release_scheduler_lease('general', 'api:r1:1:aaaa') r`)).r === false);
ok("…and leaves the lease live", (await row("general")).expires_at.getTime() > Date.now() - 1000);
ok("release by the holder succeeds", (await one(`select release_scheduler_lease('general', 'worker:r1:1:cccc') r`)).r === true);
const c1 = await acquire("general", "api:r2:1:bbbb");
ok("a released lane is taken at once — no TTL to wait out on a deploy", c1.held === true);
ok("releasing twice is a no-op", (await one(`select release_scheduler_lease('egress', 'api:r1:1:aaaa') r`)).r === true
  && (await one(`select release_scheduler_lease('egress', 'api:r1:1:aaaa') r`)).r === false);

// ── TTL clamp ────────────────────────────────────────────────────────────────────────────────────
await acquire("ttl_long", "x", 86400);
const long = await row("ttl_long");
ok("a day-long TTL is clamped to five minutes", (long.expires_at - long.renewed_at) / 1000 <= 300);
await acquire("ttl_short", "x", 1);
const short = await row("ttl_short");
ok("a one-second TTL is raised to ten", (short.expires_at - short.renewed_at) / 1000 >= 10);

// ── shape ────────────────────────────────────────────────────────────────────────────────────────
ok("a lane name outside the vocabulary is refused", (await sqlstate(`select * from acquire_scheduler_lease('General Lane', 'x')`)) === "23514");
ok("an empty holder is refused", (await sqlstate(`select * from acquire_scheduler_lease('lane_x', '')`)) === "23514");

// ── clients ──────────────────────────────────────────────────────────────────────────────────────
const fnAcl = async (name) =>
  (await one(`select coalesce(array_to_string(proacl, ','), '') a from pg_proc where proname = $1`, [name])).a;
for (const fn of ["acquire_scheduler_lease", "release_scheduler_lease"]) {
  const acl = await fnAcl(fn);
  ok(`${fn} is not executable by anon or authenticated`, !/(^|,)(anon|authenticated)=X/.test(acl), acl);
}
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where relname = 'platform_scheduler_leases'`)).r === true
  && Number((await one(`select count(*) n from pg_policies where tablename = 'platform_scheduler_leases'`)).n) === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
