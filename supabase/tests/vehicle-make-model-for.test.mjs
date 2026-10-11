// FuelGuard — migration 0402, 0399's make/model rule as a callable function (FUEL-SAVINGS-AND-IDLE-
// ENGINE-PLAN.md FL2, D-FL1, D-FL2).
//
// Runs with Supabase's real default privileges (as rls.test.mjs does), because the defect this
// migration fixes only exists for a NON-superuser: every migration before 0402 is applied, trucks are
// seeded, an office edit is made AS `authenticated` to show 0399's behaviour, then the subject runs.
// What must hold afterwards:
//
//   1. The rule did not move: for every stored truck, the function over its VIN and REPORTED
//      make/model returns exactly the make/model the trigger stored.
//   2. McLeod's raw spellings derive to the stored names; an uncatalogued truck keeps its report.
//   3. An office edit made as `authenticated` is now derived (0399's was not) and still claims the row.
//   4. The batch form is the service role's alone: neither `authenticated` nor `anon` may call it.
//
// Run: node supabase/tests/vehicle-make-model-for.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const SUBJECT = "0402_vehicle_make_model_for.sql";
const BEFORE = ALL.filter((f) => f < SUBJECT);

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid, owner_id text,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
// Supabase's real default privileges, installed before the migrations (rls.test.mjs explains why).
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);

for (const f of BEFORE) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const truck = (unit, vin, make, model) =>
  db.query(
    `insert into vehicles (org_id, unit_number, vin, make, model, tank_capacity_gal, identity_source)
     values ($1, $2, $3, $4, $5, 200, 'mcleod')`,
    [ORG, unit, vin, make, model],
  );

await truck("506", "3AKJHHDR0LSLL7398", "FRHT", "CA");
await truck("764", "3AKJJHDR5TSAA0001", "FRHT", "PJ126");
await truck("787", "3AKJHHDR3VSXJ2106", "FRHT", "LT625");
await truck("712", "3HSDZAPR1RN000712", "INTERNATIONAL", "LT 625");
await truck("814", "3HSDZAPR4TN000814", null, null);
await truck("733 - OLD", null, "international", "LT-625");
await truck("752", null, "INTERNATIONAL", "LT62F");
await truck("751 - OLD", null, null, null);
await truck("900", "1XKYD49X0XX000900", "KENWORTH", "T680");

// The audit trigger stamps the JWT's `sub` as the actor, which references auth.users.
await db.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'office@example.com')`);
const CLAIMS = { role: "authenticated", org_id: ORG, user_role: "admin", sub: "00000000-0000-4000-8000-000000000001" };
async function as(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(role === "anon" ? { role } : CLAIMS)]);
    const res = await db.query(sql, params);
    const after = await db.query(`select * from vehicles where org_id = $1 and unit_number = '733 - OLD'`, [ORG]);
    await db.exec("rollback");
    return { rows: res.rows, truck: after.rows[0] };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}
const officeEdit = () => as("authenticated", `update vehicles set model = 'LT-625 ' where org_id = $1 and unit_number = '733 - OLD'`, [ORG]);

// ── 0399 as shipped: an office edit is not derived ──────────────────────────────────────────────
const before = await officeEdit();
ok(
  // Trimmed (the last step of the rule needs no catalogue) but never looked up: the catalogue gives LT625.
  "before 0402 an office edit as authenticated is never looked up in the catalogue (the defect)",
  before.truck?.model === "LT-625" && before.truck?.identity_source === "manual",
  JSON.stringify(before.error ?? { model: before.truck?.model, src: before.truck?.identity_source }),
);

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
await db.exec(read(join("migrations", SUBJECT)));

// ── 1. the rule did not move ────────────────────────────────────────────────────────────────────
const stored = (await db.query(`select unit_number, vin, make, model, make_reported, model_reported from vehicles where org_id = $1 order by unit_number`, [ORG])).rows;
const input = stored.map((r) => ({ key: r.unit_number, vin: r.vin, make: r.make_reported, model: r.model_reported }));
const derived = new Map((await db.query(`select * from vehicle_make_model_derive($1::jsonb)`, [JSON.stringify(input)])).rows.map((d) => [d.key, d]));
const moved = stored.filter((r) => derived.get(r.unit_number)?.make !== r.make || derived.get(r.unit_number)?.model !== r.model);
ok(`the function returns the stored make/model for all ${stored.length} trucks`, derived.size === stored.length && moved.length === 0, JSON.stringify(moved));
await db.exec(`update vehicles set make = make`);
const after = (await db.query(`select unit_number, make, model from vehicles where org_id = $1 order by unit_number`, [ORG])).rows;
ok("re-firing the rewritten trigger on every row changes nothing", JSON.stringify(after) === JSON.stringify(stored.map(({ unit_number, make, model }) => ({ unit_number, make, model }))));

// ── 2. McLeod's raw spellings ───────────────────────────────────────────────────────────────────
const mcleod = (await db.query(`select * from vehicle_make_model_derive($1::jsonb) order by key`, [
  JSON.stringify([
    { key: "a", vin: "3AKJHHDR0LSLL7398", make: "FRHT", model: "CA126SLP" },
    { key: "b", vin: null, make: "INTERNATIONAL", model: "LT-625" },
    { key: "c", vin: "3AKJHHDR3VSXJ2106", make: "FRHT", model: "LT625" },
    { key: "d", vin: "1XKYD49X0XX000900", make: " KENWORTH ", model: "T680" },
    { key: "e", vin: null, make: null, model: null },
  ]),
])).rows.map((r) => `${r.key}:${r.make}/${r.model}`);
ok(
  "McLeod spellings derive to the stored names; an uncatalogued truck keeps its report",
  JSON.stringify(mcleod) === JSON.stringify(["a:Freightliner/Cascadia", "b:International/LT625", "c:Freightliner/Cascadia", "d:KENWORTH/T680", "e:null/null"]),
  JSON.stringify(mcleod),
);
ok("an empty or null batch returns nothing", Number((await one(`select count(*) n from vehicle_make_model_derive(null)`)).n) === 0);

// ── 3. the office edit, again ───────────────────────────────────────────────────────────────────
const fixed = await officeEdit();
ok(
  "after 0402 the same office edit is derived and still claims the row",
  fixed.truck?.model === "LT625" && fixed.truck?.model_reported === "LT-625 " && fixed.truck?.identity_source === "manual",
  JSON.stringify(fixed.error ?? { model: fixed.truck?.model, src: fixed.truck?.identity_source }),
);

// ── 4. who may call it ──────────────────────────────────────────────────────────────────────────
const probe = `select * from vehicle_make_model_derive('[{"key":"x","vin":"3AKJHHDR0LSLL7398"}]'::jsonb)`;
ok("authenticated may not call the batch form", /permission denied/i.test((await as("authenticated", probe)).error ?? ""));
ok("anon may not call the batch form", /permission denied/i.test((await as("anon", probe)).error ?? ""));
ok("authenticated may not call the single form", /permission denied/i.test((await as("authenticated", `select * from vehicle_make_model_for('3AKJHHDR0LSLL7398', null, null)`)).error ?? ""));
ok("the service role may", (await as("service_role", probe)).rows?.[0]?.model === "Cascadia");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
