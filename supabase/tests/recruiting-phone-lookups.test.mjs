// LQ8a, migration 0583: the phone provider's reading of a lead's number — one row per (org, E.164), replaced on
// a re-look, four line-type words, Telnyx's own word in `raw`. The fold from Telnyx's words to ours is the shared
// `foldLineType`; this matrix holds the CHECK and that fold to the same four words (0554's phone pattern).
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PHONE_LINE_TYPES, PHONE_LOOKUP_PROVIDERS, foldLineType } from "../../packages/shared/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); }
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
const insert = (org, phone, line, provider = "telnyx", extra = "") => sqlstate(
  `insert into phone_lookups (org_id, phone_e164, provider, line_type${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, $3, $4${extra ? ", " + extra.split("=")[1] : ""})`,
  [org, phone, provider, line]);

// ── 1. the four words, and only those ────────────────────────────────────────────────────────────
let stored = 0;
for (const [i, t] of PHONE_LINE_TYPES.entries()) if ((await insert(ORG, `+1708236000${i}`, t)) === null) stored += 1;
ok("every shared line type is stored", stored === PHONE_LINE_TYPES.length, String(stored));
ok("a word outside the four is refused (23514)", (await insert(ORG, "+17082360099", "fixed line")) === "23514");
ok("the fold never yields a word the CHECK refuses", ["mobile", "fixed line", "voip", "toll free", "pager", "", null].every((w) => PHONE_LINE_TYPES.includes(foldLineType(w))));
let providers = 0;
for (const [i, p] of PHONE_LOOKUP_PROVIDERS.entries()) if ((await insert(ORG, `+1708236010${i}`, "unknown", p)) === null) providers += 1;
ok("both providers are stored; another is refused (23514)", providers === PHONE_LOOKUP_PROVIDERS.length && (await insert(ORG, "+17082360199", "unknown", "twilio")) === "23514");

// ── 2. one row per (org, number); another carrier's row is its own ──────────────────────────────
ok("the same number twice in one carrier is refused (23505): a re-look is an UPDATE", (await insert(ORG, "+17082360000", "voip")) === "23505");
ok("the same number in another carrier is a separate row", (await insert(OTHER, "+17082360000", "voip")) === null);
ok("a non-E.164 phone is refused (23514)", (await insert(ORG, "7082360000", "mobile")) === "23514");
const upd = await db.query(`update phone_lookups set line_type = 'landline', carrier = 'AT&T', valid = true, raw = '{"carrier":{"type":"fixed line"}}', looked_up_at = now() where org_id = $1 and phone_e164 = '+17082360000' returning line_type, carrier, raw`, [ORG]);
ok("a re-look replaces the row whole and keeps Telnyx's own word in raw", upd.rows[0].line_type === "landline" && upd.rows[0].carrier === "AT&T" && upd.rows[0].raw.carrier.type === "fixed line");
ok("a carrier name over 120 characters is refused (23514)", (await sqlstate(`update phone_lookups set carrier = repeat('x', 121) where org_id = $1 and phone_e164 = '+17082360000'`, [ORG])) === "23514");

// ── 3. RLS and lifecycle ─────────────────────────────────────────────────────────────────────────
ok("row level security is on", (await one(`select relrowsecurity as r from pg_class where oid = 'public.phone_lookups'::regclass`)).r === true);
ok("the age index exists for the 400-day prune", (await one(`select count(*)::int as n from pg_indexes where tablename = 'phone_lookups' and indexname = 'ix_phone_lookups_age'`)).n === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
