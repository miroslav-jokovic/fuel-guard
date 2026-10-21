// Silvicom 360 — replace_mcleod_gl_key_lines matrix (migration 0509, TRUCK-DRIVER-PNL-PLAN P0c + D-FIN6).
//
// The ledger per posting key, for the modules a staged sub-ledger posts through, replaced a calendar
// month at a time. What this matrix pins:
//
//   1. ONE ROW PER (MODULE, KEY, ACCOUNT, DAY) — the same key in two modules is two postings, and a
//      posting's accounts are each their own row.
//   2. ZERO ROWS NEVER DELETE (D-FIN6) — an empty or null payload writes nothing and removes nothing.
//   3. REPLACE MEANS REPLACE — a posting that is gone from the next sweep loses its rows, in every
//      module of the month, rather than standing beside the new sweep's rows.
//   4. A ROW OUTSIDE THE MONTH IS REFUSED — the stale delete is scoped to the month, so a row dated
//      outside it would be written once and never cleaned up.
//   5. THE COMPANY IS PART OF THE IDENTITY — another legal entity's sweep neither overwrites nor
//      deletes this one's rows.
//   6. TENANT SCOPE IS THE ARGUMENT — another org's month is untouched.
//   7. NO CLIENT CAN CALL IT — closed to anon and authenticated, open to the service role.
//
// Run:  node supabase/tests/mcleod-gl-key-lines.test.mjs
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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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


console.log("\n---- Matrix: mcleod-gl-key-lines -------------------------------");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'), ($2,'Carrier B')`, [ORG_A, ORG_B]);

const JULY = "2026-07-01", AUGUST = "2026-08-01";
const replace = (org, rows, company = "TMS", start = JULY, end = AUGUST) =>
  db.query(`select * from replace_mcleod_gl_key_lines($1, $2, $3, $4, $5::jsonb)`, [org, company, start, end, JSON.stringify(rows)]);
const keys = async (org, company = "TMS") =>
  (await db.query(
    `select txn_date::text, post_module, post_key, glid, line_count, net_amount::text
       from mcleod_gl_key_lines where org_id=$1 and company_id=$2 order by post_module, post_key, glid`,
    [org, company],
  )).rows;

// A July bill posts its receivable and its revenue under one key; a settlement accrual posts under a
// key that happens to share the bill's string — a different module, so a different posting.
const bill = (glid, net) => ({ txn_date: "2026-07-14", post_module: "BILL", post_key: "1001", glid, lines: 1, net_amount: net });
const first = await replace(ORG_A, [
  bill("12000000", 4864.64),
  bill("30000001", -4250),
  bill("30000031", -614.64),
  { txn_date: "2026-07-14", post_module: "SET", post_key: "1001", glid: "20500010", lines: 1, net_amount: -900 },
  { txn_date: "2026-07-20", post_module: "SETV", post_key: "77", glid: "20500010", lines: 1, net_amount: 450 },
]);
ok("first sweep lands five rows and removes nothing",
  first.rows[0].upserted === 5 && first.rows[0].stale_removed === 0, JSON.stringify(first.rows[0]));

// ── 1. one row per (module, key, account, day) ───────────────────────────────────────────────
const k1 = await keys(ORG_A);
ok("a bill's three accounts are three rows under one key",
  k1.filter((r) => r.post_module === "BILL" && r.post_key === "1001").length === 3);
ok("  and the same key string in SET is its own posting",
  k1.some((r) => r.post_module === "SET" && r.post_key === "1001" && r.net_amount === "-900.00"));

// ── 2. zero rows never delete ────────────────────────────────────────────────────────────────
const empty = await replace(ORG_A, []);
ok("an empty payload reports zeros", empty.rows[0].upserted === 0 && empty.rows[0].stale_removed === 0);
ok("  and July still holds its five rows", (await keys(ORG_A)).length === 5);
const nul = await replace(ORG_A, null);
ok("a null payload is treated the same as empty", nul.rows[0].upserted === 0 && (await keys(ORG_A)).length === 5);

// ── 3. replace means replace ─────────────────────────────────────────────────────────────────
// The next sweep: the bill was re-posted with its accessorial on a different account, and the SETV
// posting is gone. The module that posted nothing this time must not keep its old row.
const second = await replace(ORG_A, [
  bill("12000000", 4864.64),
  bill("30000001", -4250),
  bill("30000032", -614.64),
  { txn_date: "2026-07-14", post_module: "SET", post_key: "1001", glid: "20500010", lines: 1, net_amount: -900 },
]);
const k3 = await keys(ORG_A);
ok("the abandoned account row and the vanished SETV posting are removed",
  second.rows[0].stale_removed === 2 && k3.length === 4, JSON.stringify(k3));
ok("  the re-posted account is there", k3.some((r) => r.glid === "30000032"));
ok("  and the old one is not", !k3.some((r) => r.glid === "30000031"));
ok("  and no SETV row survives", !k3.some((r) => r.post_module === "SETV"));

// ── 4. a row outside the month is refused ────────────────────────────────────────────────────
const outside = await replace(ORG_A, [
  bill("12000000", 4864.64),
  { txn_date: "2026-08-02", post_module: "BILL", post_key: "2002", glid: "12000000", lines: 1, net_amount: 999 },
]);
ok("a row dated outside the month is not written",
  outside.rows[0].upserted === 1 && !(await keys(ORG_A)).some((r) => r.post_key === "2002"));

// ── 5. the company is part of the identity ───────────────────────────────────────────────────
await replace(ORG_A, [bill("12000000", 7)], "TMS2");
const tms = await keys(ORG_A, "TMS");
const tms2 = await keys(ORG_A, "TMS2");
ok("a second company's posting with the same key is its own row",
  tms.length === 1 && tms2.length === 1 && tms[0].net_amount === "4864.64" && tms2[0].net_amount === "7.00",
  JSON.stringify({ tms, tms2 }));

// ── 6. tenant scope is the argument ──────────────────────────────────────────────────────────
await replace(ORG_B, [bill("12000000", 42)]);
await replace(ORG_A, [bill("12000000", 1)]);
ok("another org's July is untouched by a sweep of this one", (await keys(ORG_B)).length === 1);

// ── 7. no client can call it ─────────────────────────────────────────────────────────────────
const can = async (role) =>
  (await db.query(`select has_function_privilege($1, 'public.replace_mcleod_gl_key_lines(uuid, text, date, date, jsonb)', 'execute') as ok`, [role])).rows[0].ok;
ok("anon and authenticated cannot execute it", !(await can("anon")) && !(await can("authenticated")));
ok("  and the service role can", await can("service_role"));

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
