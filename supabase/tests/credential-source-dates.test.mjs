// Silvicom 360 — each source's medical-card claim (migration 0467, MEDSTOP-PLAN.md §7A.10, Q-MSUX7).
//
// McLeod and Med-Stop each REPORT the medical expiry they hold into `credential_source_dates`; the
// card on file is then decided over all of them (`resolveMedicalExpiry`). Three things only the
// database can prove:
//
//   1. THE BACKFILL. Without McLeod's claim already recorded, Med-Stop's first sweep resolves against
//      itself alone and files rows McLeod's next night moves back. 0467 seeds McLeod's claim from the
//      cards its sweep filed (the SYNC_NOTE text) — and only those.
//   2. WRITE-ONLY-ON-CHANGE. The hourly sweep re-reports 170 unchanged dates; the function must not
//      rewrite them (the database is micro and swapping), and must say whether it moved.
//   3. A MERGED-AWAY DRIVER'S CLAIMS CASCADE (the EXEMPT argument in check-driver-references.mjs).
//
// Run:  node supabase/tests/credential-source-dates.test.mjs
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
const SYNC = "Recorded from the carrier's TMS (McLeod) roster sync — no scan filed by the sync.";
const before = MIGRATIONS.filter((f) => f < "0467");
const after = MIGRATIONS.filter((f) => f >= "0467");
for (const f of before)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const D1 = (await one(`insert into drivers (org_id, full_name) values ($1,'Synced Sam') returning id`, [ORG])).id;
const D2 = (await one(`insert into drivers (org_id, full_name) values ($1,'Office Olga') returning id`, [ORG])).id;
const D3 = (await one(`insert into drivers (org_id, full_name) values ($1,'Old Oscar') returning id`, [ORG])).id;
const cert = (driver, expires, notes) =>
  db.query(`insert into certifications (org_id, subject_type, subject_id, kind, effective_from, expires_at, notes)
            values ($1,'driver',$2,'medical_card',current_date,$3,$4) returning id`, [ORG, driver, expires, notes]);
await cert(D1, "2027-03-01", SYNC);          // filed by McLeod's sweep → backfilled
await cert(D2, "2027-04-01", "typed in by the office"); // office row → not McLeod's claim
// A superseded McLeod row must not be backfilled: only the CURRENT card is McLeod's latest claim.
// (`uq_cert_current` allows one current card, so the old row steps aside before the new one lands.)
const old = (await cert(D3, "2026-01-01", SYNC)).rows[0].id;
await db.query(`update certifications set superseded_by=id, superseded_at=now() where id=$1`, [old]);
const cur = (await cert(D3, "2027-05-01", "typed in by the office")).rows[0].id;
await db.query(`update certifications set superseded_by=$1 where id=$2`, [cur, old]);

for (const f of after)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const claims = async (driver) =>
  (await db.query(`select source, expires_on::text e, changed_at from credential_source_dates where org_id=$1 and driver_id=$2 order by source`, [ORG, driver])).rows;

// ── 1. the backfill ─────────────────────────────────────────────────────────────────────────────
const c1 = await claims(D1);
ok("McLeod's claim is seeded from the card its sweep filed", c1.length === 1 && c1[0].source === "mcleod" && c1[0].e === "2027-03-01", JSON.stringify(c1));
ok("an office-typed card is not taken for McLeod's claim", (await claims(D2)).length === 0);
ok("a SUPERSEDED synced row is not backfilled", (await claims(D3)).length === 0);

// ── 2. write-only-on-change ─────────────────────────────────────────────────────────────────────
const rec = async (driver, source, d) =>
  (await one(`select public.record_credential_source_date($1,$2,'medical_card',$3,$4::date) moved`, [ORG, driver, source, d])).moved;
ok("a new source's claim is stored and reported as moved", (await rec(D1, "medstop", "2026-12-15")) === true);
const stamp = (await claims(D1)).find((c) => c.source === "medstop").changed_at;
ok("the same claim again is NOT rewritten, and says so", (await rec(D1, "medstop", "2026-12-15")) === false);
ok("…and its changed_at did not move", +(await claims(D1)).find((c) => c.source === "medstop").changed_at === +stamp);
ok("a changed claim overwrites the source's row", (await rec(D1, "medstop", "2027-01-20")) === true
  && (await claims(D1)).find((c) => c.source === "medstop").e === "2027-01-20");
ok("one row per (driver, kind, source)", (await claims(D1)).length === 2);
const bad = await sqlstate(`select public.record_credential_source_date($1,$2,'medical_card','samba','2027-01-01')`, [ORG, D1]);
ok("an unknown source is refused until it is connected (Q-MSUX6)", bad === "23514", bad);

// ── 3. posture and the merge ────────────────────────────────────────────────────────────────────
ok("RLS is on", (await one(`select relrowsecurity r from pg_class where relname='credential_source_dates'`)).r === true);
// The merge's own delete — drivers are otherwise archived, never deleted (DR010).
await db.exec(`set fuelguard.merging_driver = 'on'`);
await db.query(`delete from drivers where id=$1`, [D1]);
await db.exec(`reset fuelguard.merging_driver`);
ok("a deleted (merged-away) driver's claims go with it", (await one(`select count(*)::int n from credential_source_dates where driver_id=$1`, [D1])).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
