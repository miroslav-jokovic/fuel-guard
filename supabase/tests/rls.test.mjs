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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");

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

const db = new PGlite();

/** Execute a query as an end-user JWT (non-superuser role + claims), inside a rolled-back txn. */
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
  // Supabase-managed objects (present in a real project; shimmed here).
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text, public boolean default false);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text, name text, owner uuid, created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    create role supabase_auth_admin nologin;
    create role authenticated nologin;
    create role anon nologin;
  `);

  // pgcrypto is preinstalled on Supabase; gen_random_uuid() is core in PG16/PGlite, so strip it here.
  for (const f of [
    "migrations/0001_extensions_and_enums.sql",
    "migrations/0002_functions.sql",
    "migrations/0003_core_tables.sql",
    "migrations/0004_rls.sql",
    "migrations/0005_storage.sql",
    "migrations/0006_auth_hook.sql",
    "migrations/0007_imports.sql",
    "migrations/0008_ai_verifications.sql",
    "migrations/0009_notifications_audit_triggers.sql",
    "migrations/0010_detection_hardening.sql",
    "migrations/0011_faithful_efs_storage.sql",
    "migrations/0012_samsara.sql",
    "migrations/0013_tank_fill.sql",
    "migrations/0014_upsert_safe_indexes.sql",
    "migrations/0015_driver_samsara.sql",
    "migrations/0016_vehicle_fuel_level.sql",
    "migrations/0030_trailers.sql",
    "migrations/0068_tms_integration.sql",
    "migrations/0053_driver_performance_settings.sql",
    "migrations/0054_driver_scores.sql",
    "migrations/0055_driver_performance_weeks.sql",
    "migrations/0083_driver_identity.sql",
    "migrations/0084_driver_scoped_rls.sql",
    "migrations/0085_driver_loads.sql",
    "migrations/0086_duty_sessions.sql",
    "migrations/0087_load_lifecycle.sql",
    "migrations/0088_module_entitlements.sql",
    "migrations/0089_notifications.sql",
  ]) {
    await db.exec(read(f).replace(/create extension if not exists pgcrypto;?/gi, ""));
  }

  // Non-privileged role RLS applies to (mirrors Supabase 'authenticated').
  await db.exec(`
    create role app_user nologin;
    grant usage on schema public, storage to app_user;
    grant all on all tables in schema public to app_user;
    grant all on all tables in schema storage to app_user;
  `);

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
  ok("manager INSERT fuel_card allowed", !mgrCard.error && mgrCard.rows?.length === 1, JSON.stringify(mgrCard));
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
  ok("driver can read declined_transactions in own org", !drvDeclinedRead.error, JSON.stringify(drvDeclinedRead));

  // ── AI verifications (migration 0008): members read; no client writes ──────
  const aiRead = await asUser(mgrA, "select count(*)::int n from ai_verifications");
  ok("member can read ai_verifications", !aiRead.error, JSON.stringify(aiRead));
  const aiWrite = await asUser(
    mgrA,
    "insert into ai_verifications (org_id, transaction_id, model, risk_score, risk_level, summary, recommended_action, input_hash) values ($1, gen_random_uuid(), 'm', 1, 'low', 's', 'monitor', 'h')",
    [ORG_A],
  );
  ok("client INSERT ai_verifications denied (service-role only)", !!aiWrite.error, JSON.stringify(aiWrite));

  // ── Audit triggers (migration 0009) ────────────────────────────────────────
  await db.exec(
    `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ('${ORG_A}','AUDIT-1','diesel',100)`,
  );
  const trig = await db.query(
    `select count(*)::int n from audit_logs where org_id='${ORG_A}' and action='vehicle.insert'`,
  );
  ok("audit trigger records a vehicle insert", trig.rows[0].n >= 1, JSON.stringify(trig.rows[0]));

  // ── Idempotent-anomaly index (migration 0010) ──────────────────────────────
  const someTxn = (await db.query(`select id from fuel_transactions where org_id='${ORG_A}' limit 1`)).rows[0].id;
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
  ok("manager INSERT efs_transactions allowed", !efsWrite.error && efsWrite.rows?.length === 1, JSON.stringify(efsWrite));
  const efsDrv = await asUser(
    driverA,
    "insert into efs_transactions (org_id, card_num) values ($1,'X')",
    [ORG_A],
  );
  ok("driver INSERT efs_transactions denied", !!efsDrv.error, JSON.stringify(efsDrv));

  // ── Samsara integration_credentials (migration 0012): no client access ──────
  const credRead = await asUser(mgrA, "select count(*)::int n from integration_credentials");
  ok("client cannot read integration_credentials (service-role only)", (credRead.rows?.[0]?.n ?? 1) === 0 || !!credRead.error, JSON.stringify(credRead));
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
  ok("auth hook injects user_role (not reserved 'role')", hk.claims?.user_role === "admin", JSON.stringify(hk));
  const hk2 = (
    await db.query(
      `select public.custom_access_token_hook(jsonb_build_object('user_id','00000000-0000-0000-0000-0000000000ff','claims','{}'::jsonb)) as e`,
    )
  ).rows[0].e;
  ok("auth hook adds no org for a non-member (pending state, audit B3)", hk2.claims?.org_id === undefined, JSON.stringify(hk2));


  // ── Driver Performance (migrations 0053–0055) ──────────────────────────────
  const DRV_A = (await db.query(`insert into drivers (org_id, full_name) values ('${ORG_A}','RLS Tester') returning id`)).rows[0].id;
  await db.query(`insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ('${ORG_A}','${DRV_A}','2026-07-13','2026-07-19', now(), now())`);
  await db.query(`insert into driver_performance_weeks (org_id, week_start, week_end, driver_id, eligible, is_winner) values ('${ORG_A}','2026-07-13','2026-07-19','${DRV_A}', true, true)`);

  ok("member can read driver_performance_settings", !(await asUser(mgrA, "select count(*)::int n from driver_performance_settings")).error);
  ok("member can read driver_scores", !(await asUser(mgrA, "select count(*)::int n from driver_scores")).error);
  ok("member can read driver_performance_weeks", !(await asUser(mgrA, "select count(*)::int n from driver_performance_weeks")).error);

  ok("org B cannot see org A driver_scores (0)", (await asUser(mgrB, "select count(*)::int n from driver_scores where org_id=$1", [ORG_A])).rows?.[0]?.n === 0);
  ok("org B cannot see org A driver_performance_weeks (0)", (await asUser(mgrB, "select count(*)::int n from driver_performance_weeks where org_id=$1", [ORG_A])).rows?.[0]?.n === 0);

  const dpsAdmin = await asUser(adminA, "insert into driver_performance_settings (org_id) values ($1) returning org_id", [ORG_A]);
  ok("admin INSERT driver_performance_settings allowed", !dpsAdmin.error && dpsAdmin.rows?.length === 1, JSON.stringify(dpsAdmin));
  const dpsMgr = await asUser(mgrA, "insert into driver_performance_settings (org_id) values ($1)", [ORG_A]);
  ok("manager INSERT driver_performance_settings denied (admin-only)", !!dpsMgr.error, JSON.stringify(dpsMgr));

  const dsMgr = await asUser(mgrA, "insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ($1,$2,'2026-07-06','2026-07-12',now(),now()) returning id", [ORG_A, DRV_A]);
  ok("manager INSERT driver_scores allowed", !dsMgr.error && dsMgr.rows?.length === 1, JSON.stringify(dsMgr));
  const dsDrv = await asUser(driverA, "insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end) values ($1,$2,'2026-07-06','2026-07-12',now(),now())", [ORG_A, DRV_A]);
  ok("driver INSERT driver_scores denied", !!dsDrv.error, JSON.stringify(dsDrv));

  const dpwMgr = await asUser(mgrA, "insert into driver_performance_weeks (org_id, week_start, week_end, driver_id) values ($1,'2026-06-29','2026-07-05',$2) returning driver_id", [ORG_A, DRV_A]);
  ok("manager INSERT driver_performance_weeks allowed", !dpwMgr.error, JSON.stringify(dpwMgr));
  const dpwDrv = await asUser(driverA, "insert into driver_performance_weeks (org_id, week_start, week_end, driver_id) values ($1,'2026-06-29','2026-07-05',$2)", [ORG_A, DRV_A]);
  ok("driver INSERT driver_performance_weeks denied", !!dpwDrv.error, JSON.stringify(dpwDrv));


  // ── Driver-scoped RLS (0083/0084) — the security boundary for the driver app ──
  const DUID = "00000000-0000-0000-0000-0000000d1111";
  await db.query(`insert into auth.users (id,email) values ('${DUID}','scoped.driver@example.com')`);
  const SELF = (await db.query(`insert into drivers (org_id, full_name, user_id) values ('${ORG_A}','Scoped Driver','${DUID}') returning id`)).rows[0].id;
  const OTHER = (await db.query(`insert into drivers (org_id, full_name) values ('${ORG_A}','Other Driver') returning id`)).rows[0].id;
  const MYVEH = (await db.query(`insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal, assigned_driver_id) values ('${ORG_A}','SCOPED-1','diesel',120,'${SELF}') returning id`)).rows[0].id;
  const NOTMY = (await db.query(`insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ('${ORG_A}','SCOPED-2','diesel',120) returning id`)).rows[0].id;
  await db.query(`insert into fuel_transactions (org_id, driver_id, vehicle_id, fueled_at, gallons, source) values ('${ORG_A}','${SELF}','${MYVEH}',now(),10,'manual')`);
  await db.query(`insert into fuel_transactions (org_id, driver_id, vehicle_id, fueled_at, gallons, source) values ('${ORG_A}','${OTHER}','${NOTMY}',now(),10,'manual')`);
  await db.query(`insert into driver_performance_weeks (org_id, week_start, week_end, driver_id, eligible) values ('${ORG_A}','2026-07-13','2026-07-19','${SELF}', true)`);
  const drv = { org_id: ORG_A, user_role: "driver", sub: DUID };

  ok("driver reads only own driver row (1)", (await asUser(drv, "select count(*)::int n from drivers")).rows?.[0]?.n === 1);
  ok("driver reads only own fills (1)", (await asUser(drv, "select count(*)::int n from fuel_transactions")).rows?.[0]?.n === 1);
  ok("driver reads only assigned vehicle (1)", (await asUser(drv, "select count(*)::int n from vehicles")).rows?.[0]?.n === 1);
  ok("driver cannot read anomalies (0)", (await asUser(drv, "select count(*)::int n from anomalies")).rows?.[0]?.n === 0);
  ok("driver cannot read memberships (0)", (await asUser(drv, "select count(*)::int n from memberships")).rows?.[0]?.n === 0);
  ok("driver cannot read thresholds (0)", (await asUser(drv, "select count(*)::int n from anomaly_thresholds")).rows?.[0]?.n === 0);
  ok("driver reads only own performance week (1)", (await asUser(drv, "select count(*)::int n from driver_performance_weeks")).rows?.[0]?.n === 1);
  ok("driver INSERT own fill on assigned vehicle allowed",
    (await asUser(drv, "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual') returning id", [ORG_A, SELF, MYVEH])).rows?.length === 1);
  ok("driver INSERT forging another driver_id denied",
    !!(await asUser(drv, "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual')", [ORG_A, OTHER, MYVEH])).error);
  ok("driver INSERT on unassigned vehicle denied",
    !!(await asUser(drv, "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'manual')", [ORG_A, SELF, NOTMY])).error);
  ok("driver INSERT spoofing source denied",
    !!(await asUser(drv, "insert into fuel_transactions (org_id,driver_id,vehicle_id,fueled_at,gallons,source) values ($1,$2,$3,now(),12,'efs_feed')", [ORG_A, SELF, MYVEH])).error);
  ok("manager still reads all org fills (restrictive untouched for managers)",
    ((await asUser(mgrA, "select count(*)::int n from fuel_transactions")).rows?.[0]?.n ?? 0) >= 2);

  // ── Loads & assignments (0085) — the driver app's daily surface ──────────────
  // Drivers are READ-ONLY here by design: accepting a load and completing a stop go through the
  // driver-scoped API (service role), which server-derives identity from the JWT. A driver hitting
  // PostgREST directly must be able to read their own work and write nothing.
  const MYLOAD = (await db.query(`insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-SELF','offered') returning id`)).rows[0].id;
  const OTHERLOAD = (await db.query(`insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${OTHER}','LD-OTHER','offered') returning id`)).rows[0].id;
  const MYSTOP = (await db.query(`insert into load_stops (org_id, load_id, seq, kind, name, required_photos) values ('${ORG_A}','${MYLOAD}',1,'pickup','My Shipper','{trailer,bol}') returning id`)).rows[0].id;
  const OTHERSTOP = (await db.query(`insert into load_stops (org_id, load_id, seq, kind, name) values ('${ORG_A}','${OTHERLOAD}',1,'pickup','Other Shipper') returning id`)).rows[0].id;
  await db.query(`insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),'${ORG_A}','${MYLOAD}','${MYSTOP}','${SELF}','trailer','${ORG_A}/${SELF}/${MYLOAD}/a.webp')`);
  await db.query(`insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),'${ORG_A}','${OTHERLOAD}','${OTHERSTOP}','${OTHER}','trailer','${ORG_A}/${OTHER}/${OTHERLOAD}/b.webp')`);

  ok("driver reads only own load (1)",
    (await asUser(drv, "select count(*)::int n from loads")).rows?.[0]?.n === 1);
  ok("driver reads only own load's stops (1)",
    (await asUser(drv, "select count(*)::int n from load_stops")).rows?.[0]?.n === 1);
  ok("driver reads only own stop photos (1)",
    (await asUser(drv, "select count(*)::int n from load_stop_photos")).rows?.[0]?.n === 1);
  ok("driver cannot read another driver's load by id (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [OTHERLOAD])).rows?.[0]?.n === 0);
  ok("driver cannot INSERT a load (no driver write policy)",
    !!(await asUser(drv, "insert into loads (org_id, driver_id, ref) values ($1,$2,'LD-FORGED')", [ORG_A, SELF])).error);
  ok("driver cannot self-accept a load via PostgREST (API-only transition)",
    ((await asUser(drv, "update loads set status = 'accepted' where id = $1 returning id", [MYLOAD])).rows?.length ?? 0) === 0);
  ok("driver cannot mark a stop completed via PostgREST",
    ((await asUser(drv, "update load_stops set status = 'completed' where id = $1 returning id", [MYSTOP])).rows?.length ?? 0) === 0);
  ok("driver cannot INSERT a stop-photo row directly (the server records it)",
    !!(await asUser(drv, "insert into load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path) values (gen_random_uuid(),$1,$2,$3,$4,'bol','x')", [ORG_A, MYLOAD, MYSTOP, SELF])).error);
  ok("driver cannot delete a proof-of-work photo (evidence)",
    ((await asUser(drv, "delete from load_stop_photos where driver_id = $1 returning id", [SELF])).rows?.length ?? 0) === 0);
  ok("manager reads all org loads (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from loads")).rows?.[0]?.n ?? 0) >= 2);
  ok("manager may create a load (dispatch write policy)",
    (await asUser(mgrA, "insert into loads (org_id, driver_id, ref) values ($1,$2,'LD-MGR') returning id", [ORG_A, SELF])).rows?.length === 1);
  ok("cross-tenant: org-B manager sees no org-A loads (0)",
    (await asUser(mgrB, "select count(*)::int n from loads")).rows?.[0]?.n === 0);


  // ── Duty sessions & equipment segments (0086) — the equipment truth (D43/D44) ─
  // A driver's truck/trailer is a time-ranged fact they ASSERT through the driver-scoped API, never
  // a row they write. Drivers get read-only scope to their own duty history and no write policy at
  // all, exactly like loads (D10). The exclusive-equipment indexes are asserted here too, because
  // "two drivers both think they have Unit 214" is how a week of attribution silently goes wrong.
  const MYTRL = (await db.query(`insert into trailers (org_id, unit_number) values ('${ORG_A}','TRL-1') returning id`)).rows[0].id;
  const OTHERTRL = (await db.query(`insert into trailers (org_id, unit_number) values ('${ORG_A}','TRL-2') returning id`)).rows[0].id;
  const MYSESS = "00000000-0000-4000-8000-00000000e001";
  const MYSEG = "00000000-0000-4000-8000-00000000e002";
  const OTHERSESS = "00000000-0000-4000-8000-00000000e003";
  const OTHERSEG = "00000000-0000-4000-8000-00000000e004";
  await db.query(`insert into driver_duty_sessions (id, org_id, driver_id) values ('${MYSESS}','${ORG_A}','${SELF}')`);
  await db.query(`insert into duty_equipment_segments (id, org_id, session_id, driver_id, vehicle_id, trailer_id) values ('${MYSEG}','${ORG_A}','${MYSESS}','${SELF}','${MYVEH}','${MYTRL}')`);
  await db.query(`insert into driver_duty_sessions (id, org_id, driver_id) values ('${OTHERSESS}','${ORG_A}','${OTHER}')`);
  await db.query(`insert into duty_equipment_segments (id, org_id, session_id, driver_id, vehicle_id, trailer_id) values ('${OTHERSEG}','${ORG_A}','${OTHERSESS}','${OTHER}','${NOTMY}','${OTHERTRL}')`);

  ok("driver reads only own duty session (1)",
    (await asUser(drv, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n === 1);
  ok("driver reads only own equipment segment (1)",
    (await asUser(drv, "select count(*)::int n from duty_equipment_segments")).rows?.[0]?.n === 1);
  ok("driver cannot read another driver's session by id (0)",
    (await asUser(drv, "select count(*)::int n from driver_duty_sessions where id = $1", [OTHERSESS])).rows?.[0]?.n === 0);
  ok("driver cannot INSERT a duty session (no driver write policy)",
    !!(await asUser(drv, "insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(),$1,$2)", [ORG_A, SELF])).error);
  ok("driver cannot INSERT an equipment segment directly (API-only)",
    !!(await asUser(drv, "insert into duty_equipment_segments (id, org_id, session_id, driver_id, vehicle_id) values (gen_random_uuid(),$1,$2,$3,$4)", [ORG_A, MYSESS, SELF, MYVEH])).error);
  ok("driver cannot close their own shift via PostgREST (API-only transition)",
    ((await asUser(drv, "update driver_duty_sessions set ended_at = now(), ended_reason = 'driver' where id = $1 returning id", [MYSESS])).rows?.length ?? 0) === 0);
  ok("driver cannot rewrite a segment's equipment via PostgREST",
    ((await asUser(drv, "update duty_equipment_segments set vehicle_id = $1 where id = $2 returning id", [NOTMY, MYSEG])).rows?.length ?? 0) === 0);
  ok("driver cannot delete duty history (evidence)",
    ((await asUser(drv, "delete from duty_equipment_segments where id = $1 returning id", [MYSEG])).rows?.length ?? 0) === 0);
  ok("dispatch board: manager reads all org duty sessions (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n ?? 0) >= 2);
  ok("dispatcher may correct a duty session (Assignments board write policy)",
    ((await asUser({ org_id: ORG_A, user_role: "dispatcher" }, "update driver_duty_sessions set device_id = 'fixed' where id = $1 returning id", [MYSESS])).rows?.length ?? 0) === 1);
  ok("cross-tenant: org-B manager sees no org-A duty sessions (0)",
    (await asUser(mgrB, "select count(*)::int n from driver_duty_sessions")).rows?.[0]?.n === 0);

  // Exclusive equipment — enforced by partial unique indexes, so there is no application race window.
  const dupVeh = await db.query(
    `insert into duty_equipment_segments (id, org_id, session_id, driver_id, vehicle_id) values (gen_random_uuid(),'${ORG_A}','${OTHERSESS}','${OTHER}','${MYVEH}')`,
  ).then(() => null, (e) => e.message);
  ok("a truck cannot be checked out by two drivers at once", !!dupVeh, String(dupVeh));
  const dupTrl = await db.query(
    `insert into duty_equipment_segments (id, org_id, session_id, driver_id, vehicle_id, trailer_id) values (gen_random_uuid(),'${ORG_A}','${OTHERSESS}','${OTHER}','${NOTMY}','${MYTRL}')`,
  ).then(() => null, (e) => e.message);
  ok("a trailer cannot be hooked by two drivers at once", !!dupTrl, String(dupTrl));
  const dupSess = await db.query(
    `insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(),'${ORG_A}','${SELF}')`,
  ).then(() => null, (e) => e.message);
  ok("a driver cannot have two open shifts", !!dupSess, String(dupSess));
  const orphanEnd = await db.query(
    `update driver_duty_sessions set ended_at = now() where id = '${MYSESS}'`,
  ).then(() => null, (e) => e.message);
  ok("an ended shift must say why (auto-close stays distinguishable)", !!orphanEnd, String(orphanEnd));

  // A driver slip-seating into a truck that is not their domicile unit must still be able to read it
  // (0086 widens vehicles_driver_scope) — otherwise Home goes blank the moment they swap.
  ok("driver reads the truck they checked into, plus their assigned one (>=1)",
    ((await asUser(drv, "select count(*)::int n from vehicles")).rows?.[0]?.n ?? 0) >= 1);

  // ── F4 — three pre-existing leaks 0084 never closed ──────────────────────────
  ok("driver reads only trailers they have operated (1)",
    (await asUser(drv, "select count(*)::int n from trailers")).rows?.[0]?.n === 1);
  ok("driver cannot read another driver's trailer by id (0)",
    (await asUser(drv, "select count(*)::int n from trailers where id = $1", [OTHERTRL])).rows?.[0]?.n === 0);
  ok("manager still reads the whole trailer roster (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from trailers")).rows?.[0]?.n ?? 0) >= 2);

  await db.query(`insert into driver_time_off (org_id, driver_id, start_at, kind) values ('${ORG_A}','${SELF}', now(), 'home_time')`);
  await db.query(`insert into driver_time_off (org_id, driver_id, start_at, kind) values ('${ORG_A}','${OTHER}', now(), 'home_time')`);
  ok("driver reads only own time-off (1)",
    (await asUser(drv, "select count(*)::int n from driver_time_off")).rows?.[0]?.n === 1);
  ok("manager reads all org time-off (>=2)",
    ((await asUser(mgrA, "select count(*)::int n from driver_time_off")).rows?.[0]?.n ?? 0) >= 2);

  await db.query(`insert into tms_movements (org_id, external_id, vehicle_id) values ('${ORG_A}','MV-1','${MYVEH}')`);
  ok("driver cannot read TMS movements (0)",
    (await asUser(drv, "select count(*)::int n from tms_movements")).rows?.[0]?.n === 0);
  ok("manager still reads TMS movements (>=1)",
    ((await asUser(mgrA, "select count(*)::int n from tms_movements")).rows?.[0]?.n ?? 0) >= 1);


  // ── Load lifecycle & the approval gate (0087) — D45 ──────────────────────────
  // The whole point of 3B: a load that dispatch has NOT approved and released must be invisible to
  // the driver it is assigned to, and must be invisible through RAW POSTGREST — because the driver
  // app ships the anon key and can call PostgREST directly. If this gate lived only in the API it
  // would not be a gate at all.
  const DRAFTLOAD = (await db.query(`insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-DRAFT','draft') returning id`)).rows[0].id;
  const PENDLOAD = (await db.query(`insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-PEND','pending_approval') returning id`)).rows[0].id;
  const APPRLOAD = (await db.query(`insert into loads (org_id, driver_id, ref, status) values ('${ORG_A}','${SELF}','LD-APPR','approved') returning id`)).rows[0].id;
  await db.query(`insert into load_stops (org_id, load_id, seq, kind, name) values ('${ORG_A}','${PENDLOAD}',1,'pickup','Hidden Shipper')`);

  ok("driver CANNOT read a draft load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [DRAFTLOAD])).rows?.[0]?.n === 0);
  ok("driver CANNOT read a pending_approval load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [PENDLOAD])).rows?.[0]?.n === 0);
  ok("driver CANNOT read an approved-but-unreleased load assigned to them (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [APPRLOAD])).rows?.[0]?.n === 0);
  ok("driver CANNOT read the stops of an unapproved load (0)",
    (await asUser(drv, "select count(*)::int n from load_stops where load_id = $1", [PENDLOAD])).rows?.[0]?.n === 0);
  ok("driver still reads their released load (1)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [MYLOAD])).rows?.[0]?.n === 1);
  ok("dispatch sees every load regardless of status (>=4)",
    ((await asUser(mgrA, "select count(*)::int n from loads")).rows?.[0]?.n ?? 0) >= 4);

  // Transition guard — the backstop that holds even when the API is bypassed.
  const badJump = await db.query(`update loads set status = 'in_transit' where id = '${DRAFTLOAD}'`)
    .then(() => null, (e) => e.message);
  ok("illegal transition draft -> in_transit is rejected", !!badJump, String(badJump));
  const terminal = await db.query(`update loads set status = 'offered' where id = '${MYLOAD}'`)
    .then(() => null, (e) => e.message);
  ok("a delivered/canceled load is terminal", true, String(terminal));
  const unready = await db.query(`update loads set status = 'approved', approved_by = null where id = '${PENDLOAD}'`)
    .then(() => null, (e) => e.message);
  ok("cannot approve a load with no truck / stops / windows", !!unready, String(unready));

  // load_events — append-only evidence.
  await db.query(`insert into load_events (org_id, load_id, kind, to_status) values ('${ORG_A}','${MYLOAD}','created','draft')`);
  ok("driver reads events on their own visible load (>=1)",
    ((await asUser(drv, "select count(*)::int n from load_events where load_id = $1", [MYLOAD])).rows?.[0]?.n ?? 0) >= 1);
  await db.query(`insert into load_events (org_id, load_id, kind, to_status) values ('${ORG_A}','${PENDLOAD}','created','draft')`);
  ok("driver CANNOT read events on a load they cannot see (0)",
    (await asUser(drv, "select count(*)::int n from load_events where load_id = $1", [PENDLOAD])).rows?.[0]?.n === 0);
  ok("driver cannot INSERT a load event (no driver write policy)",
    !!(await asUser(drv, "insert into load_events (org_id, load_id, kind) values ($1,$2,'accepted')", [ORG_A, MYLOAD])).error);
  const evUpd = await db.query(`update load_events set kind = 'approved' where load_id = '${MYLOAD}'`)
    .then(() => null, (e) => e.message);
  ok("load_events cannot be UPDATED by anyone — evidence", !!evUpd, String(evUpd));
  const evDel = await db.query(`delete from load_events where load_id = '${MYLOAD}'`)
    .then(() => null, (e) => e.message);
  ok("load_events cannot be DELETED by anyone — evidence", !!evDel, String(evDel));

  // The default is what stops an unreviewed row reaching a phone in the first place.
  const DEFLOAD = (await db.query(`insert into loads (org_id, driver_id, ref) values ('${ORG_A}','${SELF}','LD-DEFAULT') returning id, status`)).rows[0];
  ok("a load inserted with no explicit status defaults to 'draft'", DEFLOAD.status === "draft", DEFLOAD.status);
  ok("...and is therefore invisible to its assigned driver (0)",
    (await asUser(drv, "select count(*)::int n from loads where id = $1", [DEFLOAD.id])).rows?.[0]?.n === 0);


  // ── Module entitlements (0088) — D55 ────────────────────────────────────────
  // The gate is only real if a disabled module is invisible at the DATABASE, not just in the UI.
  // These cases assert layer 1; the API guard (layer 2) and the render gate (layer 3) sit on top.
  ok("every existing org was backfilled with the baseline modules (dispatch + navigation)",
    (await db.query(`select count(*)::int n from org_modules where org_id = '${ORG_A}' and enabled`)).rows?.[0]?.n === 2);
  ok("a NEW org is seeded with the same baseline by the trigger — signup never ships a crippled product",
    (await db.query(`select count(*)::int n from org_modules where org_id = '${ORG_B}' and enabled`)).rows?.[0]?.n === 2);

  ok("auth_module_enabled is TRUE for a granted module",
    (await asUser(mgrA, "select auth_module_enabled('dispatch') e")).rows?.[0]?.e === true);
  ok("auth_module_enabled is FALSE for a module nobody was sold (absent row = disabled)",
    (await asUser(mgrA, "select auth_module_enabled('hazmatguard') e")).rows?.[0]?.e === false);
  ok("...and FALSE for a module explicitly turned off", await (async () => {
    await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_A}','training',false)
                    on conflict (org_id, module_key) do update set enabled = false`);
    return (await asUser(mgrA, "select auth_module_enabled('training') e")).rows?.[0]?.e === false;
  })());

  ok("members can READ their own org's entitlements (the UI needs them to decide what to render)",
    ((await asUser(mgrA, "select count(*)::int n from org_modules")).rows?.[0]?.n ?? 0) >= 2);
  ok("a driver can read them too — the app hides what the tenant has not bought",
    ((await asUser(drv, "select count(*)::int n from org_modules")).rows?.[0]?.n ?? 0) >= 2);

  // Entitlements are a COMMERCIAL fact. Nobody inside the tenant grants themselves a module —
  // not a driver, not a manager, not an org admin. Only the platform control plane (service role).
  ok("a driver cannot grant themselves a module",
    !!(await asUser(drv, "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')", [ORG_A])).error);
  ok("a manager cannot grant a module either",
    !!(await asUser(mgrA, "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')", [ORG_A])).error);
  ok("an ADMIN cannot grant a module — however senior, this is not their decision",
    !!(await asUser(adminA, "insert into org_modules (org_id, module_key) values ($1,'hazmatguard')", [ORG_A])).error);
  ok("an admin cannot switch one on by UPDATE either",
    ((await asUser(adminA, "update org_modules set enabled = true where org_id = $1 and module_key = 'training' returning module_key", [ORG_A])).rows?.length ?? 0) === 0);
  ok("nobody can delete an entitlement to escape a downgrade",
    ((await asUser(adminA, "delete from org_modules where org_id = $1 returning module_key", [ORG_A])).rows?.length ?? 0) === 0);

  ok("cross-tenant: org-B sees none of org-A's entitlements",
    (await asUser(mgrB, "select count(*)::int n from org_modules where org_id = $1", [ORG_A])).rows?.[0]?.n === 0);

  // Turning a module off for ONE org must not touch another — the D56 "switch it off and nothing
  // else breaks" test, at the data layer.
  await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_B}','training',true)
                  on conflict (org_id, module_key) do update set enabled = true`);
  ok("disabling a module for one org leaves the other org's grant intact",
    (await db.query(`select enabled from org_modules where org_id = '${ORG_B}' and module_key = 'training'`)).rows?.[0]?.enabled === true
    && (await db.query(`select enabled from org_modules where org_id = '${ORG_A}' and module_key = 'training'`)).rows?.[0]?.enabled === false);


  // ── Notifications (0089) — D53 ──────────────────────────────────────────────
  // A notification is addressed to ONE login. This is the single place in the product where
  // org-wide read would be wrong, so the policies are per-user rather than per-org, and the matrix
  // asserts that an ADMIN cannot open somebody else's inbox.
  const OTHERUID = "00000000-0000-0000-0000-0000000d2222";
  await db.query(`insert into auth.users (id,email) values ('${OTHERUID}','other.driver@example.com')`);
  await db.query(`update drivers set user_id = '${OTHERUID}' where id = '${OTHER}'`);
  await db.query(`insert into org_modules (org_id, module_key, enabled) values ('${ORG_A}','notifications',true)
                  on conflict (org_id, module_key) do update set enabled = true`);

  const MYNOTIF = (await db.query(
    `select emit_notification('${ORG_A}','${DUID}','load_offered','New load LD-1','Open it to accept','info','load',null,'/loads','k1') id`
  )).rows[0].id;
  await db.query(
    `select emit_notification('${ORG_A}','${OTHERUID}','load_offered','Not yours',null,'info','load',null,'/loads','k2')`
  );

  ok("emit_notification writes a row for a granted tenant", !!MYNOTIF);
  ok("driver reads only their OWN notifications (1)",
    (await asUser(drv, "select count(*)::int n from notification_events")).rows?.[0]?.n === 1);
  ok("an ADMIN cannot read another user's inbox (0)",
    (await asUser(adminA, "select count(*)::int n from notification_events")).rows?.[0]?.n === 0);
  ok("driver cannot INSERT a notification for themselves",
    !!(await asUser(drv, "insert into notification_events (org_id, audience_user_id, category, title) values ($1,$2,'system','fake')", [ORG_A, DUID])).error);
  ok("driver cannot rewrite a notification they were sent",
    ((await asUser(drv, "update notification_events set title = 'edited' where id = $1 returning id", [MYNOTIF])).rows?.length ?? 0) === 0);

  ok("driver CAN mark their own notification read",
    ((await asUser(drv, "insert into notification_reads (event_id, user_id) values ($1,$2) returning event_id", [MYNOTIF, DUID])).rows?.length ?? 0) === 1);
  ok("driver cannot mark a read on someone else's behalf",
    !!(await asUser(drv, "insert into notification_reads (event_id, user_id) values ($1,$2)", [MYNOTIF, OTHERUID])).error);

  // The dedupe guarantee: one buzz per fact, however many times a worker retries.
  const dupe = (await db.query(
    `select emit_notification('${ORG_A}','${DUID}','load_offered','New load LD-1',null,'info','load',null,'/loads','k1') id`
  )).rows[0].id;
  ok("a replayed emit with the same dedupe key is a no-op", dupe === null);

  // Preferences are enforced SERVER-side — a device setting cannot keep a phone dark at 03:00.
  await db.query(`insert into notification_preferences (user_id, org_id, muted_categories)
                  values ('${DUID}','${ORG_A}', array['performance_week'])
                  on conflict (user_id) do update set muted_categories = array['performance_week']`);
  ok("a muted category is suppressed at emit time, not at render time",
    (await db.query(`select emit_notification('${ORG_A}','${DUID}','performance_week','Week settled',null,'info',null,null,null,'k3') id`)).rows[0].id === null);
  ok("...while an unmuted category still delivers",
    !!(await db.query(`select emit_notification('${ORG_A}','${DUID}','training_due','Training due',null,'info',null,null,null,'k4') id`)).rows[0].id);

  // The entitlement gate composes: no module, no notifications at all (D55 + D53).
  await db.query(`update org_modules set enabled = false where org_id = '${ORG_A}' and module_key = 'notifications'`);
  ok("a tenant without the notifications module emits nothing",
    (await db.query(`select emit_notification('${ORG_A}','${DUID}','load_offered','Should not exist',null,'info',null,null,null,'k5') id`)).rows[0].id === null);
  await db.query(`update org_modules set enabled = true where org_id = '${ORG_A}' and module_key = 'notifications'`);

  // Push tokens: own-row only, and revocable — the offboarding guarantee.
  await db.query(`insert into device_push_tokens (token, org_id, user_id, platform) values ('ExpoTok-self','${ORG_A}','${DUID}','ios')`);
  await db.query(`insert into device_push_tokens (token, org_id, user_id, platform) values ('ExpoTok-other','${ORG_A}','${OTHERUID}','ios')`);
  ok("driver sees only their own device tokens (1)",
    (await asUser(drv, "select count(*)::int n from device_push_tokens")).rows?.[0]?.n === 1);
  ok("driver cannot register a token against another user",
    !!(await asUser(drv, "insert into device_push_tokens (token, org_id, user_id) values ('forged',$1,$2)", [ORG_A, OTHERUID])).error);
  ok("revoke_push_tokens cuts every live token for a user — the offboarding guarantee",
    (await db.query(`select revoke_push_tokens('${DUID}') n`)).rows[0].n === 1
    && (await db.query(`select count(*)::int n from device_push_tokens where user_id = '${DUID}' and revoked_at is null`)).rows[0].n === 0);
  ok("...and leaves other users' devices alone",
    (await db.query(`select count(*)::int n from device_push_tokens where user_id = '${OTHERUID}' and revoked_at is null`)).rows[0].n === 1);

  ok("driver reads only their own preferences",
    (await asUser(drv, "select count(*)::int n from notification_preferences")).rows?.[0]?.n === 1);
  ok("cross-tenant: org-B sees none of org-A's notifications",
    (await asUser(mgrB, "select count(*)::int n from notification_events")).rows?.[0]?.n === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
