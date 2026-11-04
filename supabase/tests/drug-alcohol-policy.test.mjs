// Silvicom 360 — the page-28 receipt names the drug-and-alcohol policy text the driver was given (0565).
//
// HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, D-DAP1..D-DAP5 (revised 2026-11-04); owner on Q-OR7. §382.601(d):
// each driver signs that he or she received a copy of the carrier's policy. The policy's text lives in code
// (versioned `dap-…`, as the handbook is `hb-…`); what only the database can answer:
//
//  1. p28 cannot be signed without the policy version the driver was given (DR039), and keeps it.
//  2. No other mark carries a policy version (DR041); a version has the `dap-` shape (23514).
//  3. The signed policy files on the driver as `drug_alcohol_policy`; the 13-argument function still signs
//     every other mark during the deploy window; the new function is not callable from a browser.
//
// Run:  node supabase/tests/drug-alcohol-policy.test.mjs
//
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
const drv = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Marija Varmeda', 'applicant') returning id`, [ORG])).id;
const V1 = "dap-f610e4c1aaa88f92";
const V2 = "dap-0123456789abcdef";

const invite = async () => {
  const inv = (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
    values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`, [ORG, drv])).id;
  await db.query(`update application_invitations set approved_at = now() where id = $1`, [inv]);
  await db.query(`select public.open_packet_signing($1,$2,$3,14)`, [ORG, inv, `sign-${inv}`]);
  return inv;
};
const mark14 = (inv, placement, page, version) => sqlstate(
  `select public.record_packet_mark($1,$2,$3,$4,'signature','Signature','x','Marija Varmeda','203.0.113.9','UA',30,'pkt-v1',null,$5)`,
  [ORG, inv, placement, page, version]);
const versionOf = async (inv, placement) =>
  (await one(`select policy_version v from application_packet_marks where invitation_id = $1 and placement_id = $2`, [inv, placement])).v;

const I1 = await invite();
ok("p28 without the policy version the driver was given is refused (DR039)", (await mark14(I1, "p28", 28, null)) === "DR039");
ok("a version that is not a policy version is refused (23514)", (await mark14(I1, "p28", 28, "hb-f610e4c1aaa88f92")) === "23514");
ok("p28 is signed against the policy text the driver read", (await mark14(I1, "p28", 28, V1)) === null);
ok("…and the receipt keeps which text that was", (await versionOf(I1, "p28")) === V1);
ok("a mark that receipts no policy carries no version (DR041)", (await mark14(I1, "p27", 27, V1)) === "DR041");
ok("…and is signed with none", (await mark14(I1, "p27", 27, null)) === null && (await versionOf(I1, "p27")) === null);

const I2 = await invite();
ok("after the carrier amends the policy, a new receipt names the new text", (await mark14(I2, "p28", 28, V2)) === null);
ok("…and the earlier receipt still names the text it was given", (await versionOf(I1, "p28")) === V1 && (await versionOf(I2, "p28")) === V2);

const old13 = (inv, placement, page) => sqlstate(
  `select public.record_packet_mark($1,$2,$3,$4,'signature','Signature','x','Marija Varmeda','203.0.113.9','UA',30,'pkt-v1',null)`,
  [ORG, inv, placement, page]);
ok("the 13-argument function still signs other marks during the deploy window", (await old13(I2, "p27", 27)) === null);

ok("the signed policy files on the driver as drug_alcohol_policy", (await sqlstate(
  `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
   values (gen_random_uuid(), $1, 'driver', $2, 'drug_alcohol_policy', $3, 'application/pdf', repeat('c', 64))`,
  [ORG, drv, `${ORG}/driver/${drv}/policy.pdf`])) === null);

const SIG = "public.record_packet_mark(uuid,uuid,text,int,text,text,text,text,text,text,int,text,uuid,text)";
const g = await one(`select has_function_privilege('anon', '${SIG}', 'execute') a,
  has_function_privilege('authenticated', '${SIG}', 'execute') u, has_function_privilege('service_role', '${SIG}', 'execute') s`);
ok("the 14-argument function is the service role's only", !g.a && !g.u && g.s);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
