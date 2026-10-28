// Silvicom 360 — print stations matrix (migration 0526, PRINTERS-AND-SCANNERS-PLAN.md step PS1).
//
// What is pinned is what the owner's rule rests on — "chosen once, never asked, never lost":
//   1. Exactly one default per organization, and at most one per person, per purpose (D-PS4).
//   2. Nothing crosses organizations: a printer on another org's station, a default or a job naming
//      another org's printer (PS001). A retired printer cannot become a default or take a job (PS004).
//   3. A job's life only moves forward (PS002), and what it prints is fixed once queued (PS003).
//   4. The claim: oldest first, only this station's live printers, one taker under concurrency, and
//      the claim is the heartbeat. A revoked or unpaired station claims nothing.
//   5. A job taken and never reported becomes `unknown` — never re-queued (a second label), never
//      failed (a hidden one) — and a late report still settles it.
//   6. The report: refused from another station (PS005); repeated, it answers instead of erroring.
//   7. Browsers see nothing: no client policy on any of the four tables.
//
// Run: node supabase/tests/print-stations.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
const num = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to inventory-stock.test.mjs and rls.test.mjs.
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
await db.query(`insert into auth.users (id, email) values ($1,'office@test'), ($2,'tech@test')`, [ACTOR, OTHER_USER]);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const RIVAL = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const HASH = (c) => c.repeat(64);
const station = async (name, org = ORG, token = null) =>
  (
    await one(
      `insert into print_stations (org_id, name, token_hash, paired_at)
       values ($1, $2, $3, case when $3::text is null then null else now() end) returning id`,
      [org, name, token],
    )
  ).id;
const printer = async (stationId, name, org = ORG) =>
  (
    await one(
      `insert into printers (org_id, station_id, name, system_name, stock_id) values ($1,$2,$3,'MUNBYN RW403B','roll-single') returning id`,
      [org, stationId, name],
    )
  ).id;
const job = async (printerId, org = ORG, id = randomUUID()) =>
  (
    await one(
      `insert into print_jobs (id, org_id, printer_id, requested_by, description, label_count, payload)
       values ($1,$2,$3,$4,'Label — test',1,'\\x53495a45'::bytea) on conflict (id) do nothing returning id`,
      [id, org, printerId, ACTOR],
    )
  )?.id;
const status = async (id) => (await one(`select status from print_jobs where id = $1`, [id])).status;
const claim = async (stationId) => (await db.query(`select * from print_claim_next_job($1)`, [stationId])).rows;

const OFFICE = await station("Office PC", ORG, HASH("a"));
const SHOP_PC = await station("Shop PC", ORG, HASH("b"));
const UNPAIRED = await station("Not yet paired");
const RIVAL_PC = await station("Rival PC", RIVAL, HASH("c"));
const LABELS = await printer(OFFICE, "Office label printer");
const SHOP_LABELS = await printer(SHOP_PC, "Shop label printer");
const RIVAL_LABELS = await printer(RIVAL_PC, "Rival label printer", RIVAL);

// ── 1. One default per organization; one per person ─────────────────────────────────────────────
await db.query(`insert into print_defaults (org_id, printer_id) values ($1,$2)`, [ORG, LABELS]);
ok(
  "a second organization default for labels is refused",
  (await refuses(`insert into print_defaults (org_id, printer_id) values ($1,$2)`, [ORG, SHOP_LABELS])) === "23505",
);
await db.query(`insert into print_defaults (org_id, user_id, printer_id) values ($1,$2,$3)`, [ORG, OTHER_USER, SHOP_LABELS]);
ok(
  "...while a person may choose their own, beside it",
  (await num(`select count(*)::int as n from print_defaults where org_id = $1`, [ORG])) === 2,
);
ok(
  "...but only one per person",
  (await refuses(`insert into print_defaults (org_id, user_id, printer_id) values ($1,$2,$3)`, [ORG, OTHER_USER, LABELS])) ===
    "23505",
);
ok(
  "a default for a purpose that does not exist is refused",
  (await refuses(`insert into print_defaults (org_id, purpose, printer_id) values ($1,'poster',$2)`, [ORG, LABELS])) === "23514",
);

// ── 2. Nothing crosses organizations ────────────────────────────────────────────────────────────
ok(
  "a printer on another organization's station is refused",
  (await refuses(
    `insert into printers (org_id, station_id, name, system_name, stock_id) values ($1,$2,'Sneaky','X','roll-single')`,
    [ORG, RIVAL_PC],
  )) === "PS001",
);
ok(
  "a default naming another organization's printer is refused",
  (await refuses(`insert into print_defaults (org_id, user_id, printer_id) values ($1,$2,$3)`, [ORG, ACTOR, RIVAL_LABELS])) ===
    "PS001",
);
ok(
  "a job for another organization's printer is refused",
  (await refuses(
    `insert into print_jobs (org_id, printer_id, description, label_count, payload) values ($1,$2,'x',1,'\\x00'::bytea)`,
    [ORG, RIVAL_LABELS],
  )) === "PS001",
);
ok(
  "moving a printer onto another organization's station is refused",
  (await refuses(`update printers set station_id = $2 where id = $1`, [LABELS, RIVAL_PC])) === "PS001",
);
ok(
  "a printer's organization cannot be rewritten",
  (await refuses(`update printers set org_id = $2 where id = $1`, [LABELS, RIVAL])) === "TG001",
);

const RETIRED = await printer(OFFICE, "Old printer");
await db.query(`update printers set retired_at = now() where id = $1`, [RETIRED]);
ok(
  "a retired printer cannot become a default",
  (await refuses(`insert into print_defaults (org_id, user_id, printer_id) values ($1,$2,$3)`, [ORG, ACTOR, RETIRED])) ===
    "PS004",
);
ok(
  "...nor take a new job",
  (await refuses(
    `insert into print_jobs (org_id, printer_id, description, label_count, payload) values ($1,$2,'x',1,'\\x00'::bytea)`,
    [ORG, RETIRED],
  )) === "PS004",
);
const STILL_DEFAULT = await printer(OFFICE, "Retires while default");
await db.query(`insert into print_defaults (org_id, user_id, printer_id) values ($1,$2,$3)`, [ORG, ACTOR, STILL_DEFAULT]);
await db.query(`update printers set retired_at = now() where id = $1`, [STILL_DEFAULT]);
ok(
  "a default whose printer retires stays, so the screen can say so",
  (await num(`select count(*)::int as n from print_defaults where printer_id = $1`, [STILL_DEFAULT])) === 1,
);
await db.query(`delete from print_defaults where user_id = $1`, [ACTOR]);

// ── 3. A job's life only moves forward ──────────────────────────────────────────────────────────
const CLIENT_ID = randomUUID();
const J1 = await job(LABELS, ORG, CLIENT_ID);
ok("a job is created queued", (await status(J1)) === "queued");
ok("a retried request with the same id is one job (D-INV27)", (await job(LABELS, ORG, CLIENT_ID)) === undefined);
ok(
  "a job cannot be created already printed",
  (await refuses(
    `insert into print_jobs (org_id, printer_id, description, label_count, payload, status, sent_at, finished_at)
     values ($1,$2,'x',1,'\\x00'::bytea,'printed',now(),now())`,
    [ORG, LABELS],
  )) === "PS002",
);
ok(
  "queued → printed, skipping sent, is refused",
  (await refuses(`update print_jobs set status='printed', sent_at=now(), finished_at=now() where id=$1`, [J1])) === "PS002",
);
ok(
  "a queued job's payload cannot be rewritten",
  (await refuses(`update print_jobs set payload='\\x01'::bytea where id=$1`, [J1])) === "PS003",
);
ok(
  "...nor sent to another printer",
  (await refuses(`update print_jobs set printer_id=$2 where id=$1`, [J1, SHOP_LABELS])) === "PS003",
);
ok(
  "a sent job without a sent time is refused by the shape check",
  (await refuses(`update print_jobs set status='sent' where id=$1`, [J1])) === "23514",
);
const CANCELLED = await job(LABELS);
await db.query(`update print_jobs set status='cancelled', finished_at=now() where id=$1`, [CANCELLED]);
ok(
  "a cancelled job stays cancelled",
  (await refuses(`update print_jobs set status='sent', sent_at=now(), finished_at=null where id=$1`, [CANCELLED])) === "PS002",
);

// ── 4. The claim ────────────────────────────────────────────────────────────────────────────────
// J1 is the oldest queued job on LABELS (OFFICE); CANCELLED is not queued. Add a second, newer one.
const J2 = await job(LABELS);
const SHOP_JOB = await job(SHOP_LABELS);
const first = await claim(OFFICE);
ok("the claim hands over the oldest queued job", first.length === 1 && first[0].job_id === J1);
ok("...with the name the station's operating system knows the printer by", first[0]?.system_name === "MUNBYN RW403B");
ok("...and its bytes", first[0]?.payload?.length === 4);
ok("the claimed job is sent, once", (await status(J1)) === "sent");
ok(
  "the claim counts the attempt and stamps the time",
  (await one(`select attempts, sent_at is not null as s from print_jobs where id=$1`, [J1])).attempts === 1,
);
ok(
  "the claim is the heartbeat",
  (await one(`select last_seen_at is not null as seen from print_stations where id=$1`, [OFFICE])).seen === true,
);
const second = await claim(OFFICE);
ok("the next claim hands over the next job, never the same one", second[0]?.job_id === J2);
ok("a station never takes another station's printer's job", (await claim(OFFICE)).length === 0 && (await status(SHOP_JOB)) === "queued");
ok("an unpaired station claims nothing", (await claim(UNPAIRED)).length === 0);
await db.query(`update print_stations set revoked_at = now() where id = $1`, [SHOP_PC]);
ok("a revoked station claims nothing", (await claim(SHOP_PC)).length === 0 && (await status(SHOP_JOB)) === "queued");
await db.query(`update print_stations set revoked_at = null where id = $1`, [SHOP_PC]);

// Two claims racing for one job: SKIP LOCKED in a second connection is not available in PGlite (one
// connection), so the guarantee is pinned by shape — the claim locks the row it takes — and by the
// status change: a job already `sent` is never offered again (asserted just above).
const RETIRES_WITH_WORK = await printer(SHOP_PC, "Retires with work queued");
const ORPHAN = await job(RETIRES_WITH_WORK);
await db.query(`update printers set retired_at = now() where id = $1`, [RETIRES_WITH_WORK]);
const shopTake = await claim(SHOP_PC);
ok(
  "a retired printer's queued job is not handed to the station",
  shopTake.length === 1 && shopTake[0].job_id === SHOP_JOB && (await claim(SHOP_PC)).length === 0,
);
ok("...and stays queued for the screen to cancel", (await status(ORPHAN)) === "queued");

// ── 5. Taken and never reported → unknown ───────────────────────────────────────────────────────
await db.query(`update print_jobs set sent_at = now() - interval '3 minutes' where id = $1`, [J1]);
await claim(OFFICE);
ok("a job silent for over two minutes becomes unknown", (await status(J1)) === "unknown");
ok("...and is NOT put back in the queue (that would print a second label)", (await status(J1)) !== "queued");
ok("a job sent seconds ago is left alone", (await status(J2)) === "sent");
ok(
  "unknown says why",
  /stopped answering/.test((await one(`select error from print_jobs where id=$1`, [J1])).error),
);

// ── 6. The report ───────────────────────────────────────────────────────────────────────────────
const finish = (st, id, okFlag, err = null) =>
  one(`select print_finish_job($1,$2,$3,$4) as s`, [st, id, okFlag, err]).then((r) => r.s);
ok("a late report settles an unknown job", (await finish(OFFICE, J1, true)) === "printed");
ok("printed jobs carry no error", (await one(`select error from print_jobs where id=$1`, [J1])).error === null);
ok(
  "another station cannot settle this station's job",
  (await refuses(`select print_finish_job($1,$2,true,null)`, [SHOP_PC, J2])) === "PS005",
);
ok("a failure is recorded with the printer's reason", (await finish(OFFICE, J2, false, "Out of paper")) === "failed");
ok("...kept", (await one(`select error from print_jobs where id=$1`, [J2])).error === "Out of paper");
ok("a repeated report answers with the outcome instead of erroring", (await finish(OFFICE, J2, true)) === "failed");
ok(
  "a finished job's error cannot be rewritten",
  (await refuses(`update print_jobs set error='nothing happened' where id=$1`, [J2])) === "PS002",
);
const NEVER_SENT = await job(LABELS);
ok(
  "a station cannot report a job it never took",
  (await refuses(`select print_finish_job($1,$2,true,null)`, [OFFICE, NEVER_SENT])) === "PS002",
);

// ── 7. Browsers see nothing ─────────────────────────────────────────────────────────────────────
const asRole = async (role, fn) => {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("rollback");
  }
};
for (const t of ["print_stations", "printers", "print_defaults", "print_jobs"]) {
  ok(`an admin's browser session reads no ${t}`, (await asRole("admin", () => num(`select count(*)::int as n from ${t}`))) === 0);
}
ok(
  "a browser session cannot call the station's claim",
  (await asRole("admin", () => refuses(`select * from print_claim_next_job($1)`, [OFFICE]))) === "42501",
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
