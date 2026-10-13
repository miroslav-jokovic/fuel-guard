// Silvicom 360 — the Med-Stop collector's mirror (migration 0463, MEDSTOP-PLAN.md §6 F-1/F-2, MS1).
//
// The mirror is a SNAPSHOT of what Med-Stop said at the last sweep, replaced whole by
// `medstop_replace_snapshot`. Four failures would each quietly corrupt the pool reconciliation the
// DER reads (F-1), and none raises anything at the application layer:
//
//   1. A FAILED READ EMPTIES THE MIRROR. A sweep that fetched nothing would replace 170 employees
//      with zero, and every active driver would read "not in the random pool" — a page of false
//      §382.305 alarms. An empty snapshot must be refused, not stored.
//   2. A PERSON MED-STOP REMOVED STAYS. Row-by-row upserts keep whoever the vendor dropped; replace
//      must take them out.
//   3. ONE ORG'S SWEEP TOUCHES ANOTHER'S ROWS.
//   4. A MERGED DRIVER TAKES THE MIRROR ROW WITH IT (cascade) instead of leaving it for re-match.
//
// And the posture: RLS on, no policies — a browser reads none of it; the web goes through the API.
//
// Run:  node supabase/tests/medstop-collector.test.mjs
// Run:  node supabase/tests/fleetpal-collector.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('der@silvicom.test') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1,'Pat Driver') returning id`, [ORG])).id;

const snap = (org, kind, rows) =>
  sqlstate(`select public.medstop_replace_snapshot($1, $2, $3::jsonb)`, [org, kind, JSON.stringify(rows)]);
const count = async (t, org) => (await one(`select count(*)::int n from ${t} where org_id=$1`, [org])).n;

// ── 1. the credential ───────────────────────────────────────────────────────────────────────────
ok("a credential row exists before a key does", (await sqlstate(`insert into medstop_credentials (org_id) values ($1)`, [ORG])) === null);
const cred = await one(`select enabled, base_url, api_key_sealed from medstop_credentials where org_id=$1`, [ORG]);
ok("disabled by default — nothing polls Med-Stop because a row appeared", cred.enabled === false);
ok("with Med-Stop's documented host as the default", cred.base_url === "https://api.med-stop.com");
ok("one credential per org", (await sqlstate(`insert into medstop_credentials (org_id) values ($1)`, [ORG])) === "23505");

// ── 2. the snapshot replaces, whole ─────────────────────────────────────────────────────────────
const emp = (id, extra = {}) => ({ medstop_id: id, roster: "active", status: "FULL TIME", license_number: `L${id}`, license_state: "IL", ...extra });
ok("a snapshot of three employees stores three", (await snap(ORG, "employees", [emp("a", { driver_id: DRIVER, match_rule: "licence" }), emp("b"), emp("c")])) === null && (await count("medstop_employees", ORG)) === 3);
ok("the next sweep without 'c' removes 'c' — a person Med-Stop dropped leaves the mirror",
  (await snap(ORG, "employees", [emp("a", { driver_id: DRIVER, match_rule: "licence" }), emp("b")])) === null && (await count("medstop_employees", ORG)) === 2);
ok("an EMPTY snapshot is refused (MS001) — a failed read must not read as an empty pool", (await snap(ORG, "employees", [])) === "MS001");
ok("and the mirror is untouched by the refusal", (await count("medstop_employees", ORG)) === 2);
ok("an unknown kind is refused (MS002)", (await snap(ORG, "tests", [{ medstop_id: "x" }])) === "MS002");
ok("a roster value outside active/applicant/terminated is refused", (await snap(ORG, "employees", [emp("z", { roster: "FULL TIME" })])) === "23514");
ok("and that refusal rolled back the delete too — still two rows", (await count("medstop_employees", ORG)) === 2);

// ── 3. one org's sweep never touches another's ─────────────────────────────────────────────────
await snap(OTHER, "employees", [emp("o1"), emp("o2"), emp("o3")]);
await snap(ORG, "employees", [emp("a")]);
ok("replacing ORG's snapshot leaves OTHER's three rows", (await count("medstop_employees", OTHER)) === 3);
ok("synced_at and org_id are stamped by the function, not trusted from the payload",
  (await snap(ORG, "pools", [{ medstop_id: "p1", service: "TD", pool_year: 2026, org_id: OTHER, target_percent: 53, current_percent: 42.58 }])) === null
  && (await count("medstop_pools", ORG)) === 1 && (await count("medstop_pools", OTHER)) === 0);
ok("selections replace the same way", (await snap(ORG, "selections", [{ medstop_id: "s1", employee_medstop_id: "a", status: "OPEN" }])) === null && (await count("medstop_selections", ORG)) === 1);

// ── 4. a merged driver leaves the row for the next sweep to re-match ──────────────────────────
const CANON = (await one(`insert into drivers (org_id, full_name) values ($1,'Pat Driver') returning id`, [ORG])).id;
await snap(ORG, "employees", [emp("a", { driver_id: DRIVER, match_rule: "licence" })]);
ok("merge_driver folds a duplicate that the mirror points at without refusing",
  (await sqlstate(`select merge_driver($1,$2,$3)`, [ORG, DRIVER, CANON])) === null);
const row = await one(`select driver_id from medstop_employees where org_id=$1 and medstop_id='a'`, [ORG]);
ok("and the mirror row survives with its link nulled, for the next sweep to re-match", row && row.driver_id === null);

// ── 5. clients read and write none of it ───────────────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
for (const role of ["admin", "safety_manager"]) {
  for (const t of ["medstop_credentials", "medstop_employees", "medstop_pools", "medstop_selections"]) {
    const sel = await asClient(ORG, role, `select count(*)::int n from ${t} where org_id=$1`, [ORG]);
    ok(`${role} reads nothing from ${t} directly`, sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
  }
  const rpc = await asClient(ORG, role, `select public.medstop_replace_snapshot($1,'employees','[{"medstop_id":"x","roster":"active"}]'::jsonb)`, [ORG]);
  ok(`${role} cannot call the snapshot writer`, rpc.error === "42501", JSON.stringify(rpc));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
