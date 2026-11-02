// §11 S1 (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9.3), migration 0550: the carrier's required
// questions and the documents it offers as settings, and the required set stamped on the invitation
// at its FIRST Send — a resend never restamps, so an applicant keeps the rules they were first served.
// roster merge, removed by the purge (that half is `purge-applicant.test.mjs`).
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}


const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org) => (await one(`insert into drivers (org_id, full_name) values ($1, 'Applicant') returning id`, [org])).id;
const invite = async (org) => (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
   values ($1, $2, md5(random()::text), now() + interval '10 days') returning id`, [org, await driver(org)])).id;
const send = (org, inv, required) => required === undefined
  ? db.query(`select public.send_application_invitation($1, $2, md5(random()::text), 7) as sent`, [org, inv])
  : db.query(`select public.send_application_invitation($1, $2, md5(random()::text), 7, $3) as sent`, [org, inv, required]);
const stamp = async (inv) => (await one(`select required_questions r, application_sent_at s from application_invitations where id = $1`, [inv]));

// ── the two settings ────────────────────────────────────────────────────────────────────────────
await db.query(`insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 7, true, 48)`, [ORG]);
const s0 = await one(`select required_questions q, offered_document_slots d from recruiting_settings where org_id = $1`, [ORG]);
ok("a carrier starts on the product default for both (null)", s0.q === null && s0.d === null);
const setQ = (v) => sqlstate(`update recruiting_settings set required_questions = $1 where org_id = $2`, [v, ORG]);
const setD = (v) => sqlstate(`update recruiting_settings set offered_document_slots = $1 where org_id = $2`, [v, ORG]);
ok("a required set is stored", (await setQ(["position", "references"])) === null);
ok("an empty required set (nothing required) is stored", (await setQ([])) === null);
ok("back to the default (null) is stored", (await setQ(null)) === null);
ok("an offered set is stored", (await setD(["twic", "passport"])) === null);
ok("an empty offered set is stored", (await setD([])) === null);
ok("a question id with capitals is refused (shape check)", (await setQ(["Position"])) === "23514");
ok("a question id with a space is refused", (await setQ(["heard from"])) === "23514");
ok("an empty-string id is refused", (await setQ(["position", ""])) === "23514");
ok("a null element beside a good one is refused", (await setQ(["position", null])) === "23514");
ok("an id over 60 characters is refused", (await setQ(["a".repeat(61)])) === "23514");
ok("more than 60 ids are refused", (await setQ(Array.from({ length: 61 }, (_, i) => `q${i}`))) === "23514");
ok("a slot id with punctuation is refused", (await setD(["twic;drop"])) === "23514");
ok("a null slot element beside a good one is refused", (await setD(["twic", null])) === "23514");

// ── the stamp on the invitation ─────────────────────────────────────────────────────────────────
const INV = await invite(ORG);
ok("an invitation starts unstamped", (await stamp(INV)).r === null);
await send(ORG, INV, ["position", "applying_as"]);
const first = await stamp(INV);
ok("the first Send stamps the required set", JSON.stringify(first.r) === JSON.stringify(["position", "applying_as"]) && first.s !== null);
await send(ORG, INV, ["references"]);
ok("a resend never restamps", JSON.stringify((await stamp(INV)).r) === JSON.stringify(["position", "applying_as"]));
await send(ORG, INV);
ok("a 4-argument resend leaves the stamp alone", JSON.stringify((await stamp(INV)).r) === JSON.stringify(["position", "applying_as"]));

const OLD = await invite(ORG);
await send(ORG, OLD);
const old = await stamp(OLD);
ok("the 4-argument call (code served before S2) still sends, unstamped", old.s !== null && old.r === null);
await send(ORG, OLD, ["position"]);
ok("an invitation first sent unstamped is not stamped by a later Send", (await stamp(OLD)).r === null);

const NONE = await invite(ORG);
await send(ORG, NONE, []);
ok("an empty set is a stamp (nothing required), not null", Array.isArray((await stamp(NONE)).r) && (await stamp(NONE)).r.length === 0);

const BAD = await invite(ORG);
ok("a malformed stamp is refused by the invitation's own check", (await sqlstate(
  `select public.send_application_invitation($1, $2, md5(random()::text), 7, $3)`, [ORG, BAD, ["Position"]])) === "23514");
ok("…and the refused Send left the invitation unsent", (await stamp(BAD)).s === null);

const X = await invite(OTHER);
ok("another carrier's invitation is not found (AI001)", (await sqlstate(
  `select public.send_application_invitation($1, $2, md5(random()::text), 7, $3)`, [ORG, X, ["position"]])) === "AI001");
ok("…and is not stamped", (await stamp(X)).r === null);

// ── the function's door ─────────────────────────────────────────────────────────────────────────
const fns = (await db.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'send_application_invitation'`)).rows;
ok("one send_application_invitation, the 5-argument one (no ambiguous overload)", fns.length === 1 && /text\[\]/.test(fns[0].a));
for (const role of ["anon", "authenticated"]) {
  const can = (await one(`select has_function_privilege($1, 'public.send_application_invitation(uuid, uuid, text, int, text[])', 'execute') c`, [role])).c;
  ok(`${role} may not execute send_application_invitation`, can === false);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
