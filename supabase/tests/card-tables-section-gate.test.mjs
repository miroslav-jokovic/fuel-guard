// Silvicom 360 — the EFS card and statement tables are read by the roles that hold the fuel section, and never
// by a driver (migration 0486, EFS security audit 2026-10-15, finding 1).
//
// What can be wrong is that "scoped" quietly means "scoped to the organisation":
//
//   · THE OLD POLICIES WERE ORGANISATION-ONLY AND THE CROSS-TENANT MATRICES PASSED ON THEM. Every case below
//     puts the reader and the rows in ONE organisation and varies only the role and the section, on each of
//     the four tables, so a table left out of the migration fails by name.
//   · THE EXPECTED ANSWER IS DERIVED. USER_ROLES and rolesThatCanView("fuel") come from the shared build, so a
//     role added to SECTION_ACCESS is covered and a list that drifted fails here.
//   · A DRIVER IS REFUSED EVEN WITH A FUEL GRANT. Unlike the ledger (0417) these tables hold no row of a
//     driver's own; a grant in the token must not open the fleet's card numbers.
//   · A SECURITY INVOKER RPC INHERITS THE POLICY. `efs_transaction_facets` and `decline_facets` are what the
//     Fuel Log calls with the user's token; they are called as a refused and an allowed role.
//   · THE SERVICE ROLE IS UNTOUCHED. Every API reader bypasses row-level security.
//
// Run:  node supabase/tests/card-tables-section-gate.test.mjs   (needs packages/shared/dist: build:rn)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { USER_ROLES, rolesThatCanView } from "../../packages/shared/dist/index.js";
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
const all = async (q, p = []) => (await db.query(q, p)).rows;
const throws = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.message; }
};

// The platform's default privileges, as `select * from pg_default_acl` shows them on production —
// functions included, which is the half the other matrices leave out.
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
  create schema if not exists extensions; create schema if not exists partman;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}



await db.exec(`grant usage on schema storage to anon, authenticated, service_role;
               grant all on storage.objects, storage.buckets to anon, authenticated, service_role`);


await db.exec(`grant usage on schema storage to anon, authenticated, service_role`);
const uid = () => crypto.randomUUID();
const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;
const DU1 = uid();
await db.query(`insert into auth.users (id, email) values ($1, 'd1@x.test')`, [DU1]);
await db.query(`insert into drivers (org_id, full_name, user_id) values ($1,'Driver One',$2)`, [ORG_A, DU1]);

// Two rows in A, one in B, on each table. The card numbers are the synthetic fixture range (.gitleaks.toml).
const PAN = (n) => `70830500990000000${n}`;
const seed = async (org, n) => {
  const imp = (await one(`insert into imports (org_id, source, kind, filename) values ($1,'efs_feed','transaction','gate.csv') returning id`, [org])).id;
  await db.query(`insert into fuel_cards (org_id, card_ref) values ($1,$2)`, [org, PAN(n)]);
  await db.query(`insert into efs_transactions (org_id, card_num, tran_date, state, unit) values ($1,$2,'2026-10-01','TX',$3)`, [org, PAN(n), `U${n}`]);
  await db.query(`insert into declined_transactions (org_id, card_ref, declined_at, state, unit) values ($1,$2,'2026-10-01T12:00:00Z','TX',$3)`, [org, PAN(n), `U${n}`]);
  await db.query(`insert into efs_processing_runs (org_id, import_id, feed) values ($1,$2,'posted')`, [org, imp]);
};
await seed(ORG_A, 11); await seed(ORG_A, 12); await seed(ORG_B, 21);
const IN_A = 2;
const TABLES = ["fuel_cards", "efs_transactions", "declined_transactions", "efs_processing_runs"];

const as = async (claims, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: r.rows };
  } catch (e) { await db.exec("rollback"); return { error: e.message }; }
};
const claimsFor = (role, extra = {}) => ({ org_id: ORG_A, user_role: role, sub: uid(), ...extra });
const seen = async (c, table) => {
  const r = await as(c, `select count(*)::int n, count(*) filter (where org_id <> $1)::int foreign_rows from ${table}`, [ORG_A]);
  return r.error ? { error: r.error } : r.rows[0];
};

for (const t of TABLES) {
  const probe = await seen(claimsFor("admin"), t);
  ok(`the harness can read ${t} as an authenticated admin (a fixture error is not a denial)`,
    probe.error === undefined && probe.n === IN_A, JSON.stringify(probe));
}

const view = new Set(rolesThatCanView("fuel"));
ok("the shared matrix is read, not empty", view.size >= 4 && USER_ROLES.length >= 9, `${[...view]}`);

// ── Every role, derived, on every table ─────────────────────────────────────────────────────────
for (const t of TABLES) {
  for (const role of USER_ROLES.filter((r) => r !== "driver")) {
    const r = await seen(claimsFor(role), t);
    const want = view.has(role) ? IN_A : 0;
    ok(`${role} (fuel ${view.has(role) ? "view or more" : "none"}) reads ${want === 0 ? "no" : "the organisation's"} ${t} rows, and never another organisation's`,
      r.n === want && r.foreign_rows === 0, JSON.stringify(r));
  }
}

// ── The driver, the override, the admin ─────────────────────────────────────────────────────────
for (const t of TABLES) {
  ok(`a driver reads no ${t} rows`, (await seen(claimsFor("driver", { sub: DU1 }), t)).n === 0);
  ok(`a driver carrying a fuel manage grant still reads no ${t} rows`,
    (await seen(claimsFor("driver", { sub: DU1, sections: { fuel: "manage" } }), t)).n === 0);
  ok(`a dispatcher whose org revoked fuel reads no ${t} rows`,
    (await seen(claimsFor("dispatcher", { sections: { fuel: "none" } }), t)).n === 0);
  ok(`a technician granted fuel view reads the organisation's ${t} rows`,
    (await seen(claimsFor("technician", { sections: { fuel: "view" } }), t)).n === IN_A);
  ok(`the admin cannot be narrowed on ${t} (D-PERM7)`,
    (await seen(claimsFor("admin", { sections: { fuel: "none" } }), t)).n === IN_A);
}

// ── The invoker RPCs the Fuel Log calls inherit it ──────────────────────────────────────────────
// Both answer `(facet, value, label)` menus — states and units, not card numbers — so the measure is
// whether the organisation's units come back at all.
for (const fn of ["efs_transaction_facets", "decline_facets"]) {
  const units = async (c) => {
    const r = await as(c, `select value from ${fn}() where facet = 'unit' order by value`);
    return r.error ? { error: r.error } : r.rows.map((x) => x.value).join();
  };
  const allowed = await units(claimsFor("dispatcher"));
  const denied = await units(claimsFor("technician"));
  ok(`${fn} gives a fuel viewer the organisation's units, and no other organisation's (not vacuous)`, allowed === "U11,U12", JSON.stringify(allowed));
  ok(`${fn} gives a technician no menu at all`, denied === "", JSON.stringify(denied));
}

// ── The service role, which every API reader uses, is unaffected ────────────────────────────────
for (const t of TABLES) {
  await db.exec("begin");
  await db.exec("set local role service_role");
  const n = (await one(`select count(*)::int n from ${t}`)).n;
  await db.exec("rollback");
  ok(`the service role still reads every ${t} row`, n === IN_A + 1, String(n));
}

// ── Shape ───────────────────────────────────────────────────────────────────────────────────────
for (const t of TABLES) {
  const pols = await all(`select policyname, permissive from pg_policies where schemaname='public' and tablename=$1 and cmd='SELECT' order by 1`, [t]);
  ok(`${t} carries exactly one RESTRICTIVE *_section_read select policy`,
    pols.filter((p) => p.permissive === "RESTRICTIVE" && p.policyname.endsWith("_section_read")).length === 1, JSON.stringify(pols));
  ok(`${t} has exactly one PERMISSIVE select policy (a second would OR the gate open)`,
    pols.filter((p) => p.permissive === "PERMISSIVE").length === 1, JSON.stringify(pols));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
