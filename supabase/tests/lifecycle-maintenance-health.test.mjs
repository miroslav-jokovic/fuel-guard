// Silvicom 360 — partition maintenance health (migration 0360, DATA-LIFECYCLE-PLAN L6, D-LIFE10).
//
// `lifecycle_maintenance_health()` is the reading that stands between an hourly `pg_cron` job and a
// production outage: once L7 partitions a table, a maintenance job that stops running lets inserts run
// off the end of the last pre-made partition. PGlite ships neither pg_cron nor pg_partman, so 0360's
// install is guarded — and that guard is exactly the kind of thing that can skip silently. This matrix
// pins the two halves that CAN be executed here:
//
//   1. ON A SERVER WITHOUT THE EXTENSIONS, the migration applies cleanly AND the function says
//      `missing` — never `ok`. A skipped install must read as red.
//   2. THE STATE MACHINE, against `cron` / `partman` tables shimmed with pg_cron 1.6's and
//      pg_partman 5's own column names: missing job, inactive, pending, failing, stale, ok, and a run
//      in flight after a recent success. Every branch has a case that would fail if it moved.
//   3. IT IS NOT CALLABLE BY A TOKEN. Operational metadata for the API's own client, like 0140.
//
// Run:  node supabase/tests/lifecycle-maintenance-health.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const health = async () => (await one(`select public.lifecycle_maintenance_health() as h`)).h;

// ── 1. no extensions ───────────────────────────────────────────────────────────────────────────
{
  const h = await health();
  ok("without pg_cron/pg_partman the state is missing", h.state === "missing", JSON.stringify(h));
  ok("…and partitioned_tables is null, not a vacuous 0", h.partitioned_tables === null, JSON.stringify(h));
}

// ── 2. the state machine, on shims with the real column names ───────────────────────────────
await db.exec(`
  create schema cron;
  create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text,
    nodeport int, database text, username text, active boolean default true, jobname text);
  create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text,
    username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
  create schema partman;
  create table partman.part_config (parent_table text primary key);
`);

// Another cron job exists and has succeeded — someone else's. It must not stand in for ours.
await db.exec(`insert into cron.job (schedule, command, jobname) values ('0 3 * * *', 'select 1', 'someone-else');
  insert into cron.job_run_details (jobid, status, start_time, end_time)
    select jobid, 'succeeded', now() - interval '5 minutes', now() - interval '5 minutes' from cron.job;`);
{
  const h = await health();
  ok("extensions present, only an unrelated job scheduled → missing", h.state === "missing", JSON.stringify(h));
  ok("…and partitioned_tables reports the real count (0)", h.partitioned_tables === 0, JSON.stringify(h));
}

const JOB = (await one(`insert into cron.job (schedule, command, jobname) values
  ('7 * * * *', 'call partman.run_maintenance_proc()', 'partman-maintenance') returning jobid`)).jobid;
const run = (status, startAgo, endAgo) =>
  db.query(
    `insert into cron.job_run_details (jobid, status, start_time, end_time)
     values ($1, $2, now() - $3::interval, case when $4::text is null then null else now() - $4::interval end)`,
    [JOB, status, startAgo, endAgo],
  );
const reset = () => db.exec(`delete from cron.job_run_details; update cron.job set active = true;`);

ok("scheduled, never run → pending", (await health()).state === "pending");

await run("running", "5 minutes", null);
ok("first run in flight, no success yet → pending", (await health()).state === "pending");

await reset();
await run("running", "4 hours", null);
ok("a run started 4 h ago that never succeeded → stale, not pending forever", (await health()).state === "stale");

await reset();
await run("succeeded", "50 minutes", "49 minutes");
{
  const h = await health();
  ok("a success 49 min ago → ok", h.state === "ok", JSON.stringify(h));
  ok("…and last_succeeded_at is reported", h.last_succeeded_at !== null, JSON.stringify(h));
}

await run("running", "1 minute", null);
ok("a run in flight after a recent success → ok", (await health()).state === "ok");

await reset();
await run("succeeded", "2 hours", "2 hours");
await run("failed", "1 hour", "1 hour");
ok("the most recent run failed → failing, even with a success 2 h ago", (await health()).state === "failing");

await reset();
await run("succeeded", "5 hours", "5 hours");
ok("last success 5 h ago against an hourly schedule → stale", (await health()).state === "stale");

await reset();
await run("succeeded", "10 minutes", "10 minutes");
await db.exec(`update cron.job set active = false`);
ok("job switched off → inactive, even with a recent success", (await health()).state === "inactive");

await reset();
await db.exec(`insert into partman.part_config values ('public.audit_logs')`);
ok("partitioned_tables counts part_config rows", (await health()).partitioned_tables === 1);

// ── 3. not callable by a token ──────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const can = (await one(`select has_function_privilege($1, 'public.lifecycle_maintenance_health()', 'execute') as c`, [role])).c;
  ok(`${role} cannot execute lifecycle_maintenance_health()`, can === false);
}
ok(
  "service_role can execute lifecycle_maintenance_health()",
  (await one(`select has_function_privilege('service_role', 'public.lifecycle_maintenance_health()', 'execute') as c`)).c === true,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
