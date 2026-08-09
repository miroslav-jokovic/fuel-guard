// FuelGuard — HazmatGuard RLS matrix (plan H4). Self-contained: applies migration 0092 into an
// in-process PGlite (WASM Postgres) with light shims for the Supabase-managed auth/storage schemas +
// the RLS helper functions, then asserts the access matrix AS A NON-PRIVILEGED ROLE (the only way RLS
// is actually enforced — the service role bypasses it). Complements the same-shape supabase/tests/
// rls.test.mjs; kept separate + self-contained so it does not depend on the full migration chain.
//
// Run:  node supabase/tests/hazmat_rls.test.mjs      (requires @electric-sql/pglite)

import { PGlite } from "@electric-sql/pglite";
import { assertTenantIsolation } from "./lib/tenantIsolation.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, "..", rel), "utf8");

const ORG_A = "00000000-0000-0000-0000-0000000000a1";
const ORG_B = "00000000-0000-0000-0000-0000000000b2";
const U1 = "00000000-0000-0000-0000-0000000000c1"; // owns load 1
const U2 = "00000000-0000-0000-0000-0000000000c2"; // owns load 2 / a manager
const LOAD1 = "10000000-0000-0000-0000-000000000001";
const LOAD2 = "10000000-0000-0000-0000-000000000002";
const RUN1 = "20000000-0000-0000-0000-000000000001";
const TRAILER_FOR_TANK = "30000000-0000-0000-0000-000000000001";

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

const db = new PGlite();

/** Run a query as a non-privileged app_user with the given JWT claims, in a rolled-back txn. */
async function asUser(claims, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

async function main() {
  // Supabase-managed objects + RLS helpers (shimmed to match the real bodies).
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(t text) returns text[] language sql immutable as $fn$ select string_to_array(t, '/') $fn$;
    create role app_user nologin;
    create function auth_org_id()  returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid $fn$;
    create function auth_role()    returns text language sql stable as $fn$ select current_setting('request.jwt.claims', true)::jsonb ->> 'user_role' $fn$;
    create function auth_user_id() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $fn$;
    create function set_updated_at() returns trigger language plpgsql as $fn$ begin new.updated_at = now(); return new; end $fn$;
    -- FK targets (only the columns 0092 references).
    create table organizations (id uuid primary key default gen_random_uuid());
    create table vehicles (id uuid primary key default gen_random_uuid());
    create table drivers (id uuid primary key default gen_random_uuid());
    create table trailers (id uuid primary key default gen_random_uuid());
  `);

  // The real hazmat schema + RLS under test.
  await db.exec(read("migrations/0092_hazmat_core.sql"));
  // 0161 repairs hazmat_loads_driver_update (its WITH CHECK dropped org_id and status, so a driver
  // could self-clear a load or move it to another tenant) and makes org_id immutable everywhere.
  // Applied here because these assertions are the regression test for it.
  await db.exec(read("migrations/0161_hazmat_draft_and_org_immutability.sql"));

  await db.exec(`
    grant usage on schema public, storage to app_user;
    grant all on all tables in schema public to app_user;
    grant all on all tables in schema storage to app_user;
  `);

  // Seed (as the privileged default role — RLS bypassed for setup).
  await db.exec(`
    insert into organizations (id) values ('${ORG_A}'), ('${ORG_B}');
    insert into auth.users (id) values ('${U1}'), ('${U2}');
    insert into hazmat_policies (org_id, policy) values ('${ORG_A}', '{"driversMayCreateLoads": false}');
    insert into hazmat_loads (id, org_id, status, created_by) values
      ('${LOAD1}', '${ORG_A}', 'draft', '${U1}'),
      ('${LOAD2}', '${ORG_A}', 'draft', '${U2}');
    insert into hazmat_runs (id, org_id, load_id, engine_version, dataset_version, verdict, outcome, input_hash)
      values ('${RUN1}', '${ORG_A}', '${LOAD1}', '0.6.0', '2026.07.1', '{}', 'green', 'h1');
  `);

  const admin = { org_id: ORG_A, user_role: "admin", sub: U2 };
  const disp = { org_id: ORG_A, user_role: "dispatcher", sub: U2 };
  const safety = { org_id: ORG_A, user_role: "safety_manager", sub: U2 };
  const driver = { org_id: ORG_A, user_role: "driver", sub: U1 };
  const adminB = { org_id: ORG_B, user_role: "admin", sub: U2 };
  const n = (r) => r.rows?.[0]?.n;

  console.log("\n-- HazmatGuard RLS matrix (0092 + 0161) --");

  // Loads: driver create gated on driversMayCreateLoads
  ok(
    "driver create load DENIED (driversMayCreateLoads=false)",
    !!(
      await asUser(
        driver,
        `insert into hazmat_loads (id,org_id,status,created_by) values (gen_random_uuid(),'${ORG_A}','draft','${U1}')`,
      )
    ).error,
  );
  await db.exec(
    `update hazmat_policies set policy='{"driversMayCreateLoads": true}' where org_id='${ORG_A}'`,
  );
  ok(
    "driver create OWN load ALLOWED (policy on)",
    (
      await asUser(
        driver,
        `insert into hazmat_loads (id,org_id,status,created_by) values (gen_random_uuid(),'${ORG_A}','draft','${U1}') returning id`,
      )
    ).rows?.length === 1,
  );
  ok(
    "driver create load for ANOTHER user DENIED",
    !!(
      await asUser(
        driver,
        `insert into hazmat_loads (id,org_id,status,created_by) values (gen_random_uuid(),'${ORG_A}','draft','${U2}')`,
      )
    ).error,
  );

  // Loads: read scoping
  ok(
    "driver sees ONLY own loads (1)",
    n(await asUser(driver, "select count(*)::int n from hazmat_loads")) === 1,
  );
  ok(
    "admin sees all org loads (2)",
    n(await asUser(admin, "select count(*)::int n from hazmat_loads")) === 2,
  );
  ok(
    "cross-org isolation: org B sees 0 org A loads",
    n(await asUser(adminB, "select count(*)::int n from hazmat_loads")) === 0,
  );

  // Loads: UPDATE. 0092 shipped SELECT and INSERT assertions and no UPDATE ones at all, which is why
  // the WITH CHECK defect below survived from 0092 to the 2026-08-09 audit. A driver may edit their
  // OWN DRAFT and it must still be their own draft afterwards.
  //
  // Note on the two shapes: a USING failure filters the row out (0 rows affected); a WITH CHECK or
  // trigger failure RAISES. Both are asserted explicitly so a policy that starts silently matching
  // nothing cannot be mistaken for one that is correctly refusing.
  ok(
    "driver CAN edit own draft (1 row)",
    (
      await asUser(
        driver,
        `update hazmat_loads set claimed_no_placards=true where id='${LOAD1}' returning id`,
      )
    ).rows?.length === 1,
  );
  ok(
    "driver CANNOT self-clear their draft — the hazmat_reviews separation of duties holds",
    !!(await asUser(driver, `update hazmat_loads set status='cleared' where id='${LOAD1}'`)).error,
  );
  ok(
    "driver CANNOT move their draft into another tenant",
    !!(await asUser(driver, `update hazmat_loads set org_id='${ORG_B}' where id='${LOAD1}'`)).error,
  );
  ok(
    "driver CANNOT reassign their draft to another user",
    !!(await asUser(driver, `update hazmat_loads set created_by='${U2}' where id='${LOAD1}'`))
      .error,
  );
  ok(
    "driver CANNOT edit somebody else's load (0 rows — filtered by USING)",
    (
      await asUser(
        driver,
        `update hazmat_loads set claimed_no_placards=true where id='${LOAD2}' returning id`,
      )
    ).rows?.length === 0,
  );
  ok(
    "manager CAN still clear a load (the legitimate path is unaffected)",
    (
      await asUser(
        admin,
        `update hazmat_loads set status='cleared' where id='${LOAD1}' returning id`,
      )
    ).rows?.length === 1,
  );
  ok(
    "not even a manager may move a load between tenants (org_id immutability, 0161)",
    !!(await asUser(admin, `update hazmat_loads set org_id='${ORG_B}' where id='${LOAD2}'`)).error,
  );

  // Reviews: separation of duties + reviewer identity + immutability
  ok(
    "dispatcher CANNOT read reviews (0)",
    n(await asUser(disp, "select count(*)::int n from hazmat_reviews")) === 0,
  );
  ok(
    "safety_manager insert review ALLOWED (own reviewer_id)",
    (
      await asUser(
        safety,
        `insert into hazmat_reviews (org_id,load_id,run_id,reviewer_id,action) values ('${ORG_A}','${LOAD1}','${RUN1}','${U2}','cleared') returning id`,
      )
    ).rows?.length === 1,
  );
  ok(
    "insert review as ANOTHER reviewer DENIED",
    !!(
      await asUser(
        safety,
        `insert into hazmat_reviews (org_id,load_id,run_id,reviewer_id,action) values ('${ORG_A}','${LOAD1}','${RUN1}','${U1}','cleared')`,
      )
    ).error,
  );

  // Runs: service-role write only + members read + immutable
  ok(
    "member insert run DENIED (service-role writer only)",
    !!(
      await asUser(
        admin,
        `insert into hazmat_runs (org_id,load_id,engine_version,dataset_version,verdict,outcome,input_hash) values ('${ORG_A}','${LOAD1}','0.6.0','2026.07.1','{}','green','h2')`,
      )
    ).error,
  );
  ok(
    "member CAN read runs (1)",
    n(await asUser(admin, "select count(*)::int n from hazmat_runs")) === 1,
  );
  ok(
    "runs are IMMUTABLE (update touches 0 rows)",
    (await asUser(admin, "update hazmat_runs set outcome='flagged' returning id")).rows?.length ===
      0,
  );

  // Policies: admin-only write
  ok(
    "dispatcher policy update DENIED (0 rows)",
    (await asUser(disp, "update hazmat_policies set policy='{}' returning org_id")).rows?.length ===
      0,
  );
  ok(
    "admin policy update ALLOWED (1 row)",
    (await asUser(admin, "update hazmat_policies set policy='{}' returning org_id")).rows
      ?.length === 1,
  );

  // Storage: org-folder + own-load scoping (insert-only)
  // NOTE: the hazmat bucket is insert-only (no SELECT policy by design), so INSERT ... RETURNING would
  // fail its implicit read-back even for an authorized writer. The real client uses createSignedUploadUrl,
  // never PostgREST RETURNING, so we assert the bare insert (no RETURNING).
  ok(
    "driver storage insert into OWN load folder ALLOWED",
    !(
      await asUser(
        driver,
        `insert into storage.objects (bucket_id,name) values ('hazmat','${ORG_A}/${LOAD1}/doc.webp')`,
      )
    ).error,
  );
  ok(
    "driver storage insert into ANOTHER org folder DENIED",
    !!(
      await asUser(
        driver,
        `insert into storage.objects (bucket_id,name) values ('hazmat','${ORG_B}/${LOAD1}/doc.webp')`,
      )
    ).error,
  );

  // Same machine-readable line as the other three matrices. scripts/run-tests.mjs treats a matrix
  // that emits no RESULT line as a FAILURE, so this format is a contract, not decoration: it is how
  // "the matrix did not execute" is told apart from "the matrix passed".
  // Same table-driven cross-tenant sweep the main matrix runs (Stage 2.2). The hazmat tables live
  // only in this harness — 0092 is not in the other matrix's migration list — so without this call
  // the entire HazmatGuard schema would sit outside the one check that cannot be forgotten.
  const iso = await assertTenantIsolation({
    db,
    asUser,
    ok,
    orgA: ORG_A,
    orgB: ORG_B,
    viewer: { org_id: ORG_A, user_role: "admin", sub: U2 },
    handSeed: {
      // `check (num_nonnulls(trailer_id, vehicle_id) = 1)` — a two-column invariant the generic
      // synthesiser cannot satisfy, since it fills each column independently. (0153 drops this table
      // in production; it survives here because this harness stops at 0092 + 0161.)
      hazmat_cargo_tank_profiles: (org) => `
        insert into trailers (id) values ('${TRAILER_FOR_TANK}') on conflict do nothing;
        insert into hazmat_cargo_tank_profiles (org_id, trailer_id)
        values ('${org}', '${TRAILER_FOR_TANK}')`,
    },
  });
  console.log(
    `\n[tenant isolation] ${iso.covered} tables covered, ${iso.exempt} exempt, ${iso.unseedable.length} unseedable, ${iso.leaked} leaking`,
  );
  for (const [t, why] of iso.unseedable) console.log(`   UNSEEDABLE ${t}: ${why}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
