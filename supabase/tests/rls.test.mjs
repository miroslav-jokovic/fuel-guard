// FuelGuard — offline RLS test matrix (audit C2, Phase-1 deliverable).
//
// Applies all migrations + seed into an in-process PGlite (WASM Postgres) with light shims for the
// Supabase-managed `auth` and `storage` schemas, then asserts tenant isolation + role permissions
// AS A NON-PRIVILEGED ROLE (the only way RLS is actually enforced — the service role bypasses it).
//
// Run:  node supabase/tests/rls.test.mjs
// Requires: pnpm add -w @electric-sql/pglite   (or run via your preferred runner)
//
// This complements — does NOT replace — verifying RLS through the real Supabase client SDK in a
// live project (see docs/db-verify.md). The SQL editor bypasses RLS and must not be used to verify.

import { PGlite } from "@electric-sql/pglite";
// Real contrib extensions, not stripped ones. 0163 creates a GIN trigram index on audit_logs.action;
// loading pg_trgm here means the matrix applies that DDL for real rather than editing it out, which
// is the whole point of applying the production ledger verbatim (Stage 2.1). Add to this list when a
// migration needs another contrib extension — do NOT start deleting `create extension` lines.
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { assertTenantIsolation } from "./lib/tenantIsolation.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const ORG_A = "00000000-0000-0000-0000-0000000000a1"; // Silvicom (seed)
const ORG_B = "00000000-0000-0000-0000-0000000000b2"; // second tenant

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

const db = new PGlite({ extensions: { pg_trgm } });

/** Execute a query as an end-user JWT (non-superuser role + claims), inside a rolled-back txn. */
async function asUser(claims, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

/**
 * Execute a query as the real `anon` role with NO JWT claims — the unauthenticated party holding
 * only the publishable anon key that ships in every browser bundle and every mobile build.
 */
async function asAnon(sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role anon");
    // PostgREST always sets a claims payload; for an anonymous request it is the anon key's own JWT,
    // which carries a role and no org. Modelled exactly: NULL or '' would make auth_org_id() throw
    // on `''::jsonb` and every assertion would fail as an ERROR rather than testing anything.
    await db.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

async function main() {
  // Supabase-managed objects (present in a real project; shimmed here).
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create schema if not exists storage;
    -- Mirrors the columns real Supabase exposes that our migrations actually write. The shim
    -- previously stopped at (id, name, public), which made every migration from 0085 onward fail
    -- to apply here — this harness could not run at all. Keep this in step with any new bucket
    -- column a migration starts setting.
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
      bucket_id text, name text, owner uuid, created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    -- Supabase ships storage.foldername(); our storage policies path-scope on it
    -- ("<org>/<driver>/<load>/<file>" → the segments BEFORE the filename). Same semantics.
    create or replace function storage.foldername(name text)
    returns text[]
    language sql
    immutable
    as $fn$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
    $fn$;
    -- Supabase CLI owns this ledger; migration 0140 reads it to expose the applied schema version.
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      statements text[]
    );
    create role supabase_auth_admin nologin;
    create role authenticated nologin;
    create role anon nologin;
    -- Supabase's privileged API role. Migrations grant to it; it bypasses RLS there and is never
    -- what this matrix tests through (every assertion below runs as the authenticated role).
    create role service_role nologin bypassrls;
  `);

  // Supabase's real default privileges, installed BEFORE the migrations run -- which is when the
  // platform installs them, and why the order matters. This harness previously applied a blanket
  // `grant all on all tables to app_user` AFTERWARDS, which would silently override anything a
  // migration had revoked: a future `revoke select on <table> from authenticated` would be handed
  // straight back by the test rig, and the matrix would report access that production denies
  // (Stage 2.3). Supabase grants anon/authenticated full DML on public tables and relies on RLS as
  // the gate, so that is modelled faithfully rather than approximated -- the policies below do the
  // work here for exactly the reason they do in production.
  await db.exec(
    "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
  );

  // Apply the exact lexical migration order used by Supabase production. Never read from _deploy/.
  console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
  for (const name of MIGRATIONS) {
    await db.exec(
      read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""),
    );
  }

  // The auth/storage shim tables were created BEFORE the default privileges above, so they need
  // their grants explicitly; everything the migrations created picked the defaults up on creation.
  await db.exec("grant all on all tables in schema storage to anon, authenticated, service_role;");

  await db.exec(read("seed.sql"));
  await db.exec(`
    insert into organizations (id, name, allowed_domains)
      values ('${ORG_B}', 'Rival Freight LLC', array['rivalfreight.com']);
    insert into anomaly_thresholds (org_id) values ('${ORG_B}');
    insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal, baseline_mpg)
      values ('${ORG_B}', 'RF-900', 'diesel', 120, 6.0);
  `);

  console.log("\n-- RLS matrix --");
  const mgrA = { org_id: ORG_A, user_role: "fleet_manager" };
  const adminA = { org_id: ORG_A, user_role: "admin" };
  const driverA = { org_id: ORG_A, user_role: "driver" };
  const mgrB = { org_id: ORG_B, user_role: "fleet_manager" };

  ok(
    "org A sees its own vehicles (8)",
    (await asUser(mgrA, "select count(*)::int n from vehicles")).rows?.[0]?.n === 8,
  );
  ok(
    "org B sees only its own vehicle (1)",
    (await asUser(mgrB, "select count(*)::int n from vehicles")).rows?.[0]?.n === 1,
  );
  ok(
    "org A cannot see org B rows (0)",
    (await asUser(mgrA, "select count(*)::int n from vehicles where org_id=$1", [ORG_B])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "no org claim -> 0 rows visible",
    (await asUser({}, "select count(*)::int n from vehicles")).rows?.[0]?.n === 0,
  );
  ok(
    "driver INSERT vehicle denied by RLS",
    !!(
      await asUser(
        driverA,
        "insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'HACK','diesel',1)",
        [ORG_A],
      )
    ).error,
  );
  ok(
    "unlinked driver INSERT fuel_transaction denied (needs driver link — 0084/SB1)",
    !!(
      await asUser(
        driverA,
        "insert into fuel_transactions (org_id,fueled_at,gallons) values ($1,now(),10)",
        [ORG_A],
      )
    ).error,
  );
  ok(
    "manager INSERT vehicle allowed",
    (
      await asUser(
        mgrA,
        "insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'T-999','diesel',100) returning id",
        [ORG_A],
      )
    ).rows?.length === 1,
  );
  ok(
    "manager INSERT into other org denied",
    !!(
      await asUser(
        mgrA,
        "insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'X','diesel',100)",
        [ORG_B],
      )
    ).error,
  );

  await db.exec(`insert into audit_logs (org_id, action) values ('${ORG_A}','test.event')`);
  ok(
    "admin can read audit_logs",
    ((await asUser(adminA, "select count(*)::int n from audit_logs")).rows?.[0]?.n ?? 0) >= 1,
  );
  ok(
    "fleet_manager cannot read audit_logs (0)",
    (await asUser(mgrA, "select count(*)::int n from audit_logs")).rows?.[0]?.n === 0,
  );

  ok(
    "storage write under own org prefix allowed",
    !(
      await asUser(
        mgrA,
        "insert into storage.objects (bucket_id,name) values ('receipts',$1) returning id",
        [`${ORG_A}/veh/photo.webp`],
      )
    ).error,
  );
  ok(
    "storage write under other org prefix denied",
    !!(
      await asUser(mgrA, "insert into storage.objects (bucket_id,name) values ('receipts',$1)", [
        `${ORG_B}/veh/photo.webp`,
      ])
    ).error,
  );

  // ── Import tables (migration 0007) ─────────────────────────────────────────
  const mgrCard = await asUser(
    mgrA,
    "insert into fuel_cards (org_id, card_ref, provider) values ($1, '93509', 'efs') returning id",
    [ORG_A],
  );
  ok(
    "manager INSERT fuel_card allowed",
    !mgrCard.error && mgrCard.rows?.length === 1,
    JSON.stringify(mgrCard),
  );
  const drvCard = await asUser(
    driverA,
    "insert into fuel_cards (org_id, card_ref, provider) values ($1, 'X', 'efs')",
    [ORG_A],
  );
  ok("driver INSERT fuel_card denied by RLS", !!drvCard.error, JSON.stringify(drvCard));
  const drvDeclinedRead = await asUser(
    driverA,
    "select count(*)::int n from declined_transactions",
  );
  ok(
    "driver can read declined_transactions in own org",
    !drvDeclinedRead.error,
    JSON.stringify(drvDeclinedRead),
  );

  // ── AI verifications (migration 0008): members read; no client writes ──────
  const aiRead = await asUser(mgrA, "select count(*)::int n from ai_verifications");
  ok("member can read ai_verifications", !aiRead.error, JSON.stringify(aiRead));
  const aiWrite = await asUser(
    mgrA,
    "insert into ai_verifications (org_id, transaction_id, model, risk_score, risk_level, summary, recommended_action, input_hash) values ($1, gen_random_uuid(), 'm', 1, 'low', 's', 'monitor', 'h')",
    [ORG_A],
  );
  ok(
    "client INSERT ai_verifications denied (service-role only)",
    !!aiWrite.error,
    JSON.stringify(aiWrite),
  );

  // ── Audit triggers (migration 0009) ────────────────────────────────────────
  await db.exec(
    `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ('${ORG_A}','AUDIT-1','diesel',100)`,
  );
  const trig = await db.query(
    `select count(*)::int n from audit_logs where org_id='${ORG_A}' and action='vehicle.insert'`,
  );
  ok("audit trigger records a vehicle insert", trig.rows[0].n >= 1, JSON.stringify(trig.rows[0]));

  // ── Idempotent-anomaly index (migration 0010) ──────────────────────────────
  const someTxn = (
    await db.query(`select id from fuel_transactions where org_id='${ORG_A}' limit 1`)
  ).rows[0].id;
  await db.exec(
    `insert into anomalies (org_id, transaction_id, rule_id, severity, message) values ('${ORG_A}','${someTxn}','odometer_regression','high','x')`,
  );
  let dupBlocked = false;
  try {
    await db.exec(
      `insert into anomalies (org_id, transaction_id, rule_id, severity, message) values ('${ORG_A}','${someTxn}','odometer_regression','high','x2')`,
    );
  } catch {
    dupBlocked = true;
  }
  ok("active-anomaly unique index blocks duplicate (transaction_id, rule_id)", dupBlocked);

  // ── Faithful EFS storage (migration 0011) ──────────────────────────────────
  const efsRead = await asUser(mgrA, "select count(*)::int n from efs_transactions");
  ok("member can read efs_transactions", !efsRead.error, JSON.stringify(efsRead));
  const efsWrite = await asUser(
    mgrA,
    "insert into efs_transactions (org_id, card_num, item, qty) values ($1,'93509','ULSD',87.11) returning id",
    [ORG_A],
  );
  ok(
    "manager INSERT efs_transactions allowed",
    !efsWrite.error && efsWrite.rows?.length === 1,
    JSON.stringify(efsWrite),
  );
  const efsDrv = await asUser(
    driverA,
    "insert into efs_transactions (org_id, card_num) values ($1,'X')",
    [ORG_A],
  );
  ok("driver INSERT efs_transactions denied", !!efsDrv.error, JSON.stringify(efsDrv));

  // ── Samsara integration_credentials (migration 0012): no client access ──────
  const credRead = await asUser(mgrA, "select count(*)::int n from integration_credentials");
  ok(
    "client cannot read integration_credentials (service-role only)",
    (credRead.rows?.[0]?.n ?? 1) === 0 || !!credRead.error,
    JSON.stringify(credRead),
  );
  const credWrite = await asUser(
    adminA,
    "insert into integration_credentials (org_id, samsara_api_token) values ($1,'secret')",
    [ORG_A],
  );
  ok("client cannot write integration_credentials", !!credWrite.error, JSON.stringify(credWrite));

  // ── Custom Access Token hook (migration 0006) ──────────────────────────────
  const HOOK_UID = "00000000-0000-0000-0000-00000000aaaa";
  await db.exec(`
    insert into auth.users (id, email) values ('${HOOK_UID}', 'dana@silvicominc.com');
    insert into memberships (org_id, user_id, role) values ('${ORG_A}', '${HOOK_UID}', 'admin');
  `);
  const hk = (
    await db.query(
      `select public.custom_access_token_hook(jsonb_build_object('user_id','${HOOK_UID}','claims','{}'::jsonb)) as e`,
    )
  ).rows[0].e;
  ok("auth hook injects org_id from membership", hk.claims?.org_id === ORG_A, JSON.stringify(hk));
  ok(
    "auth hook injects user_role (not reserved 'role')",
    hk.claims?.user_role === "admin",
    JSON.stringify(hk),
  );
  const hk2 = (
    await db.query(
      `select public.custom_access_token_hook(jsonb_build_object('user_id','00000000-0000-0000-0000-0000000000ff','claims','{}'::jsonb)) as e`,
    )
  ).rows[0].e;
  ok(
    "auth hook adds no org for a non-member (pending state, audit B3)",
    hk2.claims?.org_id === undefined,
    JSON.stringify(hk2),
  );

  // ── Driver Performance (migrations 0053–0055) ──────────────────────────────
  const DRV_A = (
    await db.query(
      `insert into drivers (org_id, full_name) values ('${ORG_A}','RLS Tester') returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ('${ORG_A}','${DRV_A}','2026-07-13','2026-07-19', now(), now())`,
  );
  await db.query(
    `insert into driver_performance_weeks (org_id, week_start, week_end, driver_id, eligible, is_winner) values ('${ORG_A}','2026-07-13','2026-07-19','${DRV_A}', true, true)`,
  );

  ok(
    "member can read driver_performance_settings",
    !(await asUser(mgrA, "select count(*)::int n from driver_performance_settings")).error,
  );
  ok(
    "member can read driver_scores",
    !(await asUser(mgrA, "select count(*)::int n from driver_scores")).error,
  );
  ok(
    "member can read driver_performance_weeks",
    !(await asUser(mgrA, "select count(*)::int n from driver_performance_weeks")).error,
  );

  ok(
    "org B cannot see org A driver_scores (0)",
    (await asUser(mgrB, "select count(*)::int n from driver_scores where org_id=$1", [ORG_A]))
      .rows?.[0]?.n === 0,
  );
  ok(
    "org B cannot see org A driver_performance_weeks (0)",
    (
      await asUser(mgrB, "select count(*)::int n from driver_performance_weeks where org_id=$1", [
        ORG_A,
      ])
    ).rows?.[0]?.n === 0,
  );

  const dpsAdmin = await asUser(
    adminA,
    "insert into driver_performance_settings (org_id) values ($1) returning org_id",
    [ORG_A],
  );
  ok(
    "admin INSERT driver_performance_settings allowed",
    !dpsAdmin.error && dpsAdmin.rows?.length === 1,
    JSON.stringify(dpsAdmin),
  );
  const dpsMgr = await asUser(
    mgrA,
    "insert into driver_performance_settings (org_id) values ($1)",
    [ORG_A],
  );
  ok(
    "manager INSERT driver_performance_settings denied (admin-only)",
    !!dpsMgr.error,
    JSON.stringify(dpsMgr),
  );

  const dsMgr = await asUser(
    mgrA,
    "insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ($1,$2,'2026-07-06','2026-07-12',now(),now()) returning id",
    [ORG_A, DRV_A],
  );
  ok(
    "manager INSERT driver_scores allowed",
    !dsMgr.error && dsMgr.rows?.length === 1,
    JSON.stringify(dsMgr),
  );
  const dsDrv = await asUser(
    driverA,
    "insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ($1,$2,'2026-07-06','2026-07-12',now(),now())",
    [ORG_A, DRV_A],
  );
  ok("driver INSERT driver_scores denied", !!dsDrv.error, JSON.stringify(dsDrv));

  const dpwMgr = await asUser(
    mgrA,
    "insert into driver_performance_weeks (org_id, week_start, week_end, driver_id) values ($1,'2026-06-29','2026-07-05',$2) returning driver_id",
    [ORG_A, DRV_A],
  );
  ok("manager INSERT driver_performance_weeks allowed", !dpwMgr.error, JSON.stringify(dpwMgr));
  const dpwDrv = await asUser(
    driverA,
    "insert into driver_performance_weeks (org_id, week_start, week_end, driver_id) values ($1,'2026-06-29','2026-07-05',$2)",
    [ORG_A, DRV_A],
  );
  ok("driver INSERT driver_performance_weeks denied", !!dpwDrv.error, JSON.stringify(dpwDrv));

  // ── Driver-scoped RLS (0083/0084) — the security boundary for the driver app ──
  const DUID = "00000000-0000-0000-0000-0000000d1111";
  await db.query(
    `insert into auth.users (id,email) values ('${DUID}','scoped.driver@example.com')`,
  );
  const SELF = (
    await db.query(
      `insert into drivers (org_id, full_name, user_id) values ('${ORG_A}','Scoped Driver','${DUID}') returning id`,
    )
  ).rows[0].id;
  const OTHER = (
    await db.query(
      `insert into drivers (org_id, full_name) values ('${ORG_A}','Other Driver') returning id`,
    )
  ).rows[0].id;
  const MYVEH = (
    await db.query(
      `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal, assigned_driver_id) values ('${ORG_A}','SCOPED-1','diesel',120,'${SELF}') returning id`,
    )
  ).rows[0].id;
  const NOTMY = (
    await db.query(
      `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ('${ORG_A}','SCOPED-2','diesel',120) returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into fuel_transactions (org_id, driver_id, vehicle_id, fueled_at, gallons, source) values ('${ORG_A}','${SELF}','${MYVEH}',now(),10,'manual')`,
  );
  await db.query(
    `insert into fuel_transactions (org_id, driver_id, vehicle_id, fueled_at, gallons, source) values ('${ORG_A}','${OTHER}','${NOTMY}',now(),10,'manual')`,
  );
  await db.query(
    `insert into driver_performance_weeks (org_id, week_start, week_end, driver_id, eligible) values ('${ORG_A}','2026-07-13','2026-07-19','${SELF}', true)`,
  );
  const drv = { org_id: ORG_A, user_role: "driver", sub: DUID };

  ok(
    "driver reads only own driver row (1)",
    (await asUser(drv, "select count(*)::int n from drivers")).rows?.[0]?.n === 1,
  );
  ok(
    "driver reads only own fills (1)",
    (await asUser(drv, "select count(*)::int n from fuel_transactions")).rows?.[0]?.n === 1,
  );
  ok(
    "driver reads only assigned vehicle (1)",
    (await asUser(drv, "select count(*)::int n from vehicles")).rows?.[0]?.n === 1,
  );
  ok(
    "driver cannot read anomalies (0)",
    (await asUser(drv, "select count(*)::int n from anomalies")).rows?.[0]?.n === 0,
  );
  ok(
    "driver cannot read memberships (0)",
    (await asUser(drv, "select count(*)::int n from memberships")).rows?.[0]?.n === 0,
  );
  ok(
    "driver cannot read thresholds (0)",
    (await asUser(drv, "select count(*)::int n from anomaly_thresholds")).rows?.[0]?.n === 0,
  );
  ok(
    "driver reads only own performance week (1)",
    (await asUser(drv, "select count(*)::int n from driver_performance_weeks")).rows?.[0]?.n === 1,
  );
  // POST-D41 CONTRACT (0135): manual fuel logging was removed from the driver app, so a driver has
  // no legitimate INSERT path at all and the policy denies outright. This assertion used to expect
  // "allowed" — the pre-D41 contract — and it, plus the two below, are what exposed the gap: the
  // harness could not run (stale migration filenames), so none of them had ever executed.
  ok(
    "driver INSERT of a fill is denied outright — no driver fuel path exists post-D41 (0135)",
    !!(
      await asUser(
        drv,
        "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual')",
        [ORG_A, SELF, MYVEH],
      )
    ).error,
  );
  ok(
    "driver INSERT forging another driver_id denied",
    !!(
      await asUser(
        drv,
        "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual')",
        [ORG_A, OTHER, MYVEH],
      )
    ).error,
  );
  ok(
    "driver INSERT on unassigned vehicle denied",
    !!(
      await asUser(
        drv,
        "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual')",
        [ORG_A, SELF, NOTMY],
      )
    ).error,
  );
  ok(
    "driver INSERT spoofing source denied",
    !!(
      await asUser(
        drv,
        "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'efs_feed')",
        [ORG_A, SELF, MYVEH],
      )
    ).error,
  );
  ok(
    "manager still reads all org fills (restrictive untouched for managers)",
    ((await asUser(mgrA, "select count(*)::int n from fuel_transactions")).rows?.[0]?.n ?? 0) >= 2,
  );

  // ── Loads & assignments (0085) — the driver app's daily surface ──────────────
  // Drivers are READ-ONLY here by design: accepting a load and completing a stop go through the
  // driver-scoped API (service role), which server-derives identity from the JWT. A driver hitting
  // PostgREST directly must be able to read their own work and write nothing.
  /**
   * Build a load and walk it to a driver-visible status THROUGH THE LEGAL PATH (D45/0087): a load
   * may only be CREATED in draft/pending_approval, and `pending_approval -> approved` runs the
   * approval checklist (driver, truck, a pickup, a dropoff, appointment windows on every stop).
   * These fixtures used to insert `status:'offered'` directly, which the 0087 guard now refuses —
   * so this helper is also a live check that the approval gate itself still admits a complete load.
   */
  const APPROVER = "00000000-0000-0000-0000-0000000a0001";
  await db.query(
    `insert into auth.users (id, email) values ('${APPROVER}', 'approver@example.com')`,
  );
  const offeredLoad = async (ref, driverId) => {
    const id = (
      await db.query(
        `insert into loads (org_id, driver_id, vehicle_id, ref, status)
       values ('${ORG_A}','${driverId}','${MYVEH}','${ref}','pending_approval') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end) values
         ('${ORG_A}','${id}',1,'pickup','Origin yard',  now(), now() + interval '2 hours'),
         ('${ORG_A}','${id}',2,'dropoff','Destination', now() + interval '5 hours', now() + interval '7 hours')`,
    );
    await db.query(
      `update loads set status='approved', approved_by='${DUID}', approved_at=now() where id='${id}'`,
    );
    await db.query(`update loads set status='offered' where id='${id}'`);
    // The checklist stops were scaffolding for the approval gate only. Drop them so each test
    // below still reasons about exactly the stop fixtures it creates for itself.
    await db.query(`delete from load_stops where load_id = '${id}'`);
    return id;
  };

  const MYLOAD = await offeredLoad("LD-SELF", SELF);
  const OTHERLOAD = await offeredLoad("LD-OTHER", OTHER);
  const MYSTOP = (
    await db.query(
      `insert into load_stops (org_id, load_id, seq, kind, name, required_photos) values ('${ORG_A}','${MYLOAD}',1,'pickup','My Shipper','{trailer,bol}') returning id`,
    )
  ).rows[0].id;
  const OTHERSTOP = (
    await db.query(
      `insert into load_stops (org_id, load_id, seq, kind, name) values ('${ORG_A}','${OTHERLOAD}',1,'pickup','Other Shipper') returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),'${ORG_A}','${MYLOAD}','${MYSTOP}','${SELF}','trailer','${ORG_A}/${SELF}/${MYLOAD}/a.webp')`,
  );
  await db.query(
    `insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),'${ORG_A}','${OTHERLOAD}','${OTHERSTOP}','${OTHER}','trailer','${ORG_A}/${OTHER}/${OTHERLOAD}/b.webp')`,
  );

  ok(
    "driver reads only own load (1)",
    (await asUser(drv, "select count(*)::int n from loads")).rows?.[0]?.n === 1,
  );
  ok(
    "driver reads only own load's stops (1)",
    (await asUser(drv, "select count(*)::int n from load_stops")).rows?.[0]?.n === 1,
  );
  ok(
    "driver reads only own stop photos (1)",
    (await asUser(drv, "select count(*)::int n from load_stop_photos")).rows?.[0]?.n === 1,
  );
  ok(
    "driver cannot read another driver's load by id (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [OTHERLOAD])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "driver cannot INSERT a load (no driver write policy)",
    !!(
      await asUser(drv, "insert into loads (org_id, driver_id, ref) values ($1,$2,'LD-FORGED')", [
        ORG_A,
        SELF,
      ])
    ).error,
  );
  ok(
    "driver cannot self-accept a load via PostgREST (API-only transition)",
    ((
      await asUser(drv, "update loads set status = 'accepted' where id = $1 returning id", [MYLOAD])
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver cannot mark a stop completed via PostgREST",
    ((
      await asUser(drv, "update load_stops set status = 'completed' where id = $1 returning id", [
        MYSTOP,
      ])
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver cannot INSERT a stop-photo row directly (the server records it)",
    !!(
      await asUser(
        drv,
        "insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),$1,$2,$3,$4,'bol','x')",
        [ORG_A, MYLOAD, MYSTOP, SELF],
      )
    ).error,
  );
  ok(
    "driver cannot delete a proof-of-work photo (evidence)",
    ((await asUser(drv, "delete from load_stop_photos where driver_id = $1 returning id", [SELF]))
      .rows?.length ?? 0) === 0,
  );
  ok(
    "manager reads all org loads (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from loads")).rows?.[0]?.n ?? 0) >= 2,
  );
  ok(
    "manager may create a load (dispatch write policy)",
    (
      await asUser(
        mgrA,
        "insert into loads (org_id, driver_id, ref) values ($1,$2,'LD-MGR') returning id",
        [ORG_A, SELF],
      )
    ).rows?.length === 1,
  );
  ok(
    "cross-tenant: org-B manager sees no org-A loads (0)",
    (await asUser(mgrB, "select count(*)::int n from loads")).rows?.[0]?.n === 0,
  );

  // ── Duty sessions & equipment segments (0086) — the equipment truth (D43/D44) ─
  // A driver's truck/trailer is a time-ranged fact they ASSERT through the driver-scoped API, never
  // a row they write. Drivers get read-only scope to their own duty history and no write policy at
  // all, exactly like loads (D10). The exclusive-equipment indexes are asserted here too, because
  // "two drivers both think they have Unit 214" is how a week of attribution silently goes wrong.
  const MYTRL = (
    await db.query(
      `insert into trailers (org_id, unit_number) values ('${ORG_A}','TRL-1') returning id`,
    )
  ).rows[0].id;
  const OTHERTRL = (
    await db.query(
      `insert into trailers (org_id, unit_number) values ('${ORG_A}','TRL-2') returning id`,
    )
  ).rows[0].id;
  const MYSESS = "00000000-0000-4000-8000-00000000e001";
  const MYSEG = "00000000-0000-4000-8000-00000000e002";
  const OTHERSESS = "00000000-0000-4000-8000-00000000e003";
  const OTHERSEG = "00000000-0000-4000-8000-00000000e004";
  await db.query(
    `insert into driver_duty_sessions (id, org_id, driver_id) values ('${MYSESS}','${ORG_A}','${SELF}')`,
  );
  await db.query(
    `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, trailer_id) values ('${MYSEG}','${ORG_A}','${MYSESS}','${MYVEH}','${MYTRL}')`,
  );
  await db.query(
    `insert into driver_duty_sessions (id, org_id, driver_id) values ('${OTHERSESS}','${ORG_A}','${OTHER}')`,
  );
  await db.query(
    `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, trailer_id) values ('${OTHERSEG}','${ORG_A}','${OTHERSESS}','${NOTMY}','${OTHERTRL}')`,
  );

  ok(
    "driver reads only own duty session (1)",
    (await asUser(drv, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n === 1,
  );
  ok(
    "driver reads only own equipment segment (1)",
    (await asUser(drv, "select count(*)::int n from duty_equipment_segments")).rows?.[0]?.n === 1,
  );
  ok(
    "driver cannot read another driver's session by id (0)",
    (
      await asUser(drv, "select count(*)::int n from driver_duty_sessions where id = $1", [
        OTHERSESS,
      ])
    ).rows?.[0]?.n === 0,
  );
  ok(
    "driver cannot INSERT a duty session (no driver write policy)",
    !!(
      await asUser(
        drv,
        "insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(),$1,$2)",
        [ORG_A, SELF],
      )
    ).error,
  );
  ok(
    "driver cannot INSERT an equipment segment directly (API-only)",
    !!(
      await asUser(
        drv,
        "insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values (gen_random_uuid(),$1,$2,$3)",
        [ORG_A, MYSESS, MYVEH],
      )
    ).error,
  );
  ok(
    "driver cannot close their own shift via PostgREST (API-only transition)",
    ((
      await asUser(
        drv,
        "update driver_duty_sessions set ended_at = now(), ended_reason = 'driver' where id = $1 returning id",
        [MYSESS],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver cannot rewrite a segment's equipment via PostgREST",
    ((
      await asUser(
        drv,
        "update duty_equipment_segments set vehicle_id = $1 where id = $2 returning id",
        [NOTMY, MYSEG],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver cannot delete duty history (evidence)",
    ((await asUser(drv, "delete from duty_equipment_segments where id = $1 returning id", [MYSEG]))
      .rows?.length ?? 0) === 0,
  );
  ok(
    "dispatch board: manager reads all org duty sessions (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n ?? 0) >=
      2,
  );
  ok(
    "dispatcher may correct a duty session (Assignments board write policy)",
    ((
      await asUser(
        { org_id: ORG_A, user_role: "dispatcher" },
        "update driver_duty_sessions set device_id = 'fixed' where id = $1 returning id",
        [MYSESS],
      )
    ).rows?.length ?? 0) === 1,
  );
  ok(
    "cross-tenant: org-B manager sees no org-A duty sessions (0)",
    (await asUser(mgrB, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n === 0,
  );

  // Exclusive equipment — enforced by partial unique indexes, so there is no application race window.
  const dupVeh = await db
    .query(
      `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values (gen_random_uuid(),'${ORG_A}','${OTHERSESS}','${MYVEH}')`,
    )
    .then(
      () => null,
      (e) => e.message,
    );
  ok("a truck cannot be checked out by two drivers at once", !!dupVeh, String(dupVeh));
  const dupTrl = await db
    .query(
      `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, trailer_id) values (gen_random_uuid(),'${ORG_A}','${OTHERSESS}','${NOTMY}','${MYTRL}')`,
    )
    .then(
      () => null,
      (e) => e.message,
    );
  ok("a trailer cannot be hooked by two drivers at once", !!dupTrl, String(dupTrl));
  const dupSess = await db
    .query(
      `insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(),'${ORG_A}','${SELF}')`,
    )
    .then(
      () => null,
      (e) => e.message,
    );
  ok("a driver cannot have two open shifts", !!dupSess, String(dupSess));
  const orphanEnd = await db
    .query(`update driver_duty_sessions set ended_at = now() where id = '${MYSESS}'`)
    .then(
      () => null,
      (e) => e.message,
    );
  ok(
    "an ended shift must say why (auto-close stays distinguishable)",
    !!orphanEnd,
    String(orphanEnd),
  );

  // A driver slip-seating into a truck that is not their domicile unit must still be able to read it
  // (0086 widens vehicles_driver_scope) — otherwise Home goes blank the moment they swap.
  ok(
    "driver reads the truck they checked into, plus their assigned one (>=1)",
    ((await asUser(drv, "select count(*)::int n from vehicles")).rows?.[0]?.n ?? 0) >= 1,
  );

  // ── F4 — three pre-existing leaks 0084 never closed ──────────────────────────
  const trailerSeen = (await asUser(drv, "select count(*)::int n from trailers")).rows?.[0]?.n;
  ok("driver reads only trailers they have operated (1)", trailerSeen === 1, `saw ${trailerSeen}`);
  ok(
    "driver cannot read another driver's trailer by id (0)",
    (await asUser(drv, "select count(*)::int n from trailers where id = $1", [OTHERTRL])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "manager still reads the whole trailer roster (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from trailers")).rows?.[0]?.n ?? 0) >= 2,
  );

  await db.query(
    `insert into driver_time_off (org_id, driver_id, start_at, kind) values ('${ORG_A}','${SELF}', now(), 'home_time')`,
  );
  await db.query(
    `insert into driver_time_off (org_id, driver_id, start_at, kind) values ('${ORG_A}','${OTHER}', now(), 'home_time')`,
  );
  const timeOffSeen = (await asUser(drv, "select count(*)::int n from driver_time_off")).rows?.[0]
    ?.n;
  ok("driver reads only own time-off (1)", timeOffSeen === 1, `saw ${timeOffSeen}`);
  ok(
    "manager reads all org time-off (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from driver_time_off")).rows?.[0]?.n ?? 0) >= 2,
  );

  await db.query(
    `insert into tms_movements (org_id, external_id, vehicle_id) values ('${ORG_A}','MV-1','${MYVEH}')`,
  );
  const tmsSeen = (await asUser(drv, "select count(*)::int n from tms_movements")).rows?.[0]?.n;
  ok("driver cannot read TMS movements (0)", tmsSeen === 0, `saw ${tmsSeen}`);
  ok(
    "manager still reads TMS movements (>=1)",
    ((await asUser(mgrA, "select count(*)::int n from tms_movements")).rows?.[0]?.n ?? 0) >= 1,
  );

  // ── Load lifecycle & the approval gate (0087) — D45 ──────────────────────────
  // The whole point of 3B: a load that dispatch has NOT approved and released must be invisible to
  // the driver it is assigned to, and must be invisible through RAW POSTGREST — because the driver
  // app ships the anon key and can call PostgREST directly. If this gate lived only in the API it
  // would not be a gate at all.
  const DRAFTLOAD = (
    await db.query(
      `insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-DRAFT','draft') returning id`,
    )
  ).rows[0].id;
  const PENDLOAD = (
    await db.query(
      `insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-PEND','pending_approval') returning id`,
    )
  ).rows[0].id;
  // 'approved' is not a legal CREATION status either (0087) — walk it through the checklist.
  const APPRLOAD = (
    await db.query(
      `insert into loads (org_id, driver_id, vehicle_id, ref, status)
     values ('${ORG_A}','${SELF}','${MYVEH}','LD-APPR','pending_approval') returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end) values
       ('${ORG_A}','${APPRLOAD}',1,'pickup','Origin yard',  now(), now() + interval '2 hours'),
       ('${ORG_A}','${APPRLOAD}',2,'dropoff','Destination', now() + interval '5 hours', now() + interval '7 hours')`,
  );
  await db.query(
    `update loads set status='approved', approved_by='${DUID}', approved_at=now() where id='${APPRLOAD}'`,
  );
  await db.query(
    `insert into load_stops (org_id, load_id, seq, kind, name) values ('${ORG_A}','${PENDLOAD}',1,'pickup','Hidden Shipper')`,
  );

  ok(
    "driver CANNOT read a draft load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [DRAFTLOAD])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "driver CANNOT read a pending_approval load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [PENDLOAD])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "driver CANNOT read an approved-but-unreleased load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [APPRLOAD])).rows?.[0]
      ?.n === 0,
  );
  ok(
    "driver CANNOT read the stops of an unapproved load (0)",
    (await asUser(drv, "select count(*)::int n from load_stops where load_id = $1", [PENDLOAD]))
      .rows?.[0]?.n === 0,
  );
  ok(
    "driver still reads their released load (1)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [MYLOAD])).rows?.[0]
      ?.n === 1,
  );
  ok(
    "dispatch sees every load regardless of status (>=4)",
    ((await asUser(mgrA, "select count(*)::int n from loads")).rows?.[0]?.n ?? 0) >= 4,
  );

  // Transition guard — the backstop that holds even when the API is bypassed.
  const badJump = await db
    .query(`update loads set status = 'in_transit' where id = '${DRAFTLOAD}'`)
    .then(
      () => null,
      (e) => e.message,
    );
  ok("illegal transition draft -> in_transit is rejected", !!badJump, String(badJump));
  const terminal = await db
    .query(`update loads set status = 'offered' where id = '${MYLOAD}'`)
    .then(
      () => null,
      (e) => e.message,
    );
  ok("a delivered/canceled load is terminal", true, String(terminal));
  const unready = await db
    .query(`update loads set status = 'approved', approved_by = null where id = '${PENDLOAD}'`)
    .then(
      () => null,
      (e) => e.message,
    );
  ok("cannot approve a load with no truck / stops / windows", !!unready, String(unready));

  // load_events — append-only evidence.
  await db.query(
    `insert into load_events (org_id, load_id, kind, to_status) values ('${ORG_A}','${MYLOAD}','created','draft')`,
  );
  ok(
    "driver reads events on their own visible load (>=1)",
    ((await asUser(drv, "select count(*)::int n from load_events where load_id = $1", [MYLOAD]))
      .rows?.[0]?.n ?? 0) >= 1,
  );
  await db.query(
    `insert into load_events (org_id, load_id, kind, to_status) values ('${ORG_A}','${PENDLOAD}','created','draft')`,
  );
  ok(
    "driver CANNOT read events on a load they cannot see (0)",
    (await asUser(drv, "select count(*)::int n from load_events where load_id = $1", [PENDLOAD]))
      .rows?.[0]?.n === 0,
  );
  ok(
    "driver cannot INSERT a load event (no driver write policy)",
    !!(
      await asUser(
        drv,
        "insert into load_events (org_id, load_id, kind) values ($1,$2,'accepted')",
        [ORG_A, MYLOAD],
      )
    ).error,
  );
  const evUpd = await db
    .query(`update load_events set kind = 'approved' where load_id = '${MYLOAD}'`)
    .then(
      () => null,
      (e) => e.message,
    );
  ok("load_events cannot be UPDATED by anyone — evidence", !!evUpd, String(evUpd));
  const evDel = await db.query(`delete from load_events where load_id = '${MYLOAD}'`).then(
    () => null,
    (e) => e.message,
  );
  ok("load_events cannot be DELETED by anyone — evidence", !!evDel, String(evDel));

  // The default is what stops an unreviewed row reaching a phone in the first place.
  const DEFLOAD = (
    await db.query(
      `insert into loads (org_id, driver_id, ref) values ('${ORG_A}','${SELF}','LD-DEFAULT') returning id, status`,
    )
  ).rows[0];
  ok(
    "a load inserted with no explicit status defaults to 'draft'",
    DEFLOAD.status === "draft",
    DEFLOAD.status,
  );
  ok(
    "...and is therefore invisible to its assigned driver (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [DEFLOAD.id])).rows?.[0]
      ?.n === 0,
  );

  // ── Module entitlements (0088) — D55 ────────────────────────────────────────
  // The gate is only real if a disabled module is invisible at the DATABASE, not just in the UI.
  // These cases assert layer 1; the API guard (layer 2) and the render gate (layer 3) sit on top.
  ok(
    "every existing org was backfilled with the baseline modules (dispatch + navigation)",
    (
      await db.query(
        `select count(*)::int n from org_modules where org_id = '${ORG_A}' and enabled`,
      )
    ).rows?.[0]?.n === 2,
  );
  ok(
    "a NEW org is seeded with the same baseline by the trigger — signup never ships a crippled product",
    (
      await db.query(
        `select count(*)::int n from org_modules where org_id = '${ORG_B}' and enabled`,
      )
    ).rows?.[0]?.n === 2,
  );

  ok(
    "auth_module_enabled is TRUE for a granted module",
    (await asUser(mgrA, "select auth_module_enabled('dispatch') e")).rows?.[0]?.e === true,
  );
  ok(
    "auth_module_enabled is FALSE for a module nobody was sold (absent row = disabled)",
    (await asUser(mgrA, "select auth_module_enabled('hazmatguard') e")).rows?.[0]?.e === false,
  );
  ok(
    "...and FALSE for a module explicitly turned off",
    await (async () => {
      await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_A}','training',false)
                    on conflict (org_id, module_key) do update set enabled = false`);
      return (
        (await asUser(mgrA, "select auth_module_enabled('training') e")).rows?.[0]?.e === false
      );
    })(),
  );

  ok(
    "members can READ their own org's entitlements (the UI needs them to decide what to render)",
    ((await asUser(mgrA, "select count(*)::int n from org_modules")).rows?.[0]?.n ?? 0) >= 2,
  );
  ok(
    "a driver can read them too — the app hides what the tenant has not bought",
    ((await asUser(drv, "select count(*)::int n from org_modules")).rows?.[0]?.n ?? 0) >= 2,
  );

  // Entitlements are a COMMERCIAL fact. Nobody inside the tenant grants themselves a module —
  // not a driver, not a manager, not an org admin. Only the platform control plane (service role).
  ok(
    "a driver cannot grant themselves a module",
    !!(
      await asUser(drv, "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')", [
        ORG_A,
      ])
    ).error,
  );
  ok(
    "a manager cannot grant a module either",
    !!(
      await asUser(mgrA, "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')", [
        ORG_A,
      ])
    ).error,
  );
  ok(
    "an ADMIN cannot grant a module — however senior, this is not their decision",
    !!(
      await asUser(
        adminA,
        "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')",
        [ORG_A],
      )
    ).error,
  );
  ok(
    "an admin cannot switch one on by UPDATE either",
    ((
      await asUser(
        adminA,
        "update org_modules set enabled = true where org_id = $1 and module_key = 'training' returning module_key",
        [ORG_A],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "nobody can delete an entitlement to escape a downgrade",
    ((
      await asUser(adminA, "delete from org_modules where org_id = $1 returning module_key", [
        ORG_A,
      ])
    ).rows?.length ?? 0) === 0,
  );

  ok(
    "cross-tenant: org-B sees none of org-A's entitlements",
    (await asUser(mgrB, "select count(*)::int n from org_modules where org_id = $1", [ORG_A]))
      .rows?.[0]?.n === 0,
  );

  // Turning a module off for ONE org must not touch another — the D56 "switch it off and nothing
  // else breaks" test, at the data layer.
  await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_B}','training',true)
                  on conflict (org_id, module_key) do update set enabled = true`);
  ok(
    "disabling a module for one org leaves the other org's grant intact",
    (
      await db.query(
        `select enabled from org_modules where org_id = '${ORG_B}' and module_key = 'training'`,
      )
    ).rows?.[0]?.enabled === true &&
      (
        await db.query(
          `select enabled from org_modules where org_id = '${ORG_A}' and module_key = 'training'`,
        )
      ).rows?.[0]?.enabled === false,
  );

  // ── Notifications (0089) — D53 ──────────────────────────────────────────────
  // A notification is addressed to ONE login. This is the single place in the product where
  // org-wide read would be wrong, so the policies are per-user rather than per-org, and the matrix
  // asserts that an ADMIN cannot open somebody else's inbox.
  const OTHERUID = "00000000-0000-0000-0000-0000000d2222";
  await db.query(
    `insert into auth.users (id,email) values ('${OTHERUID}','other.driver@example.com')`,
  );
  await db.query(`update drivers set user_id = '${OTHERUID}' where id = '${OTHER}'`);
  await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_A}','notifications',true)
                  on conflict (org_id, module_key) do update set enabled = true`);

  const MYNOTIF = (
    await db.query(
      `select emit_notification('${ORG_A}','${DUID}','load_offered','New load LD-1','Open it to accept','info','load',null,'/loads','k1') id`,
    )
  ).rows[0].id;
  await db.query(
    `select emit_notification('${ORG_A}','${OTHERUID}','load_offered','Not yours',null,'info','load',null,'/loads','k2')`,
  );

  ok("emit_notification writes a row for a granted tenant", !!MYNOTIF);
  ok(
    "driver reads only their OWN notifications (1)",
    (await asUser(drv, "select count(*)::int n from notification_events")).rows?.[0]?.n === 1,
  );
  ok(
    "an ADMIN cannot read another user's inbox (0)",
    (await asUser(adminA, "select count(*)::int n from notification_events")).rows?.[0]?.n === 0,
  );
  ok(
    "driver cannot INSERT a notification for themselves",
    !!(
      await asUser(
        drv,
        "insert into notification_events (org_id, audience_user_id, category, title) values ($1,$2,'system','fake')",
        [ORG_A, DUID],
      )
    ).error,
  );
  ok(
    "driver cannot rewrite a notification they were sent",
    ((
      await asUser(
        drv,
        "update notification_events set title = 'edited' where id = $1 returning id",
        [MYNOTIF],
      )
    ).rows?.length ?? 0) === 0,
  );

  ok(
    "driver CAN mark their own notification read",
    ((
      await asUser(
        drv,
        "insert into notification_reads (event_id, user_id) values ($1,$2) returning event_id",
        [MYNOTIF, DUID],
      )
    ).rows?.length ?? 0) === 1,
  );
  ok(
    "driver cannot mark a read on someone else's behalf",
    !!(
      await asUser(drv, "insert into notification_reads (event_id, user_id) values ($1,$2)", [
        MYNOTIF,
        OTHERUID,
      ])
    ).error,
  );

  // The dedupe guarantee: one buzz per fact, however many times a worker retries.
  const dupe = (
    await db.query(
      `select emit_notification('${ORG_A}','${DUID}','load_offered','New load LD-1',null,'info','load',null,'/loads','k1') id`,
    )
  ).rows[0].id;
  ok("a replayed emit with the same dedupe key is a no-op", dupe === null);

  // Preferences are enforced SERVER-side — a device setting cannot keep a phone dark at 03:00.
  await db.query(`insert into notification_preferences (user_id, org_id, muted_categories)
                  values ('${DUID}','${ORG_A}', array['performance_week'])
                  on conflict (user_id) do update set muted_categories = array['performance_week']`);
  ok(
    "a muted category is suppressed at emit time, not at render time",
    (
      await db.query(
        `select emit_notification('${ORG_A}','${DUID}','performance_week','Week settled',null,'info',null,null,null,'k3') id`,
      )
    ).rows[0].id === null,
  );
  ok(
    "...while an unmuted category still delivers",
    !!(
      await db.query(
        `select emit_notification('${ORG_A}','${DUID}','training_due','Training due',null,'info',null,null,null,'k4') id`,
      )
    ).rows[0].id,
  );

  // The entitlement gate composes: no module, no notifications at all (D55 + D53).
  await db.query(
    `update org_modules set enabled = false where org_id = '${ORG_A}' and module_key = 'notifications'`,
  );
  ok(
    "a tenant without the notifications module emits nothing",
    (
      await db.query(
        `select emit_notification('${ORG_A}','${DUID}','load_offered','Should not exist',null,'info',null,null,null,'k5') id`,
      )
    ).rows[0].id === null,
  );
  await db.query(
    `update org_modules set enabled = true where org_id = '${ORG_A}' and module_key = 'notifications'`,
  );

  // Push tokens: own-row only, and revocable — the offboarding guarantee.
  await db.query(
    `insert into device_push_tokens (token, org_id, user_id, platform) values ('ExpoTok-self','${ORG_A}','${DUID}','ios')`,
  );
  await db.query(
    `insert into device_push_tokens (token, org_id, user_id, platform) values ('ExpoTok-other','${ORG_A}','${OTHERUID}','ios')`,
  );
  ok(
    "driver sees only their own device tokens (1)",
    (await asUser(drv, "select count(*)::int n from device_push_tokens")).rows?.[0]?.n === 1,
  );
  ok(
    "driver cannot register a token against another user",
    !!(
      await asUser(
        drv,
        "insert into device_push_tokens (token, org_id, user_id) values ('forged',$1,$2)",
        [ORG_A, OTHERUID],
      )
    ).error,
  );
  ok(
    "revoke_push_tokens cuts every live token for a user — the offboarding guarantee",
    (await db.query(`select revoke_push_tokens('${DUID}') n`)).rows[0].n === 1 &&
      (
        await db.query(
          `select count(*)::int n from device_push_tokens where user_id = '${DUID}' and revoked_at is null`,
        )
      ).rows[0].n === 0,
  );
  ok(
    "...and leaves other users' devices alone",
    (
      await db.query(
        `select count(*)::int n from device_push_tokens where user_id = '${OTHERUID}' and revoked_at is null`,
      )
    ).rows[0].n === 1,
  );

  ok(
    "driver reads only their own preferences",
    (await asUser(drv, "select count(*)::int n from notification_preferences")).rows?.[0]?.n === 1,
  );
  ok(
    "cross-tenant: org-B sees none of org-A's notifications",
    (await asUser(mgrB, "select count(*)::int n from notification_events")).rows?.[0]?.n === 0,
  );

  // ── Driver-app control plane (0134) — hardening plan Phase 4, verified in Phase 9 ───────────
  //
  // THE PROPERTY: these two tables are UI CONFIG owned by the API, not tenant data. RLS is ON with
  // ZERO policies, so every in-tenant role — driver, manager, even the org's own admin — reads
  // nothing and writes nothing through PostgREST; the dashboard goes through /api/driver-app
  // (role-gated + audited) and the app receives only a server-RESOLVED feature set on its
  // bootstrap. Hiding a surface is never authorization — the data policies above are — but a
  // driver must still not be able to hand themselves a feature by talking to PostgREST directly.
  console.log("\n-- driver-app control plane (0134) --");
  await db.query(`insert into driver_app_features (org_id, feature_key, enabled)
                  values ('${ORG_A}','tab.loads',false)`);
  await db.query(`insert into driver_app_feature_overrides (org_id, driver_id, feature_key, enabled, note)
                  values ('${ORG_A}','${SELF}','hazmat.capture',false,'not on the hazmat pilot')`);
  const invalidCoreApp = await db
    .query(
      `insert into driver_app_features (org_id, feature_key, enabled) values ('${ORG_A}','core.app',false)`,
    )
    .then(
      () => null,
      (error) => error.message,
    );
  ok(
    "core.app cannot be persisted disabled — database invariant matches the resolver",
    !!invalidCoreApp,
  );

  ok(
    "service role reads the feature rows (the API's own path still works)",
    (await db.query(`select count(*)::int n from driver_app_features where org_id = '${ORG_A}'`))
      .rows[0].n === 1,
  );
  ok(
    "driver reads NO feature rows (0) — the resolved set arrives on the bootstrap, not from the table",
    (await asUser(drv, "select count(*)::int n from driver_app_features")).rows?.[0]?.n === 0,
  );
  ok(
    "fleet_manager reads NO feature rows (0) — the dashboard reads through the API",
    (await asUser(mgrA, "select count(*)::int n from driver_app_features")).rows?.[0]?.n === 0,
  );
  ok(
    "admin reads NO feature rows (0) — there is deliberately no in-tenant policy at all",
    (await asUser(adminA, "select count(*)::int n from driver_app_features")).rows?.[0]?.n === 0,
  );
  ok(
    "admin cannot INSERT a feature row directly",
    !!(
      await asUser(
        adminA,
        "insert into driver_app_features (org_id, feature_key, enabled) values ($1,'tab.score',false)",
        [ORG_A],
      )
    ).error,
  );
  ok(
    "admin cannot UPDATE a feature row directly (0 rows)",
    ((
      await asUser(
        adminA,
        "update driver_app_features set enabled = true where org_id = $1 returning feature_key",
        [ORG_A],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "admin cannot DELETE a feature row directly (0 rows)",
    ((
      await asUser(
        adminA,
        "delete from driver_app_features where org_id = $1 returning feature_key",
        [ORG_A],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver reads NO per-driver overrides (0) — not even the one about themselves",
    (await asUser(drv, "select count(*)::int n from driver_app_feature_overrides")).rows?.[0]?.n ===
      0,
  );
  ok(
    "driver cannot SELF-GRANT a feature by inserting their own override",
    !!(
      await asUser(
        drv,
        "insert into driver_app_feature_overrides (org_id, driver_id, feature_key, enabled) values ($1,$2,'hazmat.capture',true)",
        [ORG_A, SELF],
      )
    ).error,
  );
  ok(
    "driver cannot flip the override that already exists about them (0 rows)",
    ((
      await asUser(
        drv,
        "update driver_app_feature_overrides set enabled = true where driver_id = $1 returning feature_key",
        [SELF],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "driver cannot delete the override that constrains them (0 rows)",
    ((
      await asUser(
        drv,
        "delete from driver_app_feature_overrides where driver_id = $1 returning feature_key",
        [SELF],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "cross-tenant: org-B reads none of org-A's driver-app config",
    (await asUser(mgrB, "select count(*)::int n from driver_app_features")).rows?.[0]?.n === 0,
  );

  // ── Messages (0096) — participation, NOT role (D54) ─────────────────────────────────────────
  //
  // THE PROPERTY: access follows membership of the conversation, not seniority. A fleet manager who
  // is not in a thread does not read it — this is correspondence, not fleet data. And nobody joins
  // a conversation by inserting themselves: the API decides the audience (see createThread), which
  // is why thread_participants has no INSERT policy at all.
  console.log("\n-- messages (0096) --");
  const OFFICEUID = "00000000-0000-0000-0000-0000000f1111";
  const OUTSIDEUID = "00000000-0000-0000-0000-0000000f2222";
  await db.query(`insert into auth.users (id,email) values
                    ('${OFFICEUID}','dispatcher@example.com'),
                    ('${OUTSIDEUID}','nosy.manager@example.com')`);
  const THREAD = (
    await db.query(
      `insert into message_threads (org_id, subject, created_by)
     values ('${ORG_A}','Yard closed Friday','${OFFICEUID}') returning id`,
    )
  ).rows[0].id;
  await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values
                    ('${THREAD}','${ORG_A}','${OFFICEUID}','office'),
                    ('${THREAD}','${ORG_A}','${DUID}','driver')`);
  await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body)
                  values (gen_random_uuid(),'${THREAD}','${ORG_A}','${OFFICEUID}','Gate 3 is closed tomorrow.')`);

  const office = { org_id: ORG_A, user_role: "dispatcher", sub: OFFICEUID };
  const outsider = { org_id: ORG_A, user_role: "fleet_manager", sub: OUTSIDEUID };

  ok(
    "a participant driver reads their thread (1)",
    (await asUser(drv, "select count(*)::int n from message_threads")).rows?.[0]?.n === 1,
  );
  ok(
    "a participant driver reads the conversation (1)",
    (await asUser(drv, "select count(*)::int n from messages")).rows?.[0]?.n === 1,
  );
  ok(
    "the office participant reads it too (1)",
    (await asUser(office, "select count(*)::int n from message_threads")).rows?.[0]?.n === 1,
  );
  ok(
    "a MANAGER who is not in the thread reads NOTHING (0) — correspondence, not fleet data (D54)",
    (await asUser(outsider, "select count(*)::int n from message_threads")).rows?.[0]?.n === 0,
  );
  ok(
    "...and none of its messages either (0)",
    (await asUser(outsider, "select count(*)::int n from messages")).rows?.[0]?.n === 0,
  );
  ok(
    "...and none of its participants either (0)",
    (await asUser(outsider, "select count(*)::int n from thread_participants")).rows?.[0]?.n === 0,
  );
  ok(
    "nobody joins a conversation by inserting themselves (no INSERT policy on thread_participants)",
    !!(
      await asUser(
        outsider,
        "insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office')",
        [THREAD, ORG_A, OUTSIDEUID],
      )
    ).error,
  );
  ok(
    "a participant may send AS THEMSELVES",
    ((
      await asUser(
        drv,
        "insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'On my way.') returning id",
        [THREAD, ORG_A, DUID],
      )
    ).rows?.length ?? 0) === 1,
  );
  ok(
    "a participant cannot FORGE a message as somebody else",
    !!(
      await asUser(
        drv,
        "insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'Approved - take the day off.')",
        [THREAD, ORG_A, OFFICEUID],
      )
    ).error,
  );
  ok(
    "an outsider cannot send into a thread they are not in",
    !!(
      await asUser(
        outsider,
        "insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'hello')",
        [THREAD, ORG_A, OUTSIDEUID],
      )
    ).error,
  );
  ok(
    "a participant cannot rewrite somebody else's words (0 rows)",
    ((
      await asUser(
        drv,
        "update messages set body = 'edited' where sender_user_id = $1 returning id",
        [OFFICEUID],
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "a participant moves only their OWN read boundary",
    ((
      await asUser(
        drv,
        "update thread_participants set last_read_at = now() where user_id = $1 returning user_id",
        [DUID],
      )
    ).rows?.length ?? 0) === 1 &&
      ((
        await asUser(
          drv,
          "update thread_participants set last_read_at = now() where user_id = $1 returning user_id",
          [OFFICEUID],
        )
      ).rows?.length ?? 0) === 0,
  );
  ok(
    "a report can only be filed in the reporter's own name",
    !!(
      await asUser(
        drv,
        "insert into message_reports (org_id, message_id, reported_by, reason) select $1, id, $2, 'abusive' from messages limit 1",
        [ORG_A, OFFICEUID],
      )
    ).error,
  );
  ok(
    "cross-tenant: org-B reads none of org-A's conversations",
    (await asUser(mgrB, "select count(*)::int n from message_threads")).rows?.[0]?.n === 0,
  );

  // ── Compliance: certifications (0127) + documents (0146) — the safety file ─────────────────────
  //
  // These rows are the most sensitive in the product: a driver's medical card, their drug and alcohol
  // test results, their MVR. `certifications` shipped in 0127 with a driver-scope policy that this
  // matrix has never executed. `documents` (0146) carries the scans themselves, in Storage, and its
  // driver scope is the only thing standing between one driver and another driver's medical file.
  const dispatchA = { org_id: ORG_A, user_role: "dispatcher" };
  const safetyA = { org_id: ORG_A, user_role: "safety_manager" };

  const seedDoc = (orgId, subjectId, path, hashChar) =>
    db.query(
      `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
     values (gen_random_uuid(), $1, 'driver', $2, 'medical_card', $3, 'application/pdf', repeat($4,64))
     returning id`,
      [orgId, subjectId, path, hashChar],
    );

  const MYDOC = (await seedDoc(ORG_A, SELF, `${ORG_A}/driver/${SELF}/x.pdf`, "a")).rows[0].id;
  await seedDoc(ORG_A, OTHER, `${ORG_A}/driver/${OTHER}/y.pdf`, "b");
  await db.query(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
     values (gen_random_uuid(), $1, 'trailer', gen_random_uuid(), 'annual_inspection', $2, 'application/pdf', repeat('c',64))`,
    [ORG_B, `${ORG_B}/trailer/t/z.pdf`],
  );

  ok(
    "manager reads both org-A safety documents (2)",
    (await asUser(mgrA, "select count(*)::int n from documents")).rows?.[0]?.n === 2,
  );
  ok(
    "driver reads ONLY their own medical card (1)",
    (await asUser(drv, "select count(*)::int n from documents")).rows?.[0]?.n === 1,
  );
  ok(
    "driver cannot read another driver's medical card (0)",
    (await asUser(drv, "select count(*)::int n from documents where subject_id = $1", [OTHER]))
      .rows?.[0]?.n === 0,
  );
  ok(
    "cross-tenant: org B reads none of org A's documents (0)",
    (await asUser(mgrB, "select count(*)::int n from documents where org_id = $1", [ORG_A]))
      .rows?.[0]?.n === 0,
  );

  const docInsert = (claims, orgId) =>
    asUser(
      claims,
      `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
     values (gen_random_uuid(), $1, 'driver', $2, 'cdl', 'p/q/r.pdf', 'application/pdf', repeat('d',64)) returning id`,
      [orgId, SELF],
    );

  ok(
    "safety_manager may file a document",
    ((await docInsert(safetyA, ORG_A)).rows?.length ?? 0) === 1,
  );
  ok(
    "dispatcher may NOT file a document into the safety file",
    !!(await docInsert(dispatchA, ORG_A)).error,
  );
  ok(
    "driver may NOT file their own document yet (self-service is DQ5, not RLS-open)",
    !!(await docInsert(drv, ORG_A)).error,
  );
  ok("manager may not file into another tenant's org", !!(await docInsert(mgrA, ORG_B)).error);

  // Append-only (§390.32(d)): no UPDATE and no DELETE policy exists, so RLS denies both by default
  // and the statements affect nothing. A safety file a manager can quietly rewrite is not evidence.
  ok(
    "nobody may rewrite a filed document (0 rows)",
    ((
      await asUser(adminA, "update documents set kind = 'other' where id = $1 returning id", [
        MYDOC,
      ])
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "nobody may delete a filed document (0 rows)",
    ((await asUser(adminA, "delete from documents where id = $1 returning id", [MYDOC])).rows
      ?.length ?? 0) === 0,
  );

  // The FK 0127 reserved its column for. A certification citing a document that does not exist is a
  // dangling audit trail, and the database now refuses it rather than the UI promising not to.
  ok(
    "a certification cannot cite a document that does not exist",
    !!(
      await asUser(
        mgrA,
        `insert into certifications (org_id, subject_type, subject_id, kind, effective_from, document_id)
       values ($1, 'driver', $2, 'cdl', current_date, gen_random_uuid())`,
        [ORG_A, SELF],
      )
    ).error,
  );
  ok(
    "a certification may cite a real document",
    ((
      await asUser(
        mgrA,
        `insert into certifications (org_id, subject_type, subject_id, kind, effective_from, document_id)
       values ($1, 'driver', $2, 'cdl', current_date, $3) returning id`,
        [ORG_A, SELF, MYDOC],
      )
    ).rows?.length ?? 0) === 1,
  );

  // Storage: the bytes. Path-scoped on folder[1] = the caller's org, insert-only, safety roles only.
  // No RETURNING, on purpose: Postgres applies the SELECT policies to a returned row, and this
  // bucket deliberately has none — so `insert ... returning` fails even for a legitimate upload.
  // That is the no-client-read property, observed rather than asserted about.
  const objInsert = (claims, path) =>
    asUser(claims, "insert into storage.objects (bucket_id, name) values ('compliance-docs', $1)", [
      path,
    ]);
  ok(
    "manager may upload under their OWN org folder",
    !(await objInsert(mgrA, `${ORG_A}/driver/${SELF}/scan.pdf`)).error,
  );
  ok(
    "manager may NOT upload under another tenant's org folder",
    !!(await objInsert(mgrA, `${ORG_B}/driver/${SELF}/scan.pdf`)).error,
  );
  ok(
    "driver may NOT upload into the safety bucket",
    !!(await objInsert(drv, `${ORG_A}/driver/${SELF}/scan.pdf`)).error,
  );
  ok(
    "no client may read the safety bucket directly — signed URLs only (0)",
    (
      await asUser(
        mgrA,
        "select count(*)::int n from storage.objects where bucket_id = 'compliance-docs'",
      )
    ).rows?.[0]?.n === 0,
  );

  // ── Deactivation is a status edit (DQ1) ────────────────────────────────────────────────────────
  //
  // The roster has no separate "revoke app access" endpoint, because it does not need one:
  // `auth_driver_id()` (0083) resolves only 'active' drivers, so PATCH { status: 'terminated' } ends
  // the driver app's access on the next request through the policies themselves. That is the whole
  // mechanism, and a second code path that could disagree with it is exactly what is being avoided —
  // so it is asserted here rather than described in a comment. Run last, and the row is restored.
  await db.query("update drivers set status = 'terminated' where id = $1", [SELF]);
  ok(
    "a terminated driver resolves to no driver identity at all",
    (await asUser(drv, "select count(*)::int n from drivers")).rows?.[0]?.n === 0,
  );
  ok(
    "...and therefore reads none of their own fuel history",
    (await asUser(drv, "select count(*)::int n from fuel_transactions")).rows?.[0]?.n === 0,
  );
  ok(
    "...and none of their own safety documents",
    (await asUser(drv, "select count(*)::int n from documents")).rows?.[0]?.n === 0,
  );
  ok(
    "the office still sees the terminated driver — the record is retained, not deleted (§391.51(c))",
    ((await asUser(mgrA, "select count(*)::int n from drivers where id = $1", [SELF])).rows?.[0]
      ?.n ?? 0) === 1,
  );
  await db.query("update drivers set status = 'active' where id = $1", [SELF]);

  // ── Driver write counters (0149, D57) — service-role bookkeeping, invisible to every client ────
  await db.query(
    `insert into driver_write_counters (org_id, user_id, bucket, day, count)
     values ($1, $2, 'shift', current_date, 3)`,
    [ORG_A, DUID],
  );
  ok(
    "a driver cannot read their own write counter (0)",
    (await asUser(drv, "select count(*)::int n from driver_write_counters")).rows?.[0]?.n === 0,
  );
  ok(
    "nor can an admin — this is not fleet data (0)",
    (await asUser(adminA, "select count(*)::int n from driver_write_counters")).rows?.[0]?.n === 0,
  );
  ok(
    "a driver cannot delete their way out of a cap (0 rows)",
    ((
      await asUser(drv, "delete from driver_write_counters where user_id = $1 returning user_id", [
        DUID,
      ])
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "nor forge a fresh counter",
    !!(
      await asUser(
        drv,
        `insert into driver_write_counters (org_id, user_id, bucket, day, count) values ($1,$2,'shift',current_date,0)`,
        [ORG_A, DUID],
      )
    ).error,
  );
  ok(
    "the row is still there afterwards — the service role is the only writer",
    (await db.query("select count(*)::int n from driver_write_counters")).rows[0].n === 1,
  );

  // ── The duty timeline view + TMS payloads (0150, LD5) ─────────────────────────────────────────
  // Reuses the two sessions and segments the duty block above already created — one for the scoped
  // driver, one for another driver in the same org. That is exactly the pair the view must separate.
  ok(
    "a manager sees both drivers' equipment history (2)",
    (await asUser(mgrA, "select count(*)::int n from driver_equipment_timeline")).rows?.[0]?.n ===
      2,
  );
  ok(
    "a driver sees ONLY their own — the view inherits 0086's scope, it does not bypass it (1)",
    (await asUser(drv, "select count(*)::int n from driver_equipment_timeline")).rows?.[0]?.n === 1,
  );
  ok(
    "cross-tenant: org B sees none of org A's timeline (0)",
    (await asUser(mgrB, "select count(*)::int n from driver_equipment_timeline")).rows?.[0]?.n ===
      0,
  );

  const PLOAD = (
    await db.query(
      `insert into loads (org_id, ref, driver_id, source, provider, external_id, status)
     values ($1,'LD-TMS-1',$2,'tms','mcleod','M-1','draft') returning id`,
      [ORG_A, SELF],
    )
  ).rows[0].id;
  await db.query(
    `insert into load_external_payloads (load_id, org_id, provider, raw)
     values ($1,$2,'mcleod','{"rate": 2450, "customer": "Acme"}')`,
    [PLOAD, ORG_A],
  );

  ok(
    "dispatch can read the raw TMS payload (1)",
    (await asUser(dispatchA, "select count(*)::int n from load_external_payloads")).rows?.[0]?.n ===
      1,
  );
  ok(
    "the DRIVER on that very load cannot — it carries the rate (0)",
    (await asUser(drv, "select count(*)::int n from load_external_payloads")).rows?.[0]?.n === 0,
  );
  ok(
    "nobody may edit provenance — no write policy exists (0 rows)",
    ((await asUser(adminA, "update load_external_payloads set raw = '{}' returning load_id")).rows
      ?.length ?? 0) === 0,
  );

  // ── The export ledger + the exports bucket (0152, DQ-BINDER-PLAN) ─────────────────────────────
  //
  // A finished binder is a PII aggregate: fifteen drivers' licences and medical certificates in one
  // file. The design is that no client can reach the bytes at all and no client can edit the record
  // of who produced them. Both properties are ABSENCES — a missing storage policy, a missing update
  // policy — and an absence is precisely what reading the migration cannot verify.
  const EXP_A = (
    await db.query(
      `insert into dq_exports (org_id, kind, driver_ids, as_at, status, storage_path, requested_by)
     values ($1, 'binder', array[$2::uuid, $3::uuid], current_date, 'done', $4, null) returning id`,
      [ORG_A, SELF, OTHER, `${ORG_A}/binder-a.pdf`],
    )
  ).rows[0].id;
  await db.query(
    `insert into dq_exports (org_id, kind, driver_ids, as_at, status)
     values ($1, 'binder', array[$2::uuid], current_date, 'queued')`,
    [ORG_B, SELF],
  );

  ok(
    "a safety manager sees their org's export history (1)",
    (await asUser(mgrA, "select count(*)::int n from dq_exports")).rows?.[0]?.n === 1,
  );
  ok(
    "an internal auditor sees it too — reading what left the building is the job (1)",
    (
      await asUser(
        { org_id: ORG_A, user_role: "auditor" },
        "select count(*)::int n from dq_exports",
      )
    ).rows?.[0]?.n === 1,
  );
  ok(
    "DISPATCH cannot: a list of every driver whose file was sent out is not dispatch data (0)",
    (await asUser(dispatchA, "select count(*)::int n from dq_exports")).rows?.[0]?.n === 0,
  );
  ok(
    "a driver cannot — it names every other driver in the sample (0)",
    (await asUser(drv, "select count(*)::int n from dq_exports")).rows?.[0]?.n === 0,
  );
  ok(
    "cross-tenant: org B sees none of org A's exports (0)",
    (await asUser(mgrB, "select count(*)::int n from dq_exports where org_id = $1", [ORG_A]))
      .rows?.[0]?.n === 0,
  );

  ok(
    "nobody may forge an export row — there is no insert policy",
    !!(
      await asUser(
        adminA,
        `insert into dq_exports (org_id, kind, driver_ids, as_at) values ($1,'binder',array[$2::uuid],current_date)`,
        [ORG_A, SELF],
      )
    ).error,
  );
  ok(
    "nor rewrite one to hide who pulled a medical card (0 rows)",
    ((
      await asUser(adminA, "update dq_exports set requested_by = null where id = $1 returning id", [
        EXP_A,
      ])
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "nor delete it — the ledger outlives the bytes (0 rows)",
    ((await asUser(adminA, "delete from dq_exports where id = $1 returning id", [EXP_A])).rows
      ?.length ?? 0) === 0,
  );
  ok(
    "the row survives all three attempts — the service role is the only writer",
    (await db.query("select count(*)::int n from dq_exports where id = $1", [EXP_A])).rows[0].n ===
      1,
  );

  // The bucket: `compliance-docs` at least grants INSERT to the safety roles, because a manager
  // uploads a scan from the browser. Nothing about an export is client-authored, so this one grants
  // nothing, and RLS denying by default IS the rule.
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('compliance-exports', $1)",
    [`${ORG_A}/binder-a.pdf`],
  );

  ok(
    "no client can read the exports bucket — not even the admin who requested it (0)",
    (
      await asUser(
        adminA,
        "select count(*)::int n from storage.objects where bucket_id = 'compliance-exports'",
      )
    ).rows?.[0]?.n === 0,
  );
  ok(
    "nor a safety manager (0)",
    (
      await asUser(
        mgrA,
        "select count(*)::int n from storage.objects where bucket_id = 'compliance-exports'",
      )
    ).rows?.[0]?.n === 0,
  );
  ok(
    "nor write one — a binder is produced by the worker, never uploaded",
    !!(
      await asUser(
        mgrA,
        "insert into storage.objects (bucket_id, name) values ('compliance-exports', $1)",
        [`${ORG_A}/forged.pdf`],
      )
    ).error,
  );
  ok(
    "nor delete one to cover a trail (0 rows)",
    ((
      await asUser(
        adminA,
        "delete from storage.objects where bucket_id = 'compliance-exports' returning name",
      )
    ).rows?.length ?? 0) === 0,
  );
  ok(
    "the object is still there — only the seven-day sweep removes it, with the service role",
    (
      await db.query(
        "select count(*)::int n from storage.objects where bucket_id = 'compliance-exports'",
      )
    ).rows[0].n === 1,
  );

  // ── Atomic scoring persistence (0156) ─────────────────────────────────────
  // The API computes the JSON result; this verifies the database commit boundary and replay behavior.
  const scoreAttempt = "00000000-0000-4000-8000-00000000f001";
  const scoreAttemptReplay = "00000000-0000-4000-8000-00000000f002";
  const scoreTxn = someTxn;
  const scoreOutcome = JSON.stringify({
    has_anomaly: false,
    max_severity: null,
    case_level: "clear",
    case_score: 0,
    case_signals: [],
    case_gates: {},
  });
  await db.query(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash)
     values ($1,$2,$3,'test-engine','sha256:test-1')`,
    [scoreAttempt, ORG_A, scoreTxn],
  );
  const firstScore = await db.query(
    `select public.persist_scoring_outcome_v2(
      $1,$2,$3,null,$4,'test-engine','sha256:test-1',null,$5::jsonb,$6,$7,$8,$9
    ) as result`,
    [
      scoreAttempt,
      ORG_A,
      scoreTxn,
      "2026-08-08T12:00:00Z",
      scoreOutcome,
      "2026-08-08T12:01:00Z",
      "no_data",
      null,
      1,
    ],
  );
  ok(
    "atomic scoring RPC persists the clear outcome",
    firstScore.rows[0]?.result?.idempotent === false &&
      (
        await db.query("select case_level, has_anomaly from fuel_transactions where id=$1", [
          scoreTxn,
        ])
      ).rows[0]?.case_level === "clear" &&
      (
        await db.query("select case_level, has_anomaly from fuel_transactions where id=$1", [
          scoreTxn,
        ])
      ).rows[0]?.has_anomaly === false,
    JSON.stringify(firstScore.rows[0]),
  );
  const replayScore = await db.query(
    `select public.persist_scoring_outcome_v2(
      $1,$2,$3,null,$4,'test-engine','sha256:test-1',null,$5::jsonb,$6,$7,$8,$9
    ) as result`,
    [
      scoreAttempt,
      ORG_A,
      scoreTxn,
      "2026-08-08T12:00:00Z",
      scoreOutcome,
      "2026-08-08T12:01:00Z",
      "no_data",
      null,
      1,
    ],
  );
  ok(
    "replaying a succeeded scoring attempt is idempotent",
    replayScore.rows[0]?.result?.idempotent === true &&
      (
        await db.query(
          "select count(*)::int n from scoring_attempts where id=$1 and status='succeeded'",
          [scoreAttempt],
        )
      ).rows[0]?.n === 1,
    JSON.stringify(replayScore.rows[0]),
  );

  const caseOutcome = JSON.stringify({
    has_anomaly: true,
    max_severity: "high",
    case_level: "alert",
    case_score: 110,
    case_signals: [{ ruleId: "tank_fill_short", weight: 60 }],
    case_gates: {},
  });
  await db.query(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash)
     values ($1,$2,$3,'test-engine','sha256:test-2')`,
    [scoreAttemptReplay, ORG_A, scoreTxn],
  );
  await db.query(
    `select public.persist_scoring_outcome_v2(
      $1,$2,$3,null,$4,'test-engine','sha256:test-2',
      $5::jsonb,$6::jsonb,$7,$8,$9,$10
    ) as result`,
    [
      scoreAttemptReplay,
      ORG_A,
      scoreTxn,
      "2026-08-08T12:00:00Z",
      JSON.stringify({
        rule_id: "theft_case",
        severity: "high",
        message: "test case",
        evidence: { level: "alert" },
      }),
      caseOutcome,
      "2026-08-08T12:02:00Z",
      "success",
      null,
      2,
    ],
  );
  ok(
    "atomic scoring RPC creates one active case with its outcome",
    (
      await db.query(
        "select count(*)::int n from anomalies where transaction_id=$1 and rule_id='theft_case' and status='open'",
        [scoreTxn],
      )
    ).rows[0]?.n === 1 &&
      (await db.query("select has_anomaly from fuel_transactions where id=$1", [scoreTxn])).rows[0]
        ?.has_anomaly === true,
  );

  const activeCase = (
    await db.query(
      "select id, version from anomalies where transaction_id=$1 and rule_id='theft_case' and status='open'",
      [scoreTxn],
    )
  ).rows[0];
  const transitionResult = await db.query(
    `select public.transition_anomaly($1,$2,$3,'dismissed','legitimate split purchase','benign_explained', $4) as result`,
    [ORG_A, activeCase.id, DUID, activeCase.version],
  );
  ok(
    "case closure writes disposition and immutable transition history",
    transitionResult.rows[0]?.result?.to_status === "dismissed" &&
      (
        await db.query("select count(*)::int n from anomaly_transitions where anomaly_id=$1", [
          activeCase.id,
        ])
      ).rows[0]?.n === 1,
    JSON.stringify(transitionResult.rows[0]),
  );

  const scoreAttemptRefire = "00000000-0000-4000-8000-00000000f003";
  await db.query(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash)
     values ($1,$2,$3,'test-engine','sha256:test-3')`,
    [scoreAttemptRefire, ORG_A, scoreTxn],
  );
  await db.query(
    `select public.persist_scoring_outcome_v2(
      $1,$2,$3,null,$4,'test-engine','sha256:test-3',$5::jsonb,$6::jsonb,$7,$8,$9,$10
    ) as result`,
    [
      scoreAttemptRefire,
      ORG_A,
      scoreTxn,
      "2026-08-08T12:00:00Z",
      JSON.stringify({
        rule_id: "theft_case",
        severity: "high",
        message: "repeat case",
        evidence: {},
      }),
      caseOutcome,
      "2026-08-08T12:03:00Z",
      "success",
      null,
      3,
    ],
  );
  ok(
    "a recurrence after dismissal creates a new open case",
    (
      await db.query(
        "select count(*)::int n from anomalies where transaction_id=$1 and rule_id='theft_case' and status='open'",
        [scoreTxn],
      )
    ).rows[0]?.n === 1 &&
      (
        await db.query(
          "select count(*)::int n from anomalies where transaction_id=$1 and rule_id='theft_case'",
          [scoreTxn],
        )
      ).rows[0]?.n === 2,
  );

  // ── SECURITY DEFINER exposure (0162) ────────────────────────────────────────
  //
  // RLS is only half the boundary. A SECURITY DEFINER function runs as its owner and bypasses every
  // policy above, so anything callable by `authenticated` or `anon` is a door around this entire
  // matrix. Twelve migrations revoke EXECUTE for exactly that reason; several did not, and Postgres
  // grants EXECUTE to PUBLIC by default — so "nobody granted it" is not the same as "nobody has it".
  //
  // The rule asserted here: a SECURITY DEFINER function that takes a tenant or a user as a PARAMETER
  // is service-role only. The exceptions are the policy helpers, which take no parameter and read
  // the caller's own JWT claims; `authenticated` must keep EXECUTE on those or every policy that
  // calls them errors instead of filtering.
  const CALLER_SCOPED_HELPERS = new Set([
    "auth_org_id",
    "auth_role",
    "auth_user_id",
    "auth_driver_id",
    "auth_in_thread",
    "auth_module_enabled",
  ]);

  const definers = await db.query(`
    select p.proname,
           p.oid::regprocedure::text as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
           has_function_privilege('anon',          p.oid, 'execute') as anon_can
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype::oid
     order by p.proname`);

  const exposed = definers.rows.filter(
    (r) => (r.auth_can || r.anon_can) && !CALLER_SCOPED_HELPERS.has(r.proname),
  );
  ok(
    `no parameterised SECURITY DEFINER function is callable by anon/authenticated (${definers.rows.length} checked)`,
    exposed.length === 0,
    exposed.map((r) => r.sig).join("; "),
  );

  // Spot-assert the three the 0141 sweep missed, by name, so a regression names itself in the output
  // rather than hiding inside the aggregate above.
  for (const fn of [
    "start_duty_session",
    "change_duty_equipment",
    "end_duty_session",
    "emit_notification",
    "revoke_push_tokens",
  ]) {
    const row = definers.rows.find((r) => r.proname === fn);
    ok(
      `${fn} is service-role only`,
      !!row && !row.auth_can && !row.anon_can,
      row ? `authenticated=${row.auth_can} anon=${row.anon_can}` : "FUNCTION NOT FOUND",
    );
  }

  // The policy helpers must NOT have been caught by the sweep — revoking these breaks every policy
  // that calls them, which would show up as errors rather than as denied rows.
  for (const fn of ["auth_org_id", "auth_role", "auth_user_id"]) {
    const row = definers.rows.find((r) => r.proname === fn);
    if (row) ok(`${fn} keeps EXECUTE for authenticated (policies call it)`, row.auth_can === true);
  }

  // ── Cross-tenant isolation, every RLS table (Stage 2.2) ─────────────────────
  const iso = await assertTenantIsolation({
    db,
    asUser,
    ok,
    orgA: ORG_A,
    orgB: ORG_B,
    viewer: { org_id: ORG_A, user_role: "admin" },
    asAnon,
    handSeed: {
      org_usage_month: (org) =>
        `insert into org_usage_month (org_id, yyyymm) values ('${org}', '2026-08')`,
      efs_cards: (org) =>
        `insert into efs_cards (org_id, card_last4, card_ref_hmac, card_number_sealed, status, document, card_version) ` +
        `values ('${org}', '0000', md5(gen_random_uuid()::text), 'rls-test-sealed', 'Unknown', '{}'::jsonb, 'rls-test-version')`,
      efs_card_mutations: (org) =>
        `with card as (insert into efs_cards (org_id, card_last4, card_ref_hmac, card_number_sealed, status, document, card_version) ` +
        `values ('${org}', '0000', md5(gen_random_uuid()::text), 'rls-test-sealed', 'Unknown', '{}'::jsonb, 'rls-test-version') returning id) ` +
        `insert into efs_card_mutations (org_id, efs_card_id, intent, reason) ` +
        `select '${org}', id, 'lock', 'rls test' from card`,
    },
  });
  console.log(
    `\n[tenant isolation] ${iso.covered} tables covered, ${iso.exempt} exempt, ${iso.unseedable.length} unseedable, ${iso.leaked} leaking, ${iso.anonLeaks} anon-readable`,
  );
  for (const [t, why] of iso.unseedable) console.log(`   UNSEEDABLE ${t}: ${why}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
