// Q-AM19 stage 3, migration 0609: the office files one photograph that arrived after the application was
// filed. The matrix holds: the document is the capture by id and is written once; it carries the
// capture's own facts and no uploader; the capture is stamped; and the three refusals — not this
// invitation's, not filed yet, and never a selfie.
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
const OTHER_ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org = ORG) => (await one(`insert into drivers (org_id, full_name) values ($1, 'Susan Godfrey') returning id`, [org])).id;
const invite = async (drv, submitted, org = ORG) => (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at, submitted_at)
   values ($1, $2, md5(gen_random_uuid()::text), now() + interval '1 day', ${submitted ? "now()" : "null"}) returning id`, [org, drv])).id;
const stage = async (inv, drv, slot, org = ORG) => (await one(
  `insert into application_captures (org_id, invitation_id, driver_id, slot, storage_path, content_type, bytes, sha256)
   values ($1, $2, $3, $4, $5, 'image/webp', 1234, repeat('a', 64)) returning id`, [org, inv, drv, slot, `${org}/${inv}/${slot}.webp`])).id;
const file = (org, inv, drv, cap, kind = "medical_card", page = 1) =>
  db.query(`select public.file_application_capture($1,$2,$3,$4,$5,$6,$7) as id`, [org, inv, drv, cap, kind, page, `${org}/driver/${drv}/${cap}.webp`]).then((r) => r.rows[0].id);
const fileCode = async (...a) => { try { await file(...a); return null; } catch (e) { return e.code ?? String(e.message); } };

const D = await driver();
const FILED = await invite(D, true);
const CARD = await stage(FILED, D, "medical_card");

// ── 1. the filing ───────────────────────────────────────────────────────────────────────────
ok("files the capture, and answers its id", (await file(ORG, FILED, D, CARD)) === CARD);
const doc = await one(`select subject_type, subject_id, kind, page, content_type, bytes, sha256, uploaded_by, storage_path from documents where id = $1`, [CARD]);
ok("the document IS the capture, on the driver's file", doc?.subject_type === "driver" && doc.subject_id === D);
ok("it carries the kind and page the caller named", doc.kind === "medical_card" && doc.page === 1);
ok("…and the capture's own type, size and hash", doc.content_type === "image/webp" && Number(doc.bytes) === 1234 && doc.sha256 === "a".repeat(64));
ok("no uploader: the applicant took it, the office only filed it", doc.uploaded_by === null);
ok("the capture is stamped as filed", (await one(`select promoted_document_id p from application_captures where id = $1`, [CARD])).p === CARD);

// ── 2. once ─────────────────────────────────────────────────────────────────────────────────
ok("a second call answers the same id", (await file(ORG, FILED, D, CARD)) === CARD);
ok("…and writes no second document", (await one(`select count(*)::int n from documents where subject_id = $1`, [D])).n === 1);

// ── 3. the refusals ─────────────────────────────────────────────────────────────────────────
const D2 = await driver();
const OPEN = await invite(D2, false);
const EARLY = await stage(OPEN, D2, "medical_card");
ok("FC002: not filed yet — filing itself promotes it", (await fileCode(ORG, OPEN, D2, EARLY)) === "FC002");
ok("…and nothing was written", (await one(`select count(*)::int n from documents where id = $1`, [EARLY])).n === 0);
const SELFIE = await stage(FILED, D, "selfie");
ok("FC003: a selfie is never evidence", (await fileCode(ORG, FILED, D, SELFIE, "other")) === "FC003");
ok("FC001: a capture of another invitation", (await fileCode(ORG, FILED, D, EARLY)) === "FC001");
ok("FC001: another org's call", (await fileCode(OTHER_ORG, FILED, D, CARD)) === "FC001");
ok("FC001: the wrong driver", (await fileCode(ORG, FILED, D2, CARD)) === "FC001");
ok("FC001: no such capture", (await fileCode(ORG, FILED, D, "00000000-0000-4000-8000-000000000000")) === "FC001");

// ── 4. who may call it ──────────────────────────────────────────────────────────────────────
const may = async (role) => (await one(`select has_function_privilege($1, 'public.file_application_capture(uuid, uuid, uuid, uuid, text, int, text)', 'execute') p`, [role])).p;
ok("the service role may file", (await may("service_role")) === true);
// ⚠ Held by 0412's default, not by this migration's own revoke (see `invitation-docs-token.test.mjs`).
ok("no client role may", (await may("anon")) === false && (await may("authenticated")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
