// Silvicom 360 — the fuel ledger is read by the roles that hold the fuel section (migration 0416, database
// audit 2026-10-03, finding 1, `fuel_transactions`).
//
// What can be wrong is that "scoped" quietly means "scoped to the organisation":
//
//   · THE OLD POLICY WAS ORGANISATION-ONLY AND THE CROSS-TENANT MATRICES PASSED ON IT. `ftxn_select` matched
//     `org_id` and nothing else; another organisation IS refused, so nothing red. Every case below puts the
//     reader and the rows in ONE organisation and varies only the role and the section.
//   · THE EXPECTED ANSWER IS DERIVED. USER_ROLES and rolesThatCanView("fuel") come from the shared build, so a
//     role added to SECTION_ACCESS is covered and a list that drifted fails here.
//   · A SECURITY INVOKER RPC INHERITS THE POLICY. `fuel_range_totals` reported the whole ledger to a role with
//     fuel `none`; the case below calls it as that role and as an allowed one, so the gate is shown to reach
//     the function the browser actually calls, not only a bare `select`.
//   · THE DRIVER BRANCH MUST NOT WIDEN. A driver passes this gate by design, and is limited to their own
//     rows by the policies already on the table; the case asserts that is STILL two rows and not the
//     organisation's five, with and without a fuel grant in the token (D-PERM7).
//   · WRITES ARE UNTOUCHED. A policy for SELECT can still break an UPDATE or DELETE ... RETURNING, which
//     must read the row to act on it; a fuel manager's update-and-return is asserted to still work.
//
// Run:  node supabase/tests/fuel-ledger-section-gate.test.mjs   (needs packages/shared/dist: build:rn)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { USER_ROLES, rolesThatCanView, rolesThatManage } from "../../packages/shared/dist/index.js";
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
const DU1 = uid(), DU2 = uid();
for (const [id, e] of [[DU1, "d1@x.test"], [DU2, "d2@x.test"]]) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, e]);
const D1 = (await one(`insert into drivers (org_id, full_name, user_id) values ($1,'Driver One',$2) returning id`, [ORG_A, DU1])).id;
const D2 = (await one(`insert into drivers (org_id, full_name, user_id) values ($1,'Driver Two',$2) returning id`, [ORG_A, DU2])).id;
const veh = async (org, unit, drv) => (await one(
  `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal, assigned_driver_id) values ($1,$2,'diesel',100,$3) returning id`, [org, unit, drv])).id;
const V1 = await veh(ORG_A, "F-1", D1), V2 = await veh(ORG_A, "F-2", D2), VB = await veh(ORG_B, "F-B", null);
const fill = (org, drv, vehId, gal) => db.query(
  `insert into fuel_transactions (org_id, driver_id, vehicle_id, fueled_at, gallons, total_cost, source) values ($1,$2,$3,'2026-09-10T12:00:00Z',$4,$5,'manual')`,
  [org, drv, vehId, gal, gal * 4]);
await fill(ORG_A, D1, V1, 10); await fill(ORG_A, D1, V1, 20);
await fill(ORG_A, D2, V2, 30); await fill(ORG_A, D2, V2, 40);
await fill(ORG_A, null, V1, 50);
await fill(ORG_B, null, VB, 99);
const IN_A = 5;

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
const seen = async (c) => {
  const r = await as(c, `select count(*)::int n, count(*) filter (where org_id <> $1)::int foreign_rows from fuel_transactions`, [ORG_A]);
  return r.error ? { error: r.error } : r.rows[0];
};

const probe = await seen(claimsFor("admin"));
ok("the harness can read fuel_transactions as an authenticated role (a fixture error is not a denial)",
  probe.error === undefined && probe.n === IN_A, JSON.stringify(probe));

const view = new Set(rolesThatCanView("fuel")), manage = new Set(rolesThatManage("fuel"));
ok("the shared matrix is read, not empty", view.size >= 4 && manage.size >= 2 && USER_ROLES.length >= 9, `${[...view]}`);

// ── Every role, derived ─────────────────────────────────────────────────────────────────────────
for (const role of USER_ROLES.filter((r) => r !== "driver")) {
  const r = await seen(claimsFor(role));
  const want = view.has(role) ? IN_A : 0;
  ok(`${role} (fuel ${manage.has(role) ? "manage" : view.has(role) ? "view" : "none"}) reads ${want === 0 ? "no" : "all five of the organisation's"} fuel rows, and never another organisation's`,
    r.n === want && r.foreign_rows === 0, JSON.stringify(r));
}

// ── The driver branch does not widen ────────────────────────────────────────────────────────────
const dr = await seen(claimsFor("driver", { sub: DU1 }));
ok("a driver still reads exactly their own two fills, not the organisation's five", dr.n === 2 && dr.foreign_rows === 0, JSON.stringify(dr));
const drGrant = await seen({ ...claimsFor("driver", { sub: DU1 }), sections: { fuel: "manage" } });
ok("a driver carrying a fuel manage grant still reads only their own two (D-PERM7)", drGrant.n === 2, JSON.stringify(drGrant));
ok("a driver with no driver record reads nothing", (await seen(claimsFor("driver", { sub: uid() }))).n === 0);

// ── The organisation's override reaches the policy ──────────────────────────────────────────────
ok("a role that normally views fuel, revoked by the org, reads nothing", (await seen(claimsFor("dispatcher", { sections: { fuel: "none" } }))).n === 0);
ok("a role outside the fuel section, granted view, reads the ledger", (await seen(claimsFor("technician", { sections: { fuel: "view" } }))).n === IN_A);
ok("the admin cannot be narrowed (D-PERM7)", (await seen(claimsFor("admin", { sections: { fuel: "none" } }))).n === IN_A);
ok("the row set follows the org: another organisation's manager reads only theirs",
  (await as({ org_id: ORG_B, user_role: "fleet_manager", sub: uid() }, `select count(*)::int n from fuel_transactions where org_id = $1`, [ORG_B])).rows?.[0]?.n === 1);

// ── The invoker RPC the browser calls inherits it ───────────────────────────────────────────────
const totals = (c) => as(c, `select to_jsonb(t) j from fuel_range_totals($1::date,$2::date,null,null,null,null,null,null,null) t`, ["2026-01-01", "2026-12-31"]);
const allowedTotals = await totals(claimsFor("fleet_manager"));
const deniedTotals = await totals(claimsFor("fleet_manager", { sections: { fuel: "none" } }));
const techTotals = await totals(claimsFor("technician"));
ok("fuel_range_totals runs for an allowed role and counts the organisation's fills (not vacuous)",
  allowedTotals.error === undefined && Number(allowedTotals.rows[0].j.fills) === IN_A, JSON.stringify(allowedTotals));
ok("fuel_range_totals reports no fills to a manager whose org revoked fuel",
  deniedTotals.error === undefined && Number(deniedTotals.rows[0]?.j.fills ?? 0) === 0, JSON.stringify(deniedTotals));
ok("fuel_range_totals reports no fills to a technician", techTotals.error === undefined && Number(techTotals.rows[0]?.j.fills ?? 0) === 0, JSON.stringify(techTotals));

// ── Writes are untouched ────────────────────────────────────────────────────────────────────────
const upd = await as(claimsFor("fleet_manager"), `update fuel_transactions set gallons = gallons where org_id = $1 returning id`, [ORG_A]);
ok("a fuel manager's UPDATE ... RETURNING still sees and returns the organisation's rows", upd.error === undefined && upd.rows.length === IN_A, JSON.stringify(upd).slice(0, 160));
const ins = await as(claimsFor("fleet_manager"), `insert into fuel_transactions (org_id, vehicle_id, fueled_at, gallons, source) values ($1,$2,now(),5,'manual') returning id`, [ORG_A, V1]);
ok("a fuel manager can still insert a fill and read it back", ins.error === undefined && ins.rows.length === 1, JSON.stringify(ins).slice(0, 160));
const insDenied = await as(claimsFor("technician"), `insert into fuel_transactions (org_id, vehicle_id, fueled_at, gallons, source) values ($1,$2,now(),5,'manual')`, [ORG_A, V1]);
ok("a technician still cannot insert (the write policies are unchanged)", /row-level security/i.test(insDenied.error ?? ""), JSON.stringify(insDenied));

// ── Shape ───────────────────────────────────────────────────────────────────────────────────────
const pols = await all(`select policyname, permissive from pg_policies where schemaname='public' and tablename='fuel_transactions' and cmd='SELECT' order by 1`);
const mine = pols.find((p) => p.policyname === "ftxn_section_read");
ok("ftxn_section_read exists and is RESTRICTIVE", mine?.permissive === "RESTRICTIVE", JSON.stringify(pols));
ok("no PERMISSIVE select policy was added beside ftxn_select (it would OR the gate open)",
  pols.filter((p) => p.permissive === "PERMISSIVE").map((p) => p.policyname).join() === "ftxn_select", JSON.stringify(pols));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
