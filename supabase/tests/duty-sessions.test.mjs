// FuelGuard — duty-session behaviour matrix (Driver App Phase 3A, migration 0086, D43/D44).
//
// The RLS matrix (rls.test.mjs) proves who may READ and WRITE these tables. This file proves the
// LOGIC inside the `security definer` functions the driver-scoped API calls: idempotent replay of a
// queued offline check-in, the exclusive-equipment conflicts, mid-shift drop-and-hook, take-over,
// sign-off, and the auto-close sweeper. Both run against an in-process PGlite (WASM Postgres) with
// light shims for Supabase's managed `auth`/`storage` schemas.
//
// Run:  node supabase/tests/duty-sessions.test.mjs
// Requires: pnpm add -w @electric-sql/pglite
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

// Supabase-managed objects (present in a real project; shimmed here). Kept identical to the shim in
// rls.test.mjs — the previous version stopped at (id, name, public), so every migration from 0085
// onward failed to apply and this matrix could not run at all. Keep in step when a migration starts
// writing a new bucket column.
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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
for (const f of ["migrations/0001_extensions_and_enums.sql", "migrations/0002_functions.sql", "migrations/0003_core_tables.sql", "migrations/0004_rls.sql", "migrations/0005_storage.sql", "migrations/0006_auth_hook.sql", "migrations/0007_imports.sql", "migrations/0008_ai_verifications.sql", "migrations/0009_notifications_audit_triggers.sql", "migrations/0010_detection_hardening.sql", "migrations/0011_faithful_efs_storage.sql", "migrations/0012_samsara.sql", "migrations/0013_tank_fill.sql", "migrations/0014_upsert_safe_indexes.sql", "migrations/0015_driver_samsara.sql", "migrations/0016_driver_samsara_idx.sql", "migrations/0030_trailers.sql", "migrations/0068_tms_integration.sql", "migrations/0053_driver_performance_settings.sql", "migrations/0054_driver_scores.sql", "migrations/0055_driver_performance_weeks.sql", "migrations/0083_driver_rls_matrix.sql", "migrations/0084_driver_rls_writes.sql", "migrations/0085_driver_loads.sql", "migrations/0086_duty_sessions.sql", "migrations/0143_duty_error_contract.sql", "migrations/0150_duty_timeline_and_tms_provenance.sql", "migrations/0151_end_duty_session_by_id.sql"])
  await db.exec(read(f).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const D1 = (await one(`insert into drivers (org_id,full_name) values ($1,'Driver One') returning id`, [ORG])).id;
const D2 = (await one(`insert into drivers (org_id,full_name) values ($1,'Driver Two') returning id`, [ORG])).id;
const V1 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'214','diesel',120) returning id`, [ORG])).id;
const V2 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'219','diesel',120) returning id`, [ORG])).id;
const T1 = (await one(`insert into trailers (org_id,unit_number) values ($1,'5521') returning id`, [ORG])).id;
const T2 = (await one(`insert into trailers (org_id,unit_number) values ($1,'7788') returning id`, [ORG])).id;
const u = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2,"0")}`;
const err = (p) => p.then(() => null, (e) => ({ code: e.code ?? e.message, msg: e.message }));

// 1. check-in, bobtail allowed
await db.query(`select start_duty_session($1,$2,$3,$4,$5,null,412003,null,'dev-1',false)`, [ORG,D1,u(1),u(2),V1]);
ok("check-in opens a session + segment, trailer optional",
  (await one(`select (select count(*) from driver_duty_sessions where ended_at is null)::int s,
                     (select count(*) from duty_equipment_segments where to_at is null)::int g`)).s === 1);
ok("bobtail check-in stores a null trailer",
  (await one(`select trailer_id from duty_equipment_segments where id=$1`, [u(2)])).trailer_id === null);

// 2. idempotent replay of a queued offline check-in
await db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,null,null,false)`, [ORG,D1,u(1),u(2),V1]);
ok("replayed offline check-in is a no-op, not a second shift",
  (await one(`select count(*)::int n from driver_duty_sessions`)).n === 1);

// 3. same driver, second shift -> DG003
ok("second open shift for the same driver raises DG003",
  (await err(db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,null,null,false)`, [ORG,D1,u(3),u(4),V2])))?.code === "DG003");

// 4. another driver grabbing the same truck -> DG001
ok("a truck already checked out raises DG001",
  (await err(db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,null,null,false)`, [ORG,D2,u(5),u(6),V1])))?.code === "DG001");

// 5. equipment not in org -> DG005
ok("a foreign unit raises DG005",
  (await err(db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,null,null,false)`, [ORG,D2,u(7),u(8),"00000000-0000-4000-8000-0000000000ff"])))?.code === "DG005");

// 6. hook a trailer mid-shift (no shift end)
await db.query(`select change_duty_equipment($1,$2,$3,null,$4,false,null,'hooked at shipper',false)`, [ORG,D1,u(9),T1]);
ok("hooking a trailer opens a new segment and does NOT end the shift",
  (await one(`select (select count(*) from duty_equipment_segments where session_id=$1)::int g,
                     (select count(*) from driver_duty_sessions where ended_at is null)::int s`, [u(1)])).g === 2);
ok("the earlier segment is closed, exactly one is current",
  (await one(`select count(*)::int n from duty_equipment_segments where session_id=$1 and to_at is null`, [u(1)])).n === 1);

// 7. a no-op change writes nothing
const before = (await one(`select count(*)::int n from duty_equipment_segments`)).n;
await db.query(`select change_duty_equipment($1,$2,$3,$4,$5,false,null,null,false)`, [ORG,D1,u(10),V1,T1]);
ok("a change that changes nothing writes no segment",
  (await one(`select count(*)::int n from duty_equipment_segments`)).n === before);

// 8. drop to bobtail
await db.query(`select change_duty_equipment($1,$2,$3,null,null,true,null,'dropped',false)`, [ORG,D1,u(11)]);
ok("clear_trailer records a bobtail segment",
  (await one(`select trailer_id from duty_equipment_segments where id=$1`, [u(11)])).trailer_id === null);

// 9. D2 takes over D1's truck -> D1's shift ends 'taken_over'
await db.query(`select start_duty_session($1,$2,$3,$4,$5,$6,null,null,null,true)`, [ORG,D2,u(12),u(13),V1,T2]);
const d1s = await one(`select ended_at, ended_reason from driver_duty_sessions where driver_id=$1`, [D1]);
ok("take-over ends the previous holder's shift with ended_reason='taken_over'", d1s.ended_reason === "taken_over" && d1s.ended_at !== null);
ok("take-over closes the previous holder's open segment",
  (await one(`select count(*)::int n from duty_equipment_segments where session_id=$1 and to_at is null`, [u(1)])).n === 0);
ok("the taking driver now holds the truck",
  (await one(`select s.driver_id from duty_equipment_segments g
                join driver_duty_sessions s on s.id = g.session_id
               where g.vehicle_id=$1 and g.to_at is null`, [V1])).driver_id === D2);

// 10. sign-off closes session + segment, idempotently
await db.query(`select end_duty_session($1,$2,null,412500,'driver')`, [ORG,D2]);
const d2s = await one(`select ended_at, ended_reason, end_odometer from driver_duty_sessions where driver_id=$1`, [D2]);
ok("sign-off stamps ended_at + reason + end odometer", d2s.ended_reason === "driver" && Number(d2s.end_odometer) === 412500);
ok("sign-off closes the open segment",
  (await one(`select count(*)::int n from duty_equipment_segments where to_at is null`)).n === 0);
ok("a replayed sign-off is a no-op, not an error",
  (await err(db.query(`select end_duty_session($1,$2,null,null,'driver')`, [ORG,D2]))) === null);

// 11. sweeper closes an abandoned shift with a distinguishable reason
await db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,now() - interval '20 hours',null,false)`, [ORG,D1,u(20),u(21),V2]);
const closed = (await one(`select close_stale_duty_sessions() n`)).n;
ok("sweeper closes a shift past the org timeout", closed === 1, String(closed));
ok("auto-close is distinguishable from a driver sign-off",
  (await one(`select ended_reason from driver_duty_sessions where id=$1`, [u(20)])).ended_reason === "auto_timeout");
ok("sweeper releases the truck for the next driver",
  (await one(`select count(*)::int n from duty_equipment_segments where vehicle_id=$1 and to_at is null`, [V2])).n === 0);
await db.query(`update organizations set duty_session_timeout_hours = 48 where id=$1`, [ORG]);
await db.query(`select start_duty_session($1,$2,$3,$4,$5,null,null,now() - interval '20 hours',null,false)`, [ORG,D1,u(22),u(23),V2]);
ok("sweeper respects a per-org timeout override", (await one(`select close_stale_duty_sessions() n`)).n === 0);

// ── end_duty_session_by_id (L5, migration 0151) ──────────────────────────────
//
// The board is a snapshot refetched every sixty seconds. Ending by DRIVER closes whatever is open
// now, so a driver who signs off and checks into another truck inside that window has their NEW
// shift closed by a click on a stale row — silently, and reported as success. These four assertions
// are the difference.
const L5D = (await one(`insert into drivers (org_id, full_name) values ($1,'Board Driver') returning id`, [ORG])).id;
const L5V1 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'L5-1','diesel',120) returning id`, [ORG])).id;
const L5V2 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'L5-2','diesel',120) returning id`, [ORG])).id;
const S1 = '90000000-0000-0000-0000-000000000001';
const G1 = '90000000-0000-0000-0000-000000000002';

await db.query(`insert into driver_duty_sessions (id, org_id, driver_id) values ($1,$2,$3)`, [S1, ORG, L5D]);
await db.query(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values ($1,$2,$3,$4)`,
  [G1, ORG, S1, L5V1]);

await db.query(`select end_duty_session_by_id($1,$2,null,null,'dispatch')`, [ORG, S1]);
ok("ending by session id closes that session",
  (await one(`select ended_at, ended_reason from driver_duty_sessions where id=$1`, [S1])).ended_reason === 'dispatch');
ok("...and closes the segments under it, so the truck is released",
  (await one(`select to_at from duty_equipment_segments where id=$1`, [G1])).to_at !== null);
ok("closing an already-closed session is a no-op, not an error",
  (await err(db.query(`select end_duty_session_by_id($1,$2,null,null,'dispatch')`, [ORG, S1]))) === null);

// The race the fix exists for: the driver has already started a NEW shift by the time the click lands.
const S2 = '90000000-0000-0000-0000-000000000003';
await db.query(`insert into driver_duty_sessions (id, org_id, driver_id) values ($1,$2,$3)`, [S2, ORG, L5D]);
await db.query(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values (gen_random_uuid(),$1,$2,$3)`,
  [ORG, S2, L5V2]);
await db.query(`select end_duty_session_by_id($1,$2,null,null,'dispatch')`, [ORG, S1]); // the STALE row
ok("a stale click cannot close the shift that started after the board rendered",
  (await one(`select ended_at from driver_duty_sessions where id=$1`, [S2])).ended_at === null);

const OTHERORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
ok("a session id from another org is not found (DG010)",
  (await err(db.query(`select end_duty_session_by_id($1,$2,null,null,'dispatch')`, [OTHERORG, S2])))?.code === 'DG010');

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
