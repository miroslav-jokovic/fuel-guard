// Silvicom 360 — loads.ref is unique among TYPED loads only (migration 0362).
//
// 2026-09-23: a McLeod split order (SD on one movement, SP on another, same order number) made
// `POST /api/tms/loads` refuse a whole 143-load board on `idx_loads_org_ref`. The TMS identity is
// (org, provider, external_id); `ref` on a TMS load is a label, and a split carries it twice. This
// matrix pins both halves: the split is accepted, and nothing an office types lost its guarantee.
//
// Run: node supabase/tests/loads-ref-per-source.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
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

const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;

const tms = (org, ref, external) =>
  sqlstate(
    `insert into loads (org_id, ref, source, provider, external_id, status)
     values ($1, $2, 'tms', 'mcleod', $3, 'pending_approval')`,
    [org, ref, external],
  );
const manual = (org, ref) =>
  sqlstate(`insert into loads (org_id, ref, source) values ($1, $2, 'manual')`, [org, ref]);

// ── the outage: one order, two movements ─────────────────────────────────────────────────────
ok("the SD half of split order 0135136 is ingested", (await tms(ORG_A, "0135136", "TMS:291013")) === null);
ok("the SP half, same order number on another movement, is ingested too", (await tms(ORG_A, "0135136", "TMS:291798")) === null);
ok("but the SAME movement twice is still refused — the TMS identity holds", (await tms(ORG_A, "0135136", "TMS:291798")) === "23505");

// ── what 0085's uniqueness was for is intact ─────────────────────────────────────────────────
ok("a typed load number is accepted once", (await manual(ORG_A, "LD-100")) === null);
ok("and refused the second time in the same org", (await manual(ORG_A, "LD-100")) === "23505");
ok("while another org may use the same number", (await manual(ORG_B, "LD-100")) === null);
ok("a source outside ('manual','tms') is still refused, so the index predicate has no gap",
  (await sqlstate(`insert into loads (org_id, ref, source) values ($1, 'LD-X', 'other')`, [ORG_A])) === "23514");

// ── the index itself ─────────────────────────────────────────────────────────────────────────
const idx = await one(
  `select count(*) filter (where indexname = 'idx_loads_org_ref')::int as old,
          max(indexdef) filter (where indexname = 'idx_loads_org_ref_manual') as manual
     from pg_indexes where tablename = 'loads'`);
ok("the unconditional (org_id, ref) index is gone", idx.old === 0, JSON.stringify(idx));
ok("its replacement is UNIQUE and partial on source = 'manual'",
  /UNIQUE/.test(idx.manual ?? "") && /WHERE \(source = 'manual'::text\)/.test(idx.manual ?? ""), idx.manual);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
