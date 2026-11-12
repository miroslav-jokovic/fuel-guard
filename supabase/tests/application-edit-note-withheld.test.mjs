// FuelGuard — application_edits.note and .withheld (migration 0586, APPLICATION-FIX-PLAN F3, Q-AM13).
//
// The two columns carry the owner's rules for F3's corrections: the driver's own drug-and-alcohol
// statements are corrected WITH a reason, and the donor gender and EEO answers are replaced WITHOUT
// their values ever being stored where the office reads. The second is the one a writer could get
// wrong silently, so the database refuses it, and this matrix proves the refusal.
//
// Run:  node supabase/tests/application-edit-note-withheld.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1,'Ana Driver') returning id`, [ORG])).id;
const INV = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
     values ($1, $2, 'hash-edits', now() + interval '14 days') returning id`,
  [ORG, DRIVER],
)).id;

const edit = (cols, vals) => sqlstate(
  `insert into application_edits (org_id, invitation_id, path, ${cols.join(", ")})
     values ($1, $2, '["phone"]'::jsonb, ${cols.map((_, i) => `$${i + 3}`).join(", ")})`,
  [ORG, INV, ...vals],
);

// ── the old writer, which names neither column, still works (the deploy window) ──
ok(
  "a 0337-shaped insert (no note, no withheld) still lands — old code during the deploy window",
  (await edit(["before", "after"], ['"5551112222"', '"5553334444"'])) === null,
);
const row = await one(`select note, withheld from application_edits where invitation_id = $1 limit 1`, [INV]);
ok("…and reads back as an ordinary correction: no note, not withheld", row.note === null && row.withheld === false);

// ── note ──
ok(
  "a correction with the office's reason is admitted",
  (await edit(["before", "after", "note"], ["false", "true", "Driver called 11/10: tested positive in 2025"])) === null,
);
ok("an empty reason is refused — no reason is not a reason", (await edit(["note"], [""])) === "23514");
ok("a reason of only spaces is refused", (await edit(["note"], ["   "])) === "23514");
ok("a reason over 1000 characters is refused", (await edit(["note"], ["x".repeat(1001)])) === "23514");
ok("a reason of exactly 1000 characters is admitted", (await edit(["note"], ["x".repeat(1000)])) === null);

// ── withheld ──
ok(
  "a withheld replacement with no values is admitted",
  (await edit(["withheld"], [true])) === null,
);
ok(
  "a withheld row carrying the NEW value is refused — that value is what the office must never read",
  (await edit(["withheld", "after"], [true, '"female"'])) === "23514",
);
ok(
  "a withheld row carrying the OLD value is refused",
  (await edit(["withheld", "before"], [true, '"male"'])) === "23514",
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
