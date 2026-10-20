// Silvicom 360 — the bulk-upload review queue (migration 0505, UNIT-FILES-PLAN UF7a, D-UF8).
//
// One row per proposed paper, decided by a person (filed, discarded) or by the service (duplicate).
// What the table itself must refuse: half a subject, pages running backwards, a decision without its
// decider, a "filed" row with no document behind it, and a document filed and then deleted under it.
//
// Run: node supabase/tests/file-intake-items.test.mjs
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'654',240) returning id`, [ORG])).id;
const PERSON = (await one(`insert into auth.users (email) values ('office@x.test') returning id`)).id;
const DOC = (await one(`insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
  values (gen_random_uuid(), $1, 'tractor', $2, 'registration', $3, 'application/pdf', repeat('b', 64)) returning id`,
  [ORG, TRUCK, `${ORG}/tractor/${TRUCK}/reg.pdf`])).id;

const BATCH = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const item = (cols = "", vals = "", params = []) =>
  sqlstate(`insert into file_intake_items (org_id, batch_id, source_id${cols}) values ($1, '${BATCH}', '${SOURCE}'${vals})`, [ORG, ...params]);

ok("a pending proposal with no subject is a valid row — no proposal is an answer", (await item()) === null);
ok("a proposal names a subject type AND id, or neither",
  (await item(", proposed_subject_type", ", 'tractor'")) === "23514");
ok("a drop on one row's cell fixes the subject as a pair too",
  (await item(", scope_subject_id", ", $2", [TRUCK])) === "23514");
ok("pages run forward from 1", (await item(", page_from, page_to", ", 3, 2")) === "23514");
ok("pages are both set or both null", (await item(", page_from", ", 1")) === "23514");
ok("a basis outside the matcher's vocabulary is refused", (await item(", match_basis", ", 'guess'")) === "23514");
ok("confidence is a fraction", (await item(", confidence", ", 1.5")) === "23514");

ok("a pending row carries no decision",
  (await item(", decided_by, decided_at", ", $2, now()", [PERSON])) === "23514");
ok("a person's decision says who, when and whether they changed the proposal",
  (await item(", status, decided_at, changed", ", 'discarded', now(), false")) === "23514");
ok("discarded by a person is a valid decision",
  (await item(", status, decided_by, decided_at, changed", ", 'discarded', $2, now(), true", [PERSON])) === null);
ok("a duplicate is the service's verdict, with no person",
  (await item(", status, decided_at", ", 'duplicate', now()")) === null);
ok("a duplicate still says when it was found, and nobody chose to change it",
  (await item(", status", ", 'duplicate'")) === "23514" &&
  (await item(", status, decided_at, changed", ", 'duplicate', now(), true")) === "23514");

ok("filed means a document was written",
  (await item(", status, decided_by, decided_at, changed", ", 'filed', $2, now(), false", [PERSON])) === "23514");
ok("filed with its document and certifications is valid",
  (await item(", status, decided_by, decided_at, changed, filed_document_id, filed_certification_ids",
    ", 'filed', $2, now(), false, $3, array[gen_random_uuid()]", [PERSON, DOC])) === null);
ok("only filing writes a document",
  (await item(", status, decided_by, decided_at, changed, filed_document_id", ", 'discarded', $2, now(), false, $3", [PERSON, DOC])) === "23514");
ok("only filing writes certifications",
  (await item(", filed_certification_ids", ", array[gen_random_uuid()]")) === "23514");
// 23001 restrict_violation: the FK's `on delete restrict`, not some other refusal on `documents`.
ok("a filed paper's document cannot be deleted from under its row",
  (await sqlstate(`delete from documents where id = $1`, [DOC])) === "23001");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
