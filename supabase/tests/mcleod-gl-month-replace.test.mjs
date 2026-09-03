// Silvicom 360 — replace_mcleod_gl_month matrix (migration 0302, D-FIN6).
//
// One org-month of GL control totals is replaced in one statement. What this matrix pins:
//
//   1. ZERO ROWS NEVER DELETE — an empty payload writes nothing and removes nothing; the month
//      keeps what it had. (Before 2026-09-03 the two-call API path erased the month instead.)
//   2. REPLACE MEANS REPLACE — a reclassified entry's abandoned (module, account) row is gone
//      after the next sweep, and the surviving rows carry the new stamp.
//   3. TENANT SCOPE IS THE ARGUMENT — another org's rows for the same month are untouched.
//   4. OTHER MONTHS ARE UNTOUCHED — the stale delete is keyed on the month passed in.
//   5. A MALFORMED PAYLOAD FAILS WHOLE — a non-array lands nothing and deletes nothing.
//
// Run:  node supabase/tests/mcleod-gl-month-replace.test.mjs
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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);

for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: mcleod-gl-month-replace -----------------------------");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'), ($2,'Carrier B')`, [ORG_A, ORG_B]);

const JUNE = "2026-06-01", JULY = "2026-07-01", AUG = "2026-08-01";
const replace = (org, start, end, rows) =>
  db.query(`select * from replace_mcleod_gl_month($1, $2, $3, $4::jsonb)`, [org, start, end, JSON.stringify(rows)]);
const month = async (org, start) =>
  (await db.query(
    `select post_module, glid, line_count, net_amount::text, abs_amount::text, swept_at from mcleod_gl_totals
      where org_id=$1 and period_start=$2 order by post_module, glid`,
    [org, start],
  )).rows;

// Seed: June has SET on two accounts, July has one row; org B has its own June.
const first = await replace(ORG_A, JUNE, JULY, [
  { post_module: "SET", glid: "20500010", lines: 2751, net_amount: 0, abs_amount: 2525787.48 },
  { post_module: "SET", glid: "20500020", lines: 10, net_amount: 5.5, abs_amount: 11 },
]);
ok("first sweep lands both rows and removes nothing", first.rows[0].upserted === 2 && first.rows[0].stale_removed === 0);
await replace(ORG_A, JULY, AUG, [{ post_module: "SET", glid: "20500010", lines: 1, net_amount: 0, abs_amount: 1 }]);
await replace(ORG_B, JUNE, JULY, [{ post_module: "SET", glid: "20500010", lines: 9, net_amount: 0, abs_amount: 9 }]);

// ── 1. zero rows never delete ─────────────────────────────────────────────────────────────────
const empty = await replace(ORG_A, JUNE, JULY, []);
ok("an empty payload reports 0 upserted / 0 removed", empty.rows[0].upserted === 0 && empty.rows[0].stale_removed === 0);
ok("  and June still holds both rows", (await month(ORG_A, JUNE)).length === 2);
const nul = await replace(ORG_A, JUNE, JULY, null);
ok("a null payload is treated the same as empty", nul.rows[0].upserted === 0 && (await month(ORG_A, JUNE)).length === 2);

// ── 5. malformed payload fails whole ──────────────────────────────────────────────────────────
let threw = false;
try { await db.query(`select * from replace_mcleod_gl_month($1,$2,$3,$4::jsonb)`, [ORG_A, JUNE, JULY, JSON.stringify({ not: "an array" })]); }
catch { threw = true; }
const objRes = threw ? null : (await month(ORG_A, JUNE)).length;
ok("a non-array payload lands nothing and deletes nothing", threw || objRes === 2);

// ── 2. replace means replace ──────────────────────────────────────────────────────────────────
const beforeStamp = (await month(ORG_A, JUNE))[0].swept_at;
const second = await replace(ORG_A, JUNE, JULY, [
  { post_module: "SET", glid: "20500010", lines: 2760, net_amount: 0, abs_amount: 2530000 },
  { post_module: "FUEL", glid: "20550000", lines: 57486, net_amount: 0, abs_amount: 2383148.18 },
]);
const juneAfter = await month(ORG_A, JUNE);
ok("the second sweep upserts its two rows and removes the one it did not carry", second.rows[0].upserted === 2 && second.rows[0].stale_removed === 1);
ok("  the abandoned account 20500020 is gone", !juneAfter.some((r) => r.glid === "20500020"));
ok("  the re-swept account carries the new figures", juneAfter.find((r) => r.glid === "20500010")?.line_count === 2760);
ok("  every surviving row carries one stamp, newer than before", new Set(juneAfter.map((r) => String(r.swept_at))).size === 1 && new Date(juneAfter[0].swept_at) > new Date(beforeStamp));

// ── 3 + 4. tenant and month scope ─────────────────────────────────────────────────────────────
ok("org B's June is untouched by org A's sweeps", (await month(ORG_B, JUNE)).length === 1);
ok("org A's July is untouched by a June sweep", (await month(ORG_A, JULY)).length === 1);

// ── grants ────────────────────────────────────────────────────────────────────────────────────
const grants = await db.query(
  `select grantee from information_schema.routine_privileges
    where routine_name='replace_mcleod_gl_month' and privilege_type='EXECUTE' order by grantee`,
);
const grantees = grants.rows.map((r) => r.grantee);
ok("service_role may execute it; anon and authenticated may not", grantees.includes("service_role") && !grantees.includes("anon") && !grantees.includes("authenticated"), grantees.join(","));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
