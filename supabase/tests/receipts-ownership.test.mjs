// Silvicom 360 — receipts belong to the people who own them (migration 0415, database audit 2026-10-03,
// finding 2).
//
// What can be wrong is that "scoped" quietly means "scoped to the organisation":
//
//   · THE OLD RULES WERE ORGANISATION-ONLY AND LOOKED FINE. 0005's three policies match the bucket and the
//     first path segment; the cross-tenant matrices pass on them because another organisation IS refused.
//     Nothing in `rls.test.mjs` can see a driver reading another driver's receipt, because the two share
//     an organisation. Every case below puts both people in ONE.
//   · THE EXPECTED ANSWER IS DERIVED, NOT TYPED. The policy lists roles inline (the `section-policy`
//     gate cannot map `storage.objects` to a section, so 0415 carries waivers). This matrix therefore reads
//     USER_ROLES, rolesThatCanView("fuel") and rolesThatManage("fuel") from the shared build and asserts
//     the policy's answer for EVERY role, so a role added to SECTION_ACCESS later is covered here and a
//     list that drifted from it fails here.
//   · DELETE IS EVIDENCE. A driver deleting their OWN receipt is asserted refused as well as another
//     driver's: the person being checked must not be able to erase the proof.
//   · THE OVERRIDE REACHES THE POLICY. An org that revokes fuel from a role it normally has, or grants it
//     to one it does not, is asserted both ways, and a driver is asserted unmoved by any grant (D-PERM7).
//
// Run:  node supabase/tests/receipts-ownership.test.mjs   (needs packages/shared/dist: build:rn)
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

const uid = () => crypto.randomUUID();
const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;
const DU1 = uid(), DU2 = uid(), FMU = uid(), OTHERU = uid();
for (const [id, e] of [[DU1, "d1@x.test"], [DU2, "d2@x.test"], [FMU, "fm@x.test"], [OTHERU, "o@x.test"]])
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, e]);
const D1 = (await one(`insert into drivers (org_id, full_name, user_id) values ($1,'Driver One',$2) returning id`, [ORG_A, DU1])).id;
const D2 = (await one(`insert into drivers (org_id, full_name, user_id) values ($1,'Driver Two',$2) returning id`, [ORG_A, DU2])).id;
const veh = async (org, unit, drv) => (await one(
  `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal, assigned_driver_id) values ($1,$2,'diesel',100,$3) returning id`,
  [org, unit, drv])).id;
const V1 = await veh(ORG_A, "R-1", D1), V2 = await veh(ORG_A, "R-2", D2), V3 = await veh(ORG_A, "R-3", null);
const VB = await veh(ORG_B, "R-B", null);
// Driver one is ON DUTY with a truck that is not assigned to them. `vehicles_driver_scope` lets a driver see
// the vehicle they are currently on, so row-level security alone would admit an upload into its folder; the
// receipts rule is assigned-only, the same as `ftxn_driver_insert` beside it.
const V4 = await veh(ORG_A, "R-4", null);
const SESS = (await one(`insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(), $1, $2) returning id`, [ORG_A, D1])).id;
await db.query(`insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values (gen_random_uuid(), $1, $2, $3)`, [ORG_A, SESS, V4]);
const obj = (name, owner) => db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('receipts', $1, $2)`, [name, owner]);
await obj(`${ORG_A}/${V1}/o1.webp`, DU1);   // uploaded by driver one
await obj(`${ORG_A}/${V2}/o2.webp`, DU2);   // uploaded by driver two
await obj(`${ORG_A}/${V1}/o3.webp`, FMU);   // uploaded by an office user
await obj(`${ORG_A}/${V3}/o4.webp`, null);  // written by the API: no owner recorded
await obj(`${ORG_B}/${VB}/oB.webp`, OTHERU); // another organisation
const IN_A = 4;

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
const readable = async (c) => (await as(c, `select name from storage.objects where bucket_id = 'receipts' order by name`)).rows?.map((r) => r.name) ?? null;
const insertAs = async (c, path) => (await as(c, `insert into storage.objects (bucket_id, name, owner_id) values ('receipts', $1, $2)`, [path, c.sub])).error ?? null;
const deleteAs = async (c, like) => (await as(c, `delete from storage.objects where bucket_id = 'receipts' and name like $1 returning name`, [like])).rows?.length ?? -1;

// A harness error must not read as "the policy refused": `readable` returns null on an error, and the
// first case below fails loudly on that. This probe states the precondition where a reader will look.
const probe = await as(claimsFor("admin"), `select count(*)::int n from storage.objects where bucket_id = 'receipts'`);
ok("the harness can read storage.objects as an authenticated role (a fixture error is not a denial)",
  probe.error === undefined && probe.rows?.[0]?.n >= 0, String(probe.error));
const view = new Set(rolesThatCanView("fuel")), manage = new Set(rolesThatManage("fuel"));
ok("the shared matrix is read, not empty (view and manage sets are non-trivial)",
  view.size >= 4 && manage.size >= 2 && manage.size < view.size && USER_ROLES.length >= 9, `${[...view]} | ${[...manage]}`);

// ── READ: every role, derived ───────────────────────────────────────────────────────────────────
for (const role of USER_ROLES.filter((r) => r !== "driver")) {
  const seen = await readable(claimsFor(role));
  const want = view.has(role) ? IN_A : 0;
  ok(`${role} reads ${want === 0 ? "no" : "all"} of the organisation's receipts (fuel ${manage.has(role) ? "manage" : view.has(role) ? "view" : "none"})`,
    seen?.length === want && !seen.some((n) => n.startsWith(ORG_B)), JSON.stringify(seen));
}
ok("a driver with a fuel manage grant is still no manager (D-PERM7: a driver's section is locked)",
  (await readable({ ...claimsFor("driver", { sub: DU1 }), sections: { fuel: "manage" } }))?.length === 1);

// ── READ: a driver reads only what they uploaded ────────────────────────────────────────────────
const r1 = await readable(claimsFor("driver", { sub: DU1 }));
const r2 = await readable(claimsFor("driver", { sub: DU2 }));
ok("driver one reads exactly their own receipt", r1?.length === 1 && r1[0].endsWith("o1.webp"), JSON.stringify(r1));
ok("driver two reads exactly their own receipt — not driver one's, not the API-written one", r2?.length === 1 && r2[0].endsWith("o2.webp"), JSON.stringify(r2));
ok("a driver with no uploads reads nothing", (await readable(claimsFor("driver", { sub: uid() })))?.length === 0);

// ── READ: the organisation's override reaches the policy ────────────────────────────────────────
ok("a role that normally views fuel, revoked, reads nothing",
  (await readable(claimsFor("dispatcher", { sections: { fuel: "none" } })))?.length === 0);
ok("a role outside the fuel section, granted view, reads the receipts",
  (await readable(claimsFor("technician", { sections: { fuel: "view" } })))?.length === IN_A);
ok("admin cannot be narrowed (D-PERM7)", (await readable(claimsFor("admin", { sections: { fuel: "none" } })))?.length === IN_A);

// ── INSERT ──────────────────────────────────────────────────────────────────────────────────────
for (const role of USER_ROLES.filter((r) => r !== "driver")) {
  const e = await insertAs(claimsFor(role), `${ORG_A}/${V3}/new-${role}.webp`);
  ok(`${role} ${manage.has(role) ? "may" : "may not"} upload a receipt`, manage.has(role) ? e === null : /row-level security/i.test(e ?? ""), String(e));
}
ok("a view-only role granted manage may upload", (await insertAs(claimsFor("dispatcher", { sections: { fuel: "manage" } }), `${ORG_A}/${V3}/g.webp`)) === null);
ok("a manager revoked to view may not upload",
  /row-level security/i.test((await insertAs(claimsFor("fleet_manager", { sections: { fuel: "view" } }), `${ORG_A}/${V3}/g.webp`)) ?? ""));
const dc = (u) => claimsFor("driver", { sub: u });
ok("a driver may upload into the folder of the vehicle assigned to them", (await insertAs(dc(DU1), `${ORG_A}/${V1}/d1.webp`)) === null);
ok("a driver may not upload into another driver's vehicle folder", /row-level security/i.test((await insertAs(dc(DU1), `${ORG_A}/${V2}/d1.webp`)) ?? ""));
ok("a driver may not upload into an unassigned vehicle folder", /row-level security/i.test((await insertAs(dc(DU1), `${ORG_A}/${V3}/d1.webp`)) ?? ""));
const seesV4 = await as(dc(DU1), `select count(*)::int n from vehicles where id = $1`, [V4]);
ok("PRECONDITION: driver one can SEE the vehicle they are on duty with (so the assigned-only clause is what refuses)",
  seesV4.rows?.[0]?.n === 1, JSON.stringify(seesV4));
ok("a driver on duty with an unassigned vehicle may not upload into its folder (assigned-only, as ftxn_driver_insert)",
  /row-level security/i.test((await insertAs(dc(DU1), `${ORG_A}/${V4}/d1.webp`)) ?? ""));
ok("a driver may not name a folder that is not a vehicle", /row-level security/i.test((await insertAs(dc(DU1), `${ORG_A}/not-a-uuid/d1.webp`)) ?? ""));
ok("nobody may upload under another organisation's prefix",
  /row-level security/i.test((await insertAs(claimsFor("fleet_manager"), `${ORG_B}/${VB}/x.webp`)) ?? ""));

// ── DELETE: managers only, never a driver, never across organisations ───────────────────────────
for (const role of USER_ROLES.filter((r) => r !== "driver")) {
  const n = await deleteAs(claimsFor(role), `${ORG_A}/%/o3.webp`);
  ok(`${role} ${manage.has(role) ? "may" : "may not"} delete a receipt`, n === (manage.has(role) ? 1 : 0), String(n));
}
ok("a driver cannot delete their OWN receipt (evidence)", (await deleteAs(dc(DU1), `${ORG_A}/%/o1.webp`)) === 0);
ok("a driver cannot delete another driver's receipt", (await deleteAs(dc(DU1), `${ORG_A}/%/o2.webp`)) === 0);
ok("a driver with a fuel manage grant still cannot delete (D-PERM7)",
  (await deleteAs({ ...dc(DU1), sections: { fuel: "manage" } }, `${ORG_A}/%/o1.webp`)) === 0);
ok("a manager of one organisation cannot delete another's receipt", (await deleteAs(claimsFor("fleet_manager"), `${ORG_B}/%`)) === 0);
// `DELETE … WHERE … RETURNING` also has to pass the SELECT policy, which hides other organisations' rows, so
// every filtered case above would pass even with no org prefix on the DELETE policy. An UNFILTERED delete
// consults only the DELETE policy.
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claimsFor("fleet_manager"))]);
await db.exec("delete from storage.objects where false or true");
await db.exec("reset role");
const survivorB = Number((await one(`select count(*)::int n from storage.objects where bucket_id = 'receipts' and name like $1`, [`${ORG_B}/%`])).n);
const survivorA = Number((await one(`select count(*)::int n from storage.objects where bucket_id = 'receipts' and name like $1`, [`${ORG_A}/%`])).n);
await db.exec("rollback");
ok("an UNFILTERED delete by a manager removes their own organisation's receipts and none of another's",
  survivorB === 1 && survivorA === 0, `B left ${survivorB}, A left ${survivorA}`);
ok("the refused deletes removed nothing", Number((await one(`select count(*)::int n from storage.objects where bucket_id = 'receipts'`)).n) === IN_A + 1);

// ── Shape ───────────────────────────────────────────────────────────────────────────────────────
const pols = (await all(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'receipts%' order by 1`)).map((r) => r.policyname);
ok("exactly three receipts policies exist (no older permissive twin ORs the new rules open)",
  JSON.stringify(pols) === JSON.stringify(["receipts_delete", "receipts_insert", "receipts_read"]), JSON.stringify(pols));
const bk = await one(`select file_size_limit::bigint lim, allowed_mime_types mt from storage.buckets where id = 'receipts'`);
ok("the bucket is capped at 10 MiB", Number(bk.lim) === 10485760, JSON.stringify(bk));
ok("the bucket accepts only WebP, JPEG and PNG",
  JSON.stringify([...(bk.mt ?? [])].sort()) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]), JSON.stringify(bk));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
