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
    "driver INSERT fuel_transaction allowed",
    (
      await asUser(
        driverA,
        "insert into fuel_transactions (org_id,fueled_at,gallons) values ($1,now(),10) returning id",
        [ORG_A],
      )
    ).rows?.length === 1,
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

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
