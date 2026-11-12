// Silvicom 360 — the applicant's SSN before signing (migration 0589, APPLICATION-FIX-PLAN item 3, Q-AM3/Q-AM17).
//
// `record_applicant_ssn` is the one writer of `application_ssns`. What matters: it refuses another org's
// or driver's invitation, a revoked one and a filed one; it writes once and replaces after; the row
// holds only the last four in the clear; no browser can read it; and it goes with its invitation.
//
// Run:  node supabase/tests/application-ssns.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);
const code = async (q, p = []) => {
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
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org, extra = "") =>
  (await one(`insert into drivers (org_id, full_name, status ${extra ? "," + extra.split("=")[0] : ""})
              values ($1, 'Applicant', 'applicant' ${extra ? ",'" + extra.split("=")[1] + "'" : ""}) returning id`, [org])).id;
const invite = async (org, drv, expires = "now() + interval '14 days'") =>
  (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
              values ($1, $2, md5(random()::text), ${expires}) returning id`, [org, drv])).id;

const record = (org, inv, drv, last4 = "6789", sealed = "v1.sealed", by = "applicant") =>
  db.query(`select public.record_applicant_ssn($1,$2,$3,$4,$5,$6)`, [org, inv, drv, last4, sealed, by]);
const recordCode = async (...a) => { try { await record(...a); return null; } catch (e) { return e.code; } };
const row = async (inv) => one(`select ssn_last4, ssn_sealed, entered_by from application_ssns where invitation_id = $1`, [inv]);

const D1 = await driver(ORG);
const I1 = await invite(ORG, D1);

// ── 1. Refusals ──────────────────────────────────────────────────────────────────────────────────
ok("SN001: another org's invitation is not found", (await recordCode(OTHER, I1, D1)) === "SN001");
ok("SN001: another driver's invitation is not found", (await recordCode(ORG, I1, await driver(ORG))) === "SN001");
const DR = await driver(ORG);
const IR = await invite(ORG, DR);
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [IR]);
ok("SN002: a revoked invitation refuses", (await recordCode(ORG, IR, DR)) === "SN002");
const DS = await driver(ORG);
const IS = await invite(ORG, DS);
await db.query(`update application_invitations set submitted_at = now() where id = $1`, [IS]);
ok("SN003: a filed application refuses — after filing the number lives on driver_applications",
  (await recordCode(ORG, IS, DS)) === "SN003");
ok("…and none of the refused calls wrote a row", (await count(`select count(*) n from application_ssns`)) === 0);

// ── 2. The write, then the replacement ───────────────────────────────────────────────────────────
await record(ORG, I1, D1, "6789", "v1.first", "applicant");
ok("the driver's entry is written", JSON.stringify(await row(I1)) === JSON.stringify({ ssn_last4: "6789", ssn_sealed: "v1.first", entered_by: "applicant" }));
await record(ORG, I1, D1, "1234", "v1.second", "office");
ok("the office's replacement replaces it, one row per invitation",
  JSON.stringify(await row(I1)) === JSON.stringify({ ssn_last4: "1234", ssn_sealed: "v1.second", entered_by: "office" })
  && (await count(`select count(*) n from application_ssns where invitation_id = $1`, [I1])) === 1);
await record(ORG, I1, D1, "1234", null, "office");
ok("no secret box configured: the last four alone (0220's rule)", (await row(I1)).ssn_sealed === null);
ok("the clear column takes four digits and nothing more (23514)",
  (await recordCode(ORG, I1, D1, "123456789", "v1.x", "office")) === "23514");
ok("…and only the driver or the office entered it (23514)",
  (await recordCode(ORG, I1, D1, "1234", "v1.x", "recruiter")) === "23514");

// ── 3. Who can reach it ──────────────────────────────────────────────────────────────────────────
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where relname = 'application_ssns'`)).r === true
  && (await count(`select count(*) n from pg_policies where tablename = 'application_ssns'`)) === 0);
{
  const can = async (role) => (await one(`select has_function_privilege($1, 'public.record_applicant_ssn(uuid,uuid,uuid,text,text,text)', 'execute') c`, [role])).c;
  ok("a browser cannot call the writer, signed in or not", (await can("anon")) === false && (await can("authenticated")) === false);
  ok("…and the api can", (await can("service_role")) === true);
}
ok("the table has no column for the whole number in the clear",
  (await count(`select count(*) n from information_schema.columns where table_name = 'application_ssns'
                 and column_name not in ('invitation_id','org_id','ssn_last4','ssn_sealed','entered_by','created_at','updated_at')`)) === 0);

// ── 4. It goes with its invitation ───────────────────────────────────────────────────────────────
await db.query(`delete from application_invitations where id = $1`, [I1]);
ok("deleting the invitation deletes its SSN row (purge_applicant needs no change)",
  (await count(`select count(*) n from application_ssns where invitation_id = $1`, [I1])) === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
