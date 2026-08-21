// FuelGuard — signing ceremony matrix (migration 0228, APPLICATION-SYSTEM-PLAN A5 / D-APP7).
//
// `POST /api/public/application/:token/release` has existed since H5b with no caller. A5 gives it
// one, and this proves the database half of what the ceremony promises:
//
//   · four instruments become four rows, each carrying the exact text and version signed
//   · the FOURTH one closes the phase — releases_completed_at is stamped in the same transaction
//   · the same instrument cannot be signed twice on one link, however many taps or tabs arrive
//   · a signature names the invitation that carried it, so "did THIS session collect them?" is a
//     question the data can answer (a rehire's year-old signatures do not discharge a new screen —
//     PSP's account agreement requires a signed authorization in advance of each request)
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/release-ceremony.test.mjs
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
const raised = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

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

// A brand new table has no grant for `authenticated` without this, so a read would ERROR rather than
// be filtered by policy — and "it threw" would look like "it was refused".
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
  alter default privileges in schema public grant select on tables to anon;
`);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','applicant') returning id`, [ORG])
).id;

const invite = async (label, expires = "now() + interval '14 days'") =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [ORG, DRIVER, `hash-${label}`],
    )
  ).id;

// The four instruments, in APPLICATION_RELEASE_ORDER. The count is passed in by the API for the same
// reason the vocabulary lives in TypeScript: a fifth one is a change to an array, not a migration.
const ORDER = ["fcra_disclosure", "psp", "previous_employer", "drug_alcohol"];

const sign = (invitation, purpose, expected = ORDER.length) =>
  db.query(
    `select public.record_driver_release($1,$2,$3,$4,'v1',$5,$6,'Susan Godfrey','203.0.113.9','UA',$7) as r`,
    [ORG, invitation, DRIVER, purpose, `Text for ${purpose}`, `I authorize ${purpose}.`, expected],
  );

// ── four documents, four rows, and the fourth closes the ceremony ──────────────────────────────
const INV = await invite("susan");
const results = [];
for (const purpose of ORDER) results.push((await sign(INV, purpose)).rows[0].r);

ok("each instrument becomes its own row", (await count(`select count(*)::int as n from driver_authorizations where invitation_id = $1`, [INV])) === 4);
ok("the count climbs one at a time", results.map((r) => r.signed_count).join(",") === "1,2,3,4");
ok(
  "only the last one reports the ceremony complete",
  results.slice(0, 3).every((r) => r.completed === false) && results[3].completed === true,
);
ok(
  "and the phase is stamped in that same transaction",
  (await one(`select releases_completed_at from application_invitations where id = $1`, [INV])).releases_completed_at !== null,
);
// FCRA §604(b)(2): one row IS one document. Four distinct texts, four distinct intents.
const texts = (await db.query(`select disclosure_text, intent_statement, method, signed_name, recorded_by from driver_authorizations where invitation_id = $1`, [INV])).rows;
ok("each row carries its own text", new Set(texts.map((t) => t.disclosure_text)).size === 4);
ok("and its own intent sentence", new Set(texts.map((t) => t.intent_statement)).size === 4);
ok("all recorded as e-signatures by the applicant themselves", texts.every((t) => t.method === "esign" && t.recorded_by === null));
ok("carrying the name they adopted", texts.every((t) => t.signed_name === "Susan Godfrey"));
ok("and naming the link that carried them", (await count(`select count(*)::int as n from driver_authorizations where invitation_id = $1 and org_id = $2`, [INV, ORG])) === 4);

// ── no control can produce more than one of them ───────────────────────────────────────────────
const twice = await raised(() => sign(INV, "psp"));
ok("the same instrument cannot be signed twice on one link", twice?.code === "DR022" || twice?.code === "DR023", String(twice?.code));
ok("and nothing was added", (await count(`select count(*)::int as n from driver_authorizations where invitation_id = $1`, [INV])) === 4);

// Reaching for a fifth after the ceremony closed.
const fifth = await raised(() => sign(INV, "clearinghouse"));
ok("a closed ceremony refuses another signature (DR022)", fifth?.code === "DR022", String(fifth?.code));

// The duplicate refusal on an OPEN ceremony is its own code, so the API can say "already signed".
const INV2 = await invite("gary");
await sign(INV2, "psp");
const dupOpen = await raised(() => sign(INV2, "psp"));
ok("a duplicate on an open ceremony is DR023", dupOpen?.code === "DR023", String(dupOpen?.code));
ok("and it left the one signature alone", (await count(`select count(*)::int as n from driver_authorizations where invitation_id = $1`, [INV2])) === 1);

// ── the invitation still governs the whole session ─────────────────────────────────────────────
const REVOKED = await invite("revoked");
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED]);
const revoked = await raised(() => sign(REVOKED, "psp"));
ok("a revoked invitation cannot be signed on (DR021)", revoked?.code === "DR021", String(revoked?.code));

const EXPIRED = await invite("expired", "now() - interval '1 day'");
const expired = await raised(() => sign(EXPIRED, "psp"));
ok("nor an expired one (DR021)", expired?.code === "DR021", String(expired?.code));

// ── a signature outlives the credential that carried it ────────────────────────────────────────
// `on delete set null`: an invitation is a credential and may be cleaned up; the signature it
// produced is evidence in RETENTION_FORBIDDEN and never goes with it.
const DOOMED = await invite("doomed");
await sign(DOOMED, "psp");
await db.query(`delete from application_invitations where id = $1`, [DOOMED]);
ok(
  "deleting the invitation leaves the signature standing",
  (await count(`select count(*)::int as n from driver_authorizations where driver_id = $1 and invitation_id is null`, [DRIVER])) === 1,
);

// ── a second application may collect the same purposes again ───────────────────────────────────
// A rehire's year-old signatures do not discharge a new screen, and PSP's account agreement requires
// a signed authorization in advance of EACH request. The unique index is per link, not per driver.
const RESCREEN = await invite("rescreen");
const again = await raised(() => sign(RESCREEN, "psp"));
ok("the same purpose can be signed again on a NEW link", again === null, String(again?.code));

ok(
  "the ceremony function is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'record_driver_release' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
