// FuelGuard — load lifecycle behaviour matrix (Driver App Phase 3B, migration 0087, D45–D47).
//
// The RLS matrix (rls.test.mjs) proves the approval GATE — who can see what. This file proves the
// LOGIC: the transition guard's legal moves and its three gates, and the four `security definer`
// driver functions (accept / decline / start / complete-stop) including the two implicit transitions
// that close defect F1 ("in_transit was unreachable").
//
// Run:  node supabase/tests/load-lifecycle.test.mjs
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
const err = (p) => p.then(() => null, (e) => ({ code: e.code ?? "?", msg: e.message }));

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

for (const f of ["migrations/0001_extensions_and_enums.sql","migrations/0002_functions.sql","migrations/0003_core_tables.sql","migrations/0004_rls.sql","migrations/0005_storage.sql","migrations/0006_auth_hook.sql","migrations/0030_trailers.sql","migrations/0068_tms_integration.sql","migrations/0053_driver_performance_settings.sql","migrations/0054_driver_scores.sql","migrations/0055_driver_performance_weeks.sql","migrations/0083_driver_rls_matrix.sql","migrations/0084_driver_rls_writes.sql","migrations/0085_driver_loads.sql","migrations/0086_duty_sessions.sql","migrations/0087_load_lifecycle.sql","migrations/0141_driver_load_rpc_contract.sql","migrations/0142_load_approval_separation.sql","migrations/0088_module_entitlements.sql","migrations/0092_hazmat_core.sql","migrations/0148_hazmat_load_link.sql","migrations/0150_duty_timeline_and_tms_provenance.sql"])
  await db.exec(read(f).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const CO = (await one(`insert into drivers (org_id,full_name) values ($1,'Company Driver') returning id`, [ORG])).id;
const OO = (await one(`insert into drivers (org_id,full_name,driver_type) values ($1,'Owner Operator','owner_operator') returning id`, [ORG])).id;
const V1 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'214','diesel',120) returning id`, [ORG])).id;
const V2 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'219','diesel',120) returning id`, [ORG])).id;
const T1 = (await one(`insert into trailers (org_id,unit_number) values ($1,'5521') returning id`, [ORG])).id;

/** A complete, approvable load with two stops and appointment windows. */
async function makeLoad(ref, driver, { vehicle = V1, appts = true, drop = true } = {}) {
  const id = (await one(
    `insert into loads (org_id, driver_id, vehicle_id, ref, equipment, commodity) values ($1,$2,$3,$4,'Dry van','General freight') returning id`,
    [ORG, driver, vehicle, ref])).id;
  const w = appts ? `now(), now() + interval '2 hours'` : `null, null`;
  await db.query(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end, required_photos) values ('${ORG}','${id}',1,'pickup','Shipper',${w},'{trailer,bol}')`);
  if (drop) await db.query(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end, required_photos) values ('${ORG}','${id}',2,'dropoff','Consignee',${w},'{bol}')`);
  return id;
}
const APPROVER = (await one(`insert into auth.users (email) values ('dispatch@example.com') returning id`)).id;
const CREATOR = (await one(`insert into auth.users (email) values ('planner@example.com') returning id`)).id;

/** Walk a load all the way to 'offered' the way dispatch would. */
async function release(id) {
  await db.query(`update loads set status='pending_approval' where id=$1`, [id]);
  await db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [id, APPROVER]);
  await db.query(`update loads set status='offered' where id=$1`, [id]);
}

// ── the guard ────────────────────────────────────────────────────────────────
const L1 = await makeLoad("LD-1", CO);
ok("default status is draft", (await one(`select status from loads where id=$1`, [L1])).status === "draft");
ok("draft -> in_transit is rejected (DL010)",
  (await err(db.query(`update loads set status='in_transit' where id=$1`, [L1])))?.code === "DL010");
ok("draft -> pending_approval is allowed",
  (await err(db.query(`update loads set status='pending_approval' where id=$1`, [L1]))) === null);
ok("submitted_at is stamped on submit", (await one(`select submitted_at from loads where id=$1`, [L1])).submitted_at !== null);
ok("approve without approved_by is rejected (DL011)",
  (await err(db.query(`update loads set status='approved' where id=$1`, [L1])))?.code === "DL011");
ok("approve with approved_by is allowed, and stamps approved_at",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L1, APPROVER]))) === null
  && (await one(`select approved_at from loads where id=$1`, [L1])).approved_at !== null);
ok("release stamps released_at",
  (await err(db.query(`update loads set status='offered' where id=$1`, [L1]))) === null
  && (await one(`select released_at from loads where id=$1`, [L1])).released_at !== null);

const L2 = await makeLoad("LD-2", CO, { drop: false });
await db.query(`update loads set status='pending_approval' where id=$1`, [L2]);
ok("approve with no dropoff is rejected (DL011)",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L2, APPROVER])))?.code === "DL011");

const L3 = await makeLoad("LD-3", CO, { appts: false });
await db.query(`update loads set status='pending_approval' where id=$1`, [L3]);
ok("approve with a missing appointment window is rejected (DL011)",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L3, APPROVER])))?.code === "DL011");

const L4 = await makeLoad("LD-4", CO, { vehicle: null });
await db.query(`update loads set status='pending_approval' where id=$1`, [L4]);
ok("approve with no truck is rejected (DL011)",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L4, APPROVER])))?.code === "DL011");

// separation of duties, off by default
const L5 = await makeLoad("LD-5", CO);
await db.query(`update loads set created_by=$2 where id=$1`, [L5, CREATOR]);
await db.query(`update loads set status='pending_approval' where id=$1`, [L5]);
ok("with separation OFF, the creator may approve their own load",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L5, CREATOR]))) === null);
await db.query(`update organizations set require_separate_approver = true where id=$1`, [ORG]);
const L6 = await makeLoad("LD-6", CO);
await db.query(`update loads set created_by=$2 where id=$1`, [L6, CREATOR]);
await db.query(`update loads set status='pending_approval' where id=$1`, [L6]);
ok("with separation ON, the creator may NOT approve their own load (DL011)",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L6, CREATOR])))?.code === "DL011");
ok("...but another approver may",
  (await err(db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [L6, APPROVER]))) === null);
await db.query(`update organizations set require_separate_approver = false where id=$1`, [ORG]);

// ── accept ───────────────────────────────────────────────────────────────────
const A1 = await makeLoad("LD-A1", CO); await release(A1);
ok("cannot accept a load that is not yours (DL002)",
  (await err(db.query(`select driver_accept_load($1,$2,$3)`, [ORG, OO, A1])))?.code === "DL002");
await db.query(`select driver_accept_load($1,$2,$3,$4)`, [ORG, CO, A1, APPROVER]);
ok("accept moves the load to 'accepted' and stamps accepted_at", (async () => true)() &&
  (await one(`select status, accepted_at from loads where id=$1`, [A1])).status === "accepted");
ok("accept writes an 'accepted' event",
  (await one(`select count(*)::int n from load_events where load_id=$1 and kind='accepted'`, [A1])).n === 1);
ok("a replayed accept is idempotent — no second event",
  (await err(db.query(`select driver_accept_load($1,$2,$3)`, [ORG, CO, A1]))) === null
  && (await one(`select count(*)::int n from load_events where load_id=$1 and kind='accepted'`, [A1])).n === 1);
const A2 = await makeLoad("LD-A2", CO);
ok("cannot accept a load that was never released (DL001)",
  (await err(db.query(`select driver_accept_load($1,$2,$3)`, [ORG, CO, A2])))?.code === "DL001");

// ── D47: equipment mismatch flags, never blocks ──────────────────────────────
const S1 = "00000000-0000-4000-8000-00000000c001", G1 = "00000000-0000-4000-8000-00000000c002";
await db.query(`select start_duty_session($1,$2,$3,$4,$5,$6)`, [ORG, CO, S1, G1, V2, T1]); // in 219, plan says 214
const A3 = await makeLoad("LD-A3", CO); await release(A3);
await db.query(`select driver_accept_load($1,$2,$3,$4)`, [ORG, CO, A3, APPROVER]);
ok("accepting in a different truck still succeeds — never blocked",
  (await one(`select status from loads where id=$1`, [A3])).status === "accepted");
ok("...and writes an equipment_mismatch event",
  (await one(`select count(*)::int n from load_events where load_id=$1 and kind='equipment_mismatch'`, [A3])).n === 1);
ok("...and stamps the duty session onto the load",
  (await one(`select duty_session_id from loads where id=$1`, [A3])).duty_session_id === S1);
ok("...and does NOT overwrite dispatch's plan",
  (await one(`select vehicle_id from loads where id=$1`, [A3])).vehicle_id === V1);

// ── D46: one mechanism, two semantics ────────────────────────────────────────
const D1 = await makeLoad("LD-D1", CO); await release(D1);
await db.query(`select driver_decline_load($1,$2,$3,$4)`, [ORG, CO, D1, "hours_of_service"]);
const d1 = await one(`select status, driver_id, decline_reason from loads where id=$1`, [D1]);
ok("company driver decline logs the exception but does NOT unassign", d1.status === "offered" && d1.driver_id === CO);
ok("...and records the reason", d1.decline_reason === "hours_of_service");

const D2 = await makeLoad("LD-D2", OO); await release(D2);
await db.query(`select driver_decline_load($1,$2,$3,$4)`, [ORG, OO, D2, "rate_distance"]);
const d2 = await one(`select status, driver_id, released_at from loads where id=$1`, [D2]);
ok("owner-operator decline returns the load to the dispatch queue", d2.status === "approved" && d2.driver_id === null);
ok("...and clears the release stamp so it must be re-released", d2.released_at === null);
ok("...and both declines write a 'declined' event",
  (await one(`select count(*)::int n from load_events where kind='declined'`)).n === 2);

// ── F1: in_transit is reachable, both explicitly and implicitly ──────────────
const W1 = await makeLoad("LD-W1", CO); await release(W1);
await db.query(`select driver_accept_load($1,$2,$3)`, [ORG, CO, W1]);
await db.query(`select driver_start_load($1,$2,$3)`, [ORG, CO, W1]);
ok("explicit start moves accepted -> in_transit (F1 closed)",
  (await one(`select status from loads where id=$1`, [W1])).status === "in_transit");

const W2 = await makeLoad("LD-W2", CO); await release(W2);
await db.query(`select driver_accept_load($1,$2,$3)`, [ORG, CO, W2]);
const w2stop1 = (await one(`select id from load_stops where load_id=$1 and seq=1`, [W2])).id;
const w2stop2 = (await one(`select id from load_stops where load_id=$1 and seq=2`, [W2])).id;
const photos = (ids) => JSON.stringify(ids.map(([id, slot]) => ({ id, slot, storage_path: `${ORG}/${CO}/${W2}/${id}.webp` })));

ok("completing a stop with a required photo missing and no reason is rejected (DL006)",
  (await err(db.query(`select driver_complete_stop($1,$2,$3,$4,'completed')`, [ORG, CO, W2, w2stop1])))?.code === "DL006");
await db.query(`select driver_complete_stop($1,$2,$3,$4,'completed',null,$5::jsonb)`,
  [ORG, CO, W2, w2stop1, photos([["00000000-0000-4000-8000-00000000d001", "trailer"], ["00000000-0000-4000-8000-00000000d002", "bol"]])]);
ok("working the first stop implicitly moves the load to in_transit (F1)",
  (await one(`select status from loads where id=$1`, [W2])).status === "in_transit");
ok("...and records both photos",
  (await one(`select count(*)::int n from load_stop_photos where stop_id=$1`, [w2stop1])).n === 2);
ok("...and writes a stop_completed event plus the implicit 'started'",
  (await one(`select count(*)::int n from load_events where load_id=$1 and kind in ('stop_completed','started')`, [W2])).n === 2);
ok("a replayed stop sync does not double-post photos (client-UUID PK)",
  (await err(db.query(`select driver_complete_stop($1,$2,$3,$4,'completed',null,$5::jsonb)`,
    [ORG, CO, W2, w2stop1, photos([["00000000-0000-4000-8000-00000000d001", "trailer"], ["00000000-0000-4000-8000-00000000d002", "bol"]])]))) === null
  && (await one(`select count(*)::int n from load_stop_photos where stop_id=$1`, [w2stop1])).n === 2);

ok("a missing photo WITH a reason is allowed — never a dead end (D21)",
  (await err(db.query(`select driver_complete_stop($1,$2,$3,$4,'completed','seal was already broken on arrival','[]'::jsonb)`,
    [ORG, CO, W2, w2stop2]))) === null);
ok("resolving the last stop moves the load to delivered",
  (await one(`select status, completed_at from loads where id=$1`, [W2])).status === "delivered");
ok("...and writes a 'completed' event",
  (await one(`select count(*)::int n from load_events where load_id=$1 and kind='completed'`, [W2])).n === 1);
ok("a delivered load is terminal — cannot be reopened (DL010)",
  (await err(db.query(`update loads set status='in_transit' where id=$1`, [W2])))?.code === "DL010");
ok("cannot work a stop on a delivered load (DL003)",
  (await err(db.query(`select driver_complete_stop($1,$2,$3,$4,'completed')`, [ORG, CO, W2, w2stop2])))?.code === "DL003");

const X = await makeLoad("LD-X", CO); await release(X);
await db.query(`select driver_accept_load($1,$2,$3)`, [ORG, CO, X]);
const foreignStop = (await one(`select id from load_stops where load_id=$1 limit 1`, [W1])).id;
ok("cannot record a stop that belongs to another load (DL005)",
  (await err(db.query(`select driver_complete_stop($1,$2,$3,$4,'completed')`, [ORG, CO, X, foreignStop])))?.code === "DL005");

// ── resolve_driver_type ──────────────────────────────────────────────────────
ok("driver_type falls back to the org default", (await one(`select resolve_driver_type($1) t`, [CO])).t === "company");
ok("a per-driver override wins", (await one(`select resolve_driver_type($1) t`, [OO])).t === "owner_operator");
await db.query(`update organizations set default_driver_type='owner_operator' where id=$1`, [ORG]);
ok("changing the org default moves un-overridden drivers", (await one(`select resolve_driver_type($1) t`, [CO])).t === "owner_operator");

// ── the hazmat link (H-C1, migration 0148) ───────────────────────────────────
//
// `loads` and `hazmat_loads` were two parallel load entities with nothing between them. These
// assertions are the invariant that makes one a property of the other rather than a second product:
// a dispatch load has at most ONE current hazmat record, the link moves forward when a cleared record
// is superseded and corrected, and it cannot be taken by anything else.
const HZ = (n) => `900${n}0000-0000-0000-0000-000000000001`;
const mkHazmat = async (id, org = ORG, supersedes = null) =>
  (await one(
    `insert into hazmat_loads (id, org_id, supersedes_load_id) values ($1,$2,$3) returning id`,
    [id, org, supersedes])).id;

const HL = await makeLoad("LD-HZ", CO);
const H1 = await mkHazmat(HZ(1));
await db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG, H1, HL]);
ok("linking points the hazmat record at the dispatch load",
  (await one(`select load_id from hazmat_loads where id=$1`, [H1])).load_id === HL);
ok("...and flips loads.hazmat, so the board and the record cannot disagree",
  (await one(`select hazmat from loads where id=$1`, [HL])).hazmat === true);

const H2 = await mkHazmat(HZ(2));
ok("an unrelated hazmat record cannot claim a load that is already linked (HZ003)",
  (await err(db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG, H2, HL])))?.code === "HZ003");
ok("...and the original link is untouched",
  (await one(`select load_id from hazmat_loads where id=$1`, [H1])).load_id === HL);

// A cleared hazmat load is immutable; a correction is a NEW row citing supersedes_load_id. Without
// this the partial unique index would make every correction unlinkable.
const H3 = await mkHazmat(HZ(3), ORG, H1);
await db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG, H3, HL]);
ok("a superseding record takes the link forward",
  (await one(`select load_id from hazmat_loads where id=$1`, [H3])).load_id === HL);
ok("...and the record it superseded is released, keeping one current record per load",
  (await one(`select load_id from hazmat_loads where id=$1`, [H1])).load_id === null);
ok("re-linking the SAME pair is a no-op, not an error (idempotent replay)",
  (await err(db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG, H3, HL]))) === null);

const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const HB = await mkHazmat(HZ(4), ORG_B);
ok("a hazmat record from another tenant is simply not found (HZ001)",
  (await err(db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG, HB, HL])))?.code === "HZ001");
ok("and another tenant cannot reach this org's load either (HZ002)",
  (await err(db.query(`select * from link_hazmat_load($1,$2,$3)`, [ORG_B, HB, HL])))?.code === "HZ002");
ok("the composite FK refuses a cross-tenant link written directly",
  (await err(db.query(`update hazmat_loads set load_id=$1 where id=$2`, [HL, HB]))) !== null);

// Retention outlives dispatch: deleting the dispatch row must release the link, never cascade into
// the hazmat record, which is evidence.
await db.query(`delete from loads where id=$1`, [HL]);
ok("deleting the dispatch load releases the link",
  (await one(`select load_id from hazmat_loads where id=$1`, [H3])).load_id === null);
ok("...and the hazmat record itself survives",
  (await one(`select count(*)::int n from hazmat_loads where id=$1`, [H3])).n === 1);

// ── the duty equipment timeline (LD5, migration 0150) ────────────────────────
//
// D43 made the duty segment the truth about equipment. Three rules have to hold or attribution is
// quietly wrong, and "quietly" is the problem: a mis-attributed week of fuel looks like data.
const SESS = '80000000-0000-0000-0000-000000000001';
const SEG1 = '80000000-0000-0000-0000-000000000002';
const SEG2 = '80000000-0000-0000-0000-000000000003';
const at = (h) => `2026-08-08T${String(h).padStart(2, '0')}:00:00Z`;

// A fresh driver: `idx_duty_sessions_one_open_per_driver` allows one open shift per driver, and the
// duty assertions above already left one open on CO. That index is doing its job.
// Fresh driver AND fresh equipment: two partial-unique indexes from 0086 are in force — one open
// shift per driver, one driver-seat holder per truck — and the duty assertions above are still
// holding V1/V2. Both indexes doing their job is why this block brings its own.
const TLD = (await one(`insert into drivers (org_id, full_name) values ($1,'Timeline Driver') returning id`, [ORG])).id;
const TLV1 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'TL-1','diesel',120) returning id`, [ORG])).id;
const TLV2 = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'TL-2','diesel',120) returning id`, [ORG])).id;
const TLT1 = (await one(`insert into trailers (org_id,unit_number) values ($1,'TL-T1') returning id`, [ORG])).id;

await db.query(
  `insert into driver_duty_sessions (id, org_id, driver_id, started_at) values ($1,$2,$3,$4)`,
  [SESS, ORG, TLD, at(6)]);
await db.query(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, trailer_id, from_at, to_at)
   values ($1,$2,$3,$4,$5,$6,$7)`,
  [SEG1, ORG, SESS, TLV1, TLT1, at(6), at(12)]);
// Deliberately backdated before the shift started — an offline replay can produce exactly this.
await db.query(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, trailer_id, from_at, to_at)
   values ($1,$2,$3,$4,null,$5,null)`,
  [SEG2, ORG, SESS, TLV2, at(1)]);

const covering = async (t) =>
  (await db.query(
    `select vehicle_id, trailer_id from driver_equipment_timeline
      where driver_id = $1 and from_at <= $2 and (to_at is null or to_at > $2)
      order by from_at desc limit 1`, [TLD, t])).rows[0];

ok("a segment cannot start before its own shift did",
  (await one(`select from_at from driver_equipment_timeline where segment_id = $1`, [SEG2])).from_at.toISOString().startsWith('2026-08-08T06:00'));
ok("the covering segment at 08:00 is the first truck",
  (await covering(at(8)))?.vehicle_id === TLV1);
ok("the boundary belongs to the NEXT segment, not both",
  (await covering(at(12)))?.vehicle_id === TLV2);
ok("an open segment under an open shift stays open",
  (await one(`select to_at from driver_equipment_timeline where segment_id = $1`, [SEG2])).to_at === null);

// Ending the shift closes every segment under it, whether or not anyone wrote to_at. Without this
// rule a forgotten sign-off attributes a truck to a driver indefinitely.
await db.query(`update driver_duty_sessions set ended_at = $2, ended_reason = 'auto_timeout' where id = $1`, [SESS, at(18)]);
ok("ending the shift closes an open segment at the shift's end",
  (await one(`select to_at from driver_equipment_timeline where segment_id = $1`, [SEG2])).to_at.toISOString().startsWith('2026-08-08T18:00'));
ok("...and nothing is attributed after it",
  (await covering(at(19))) === undefined);
ok("a segment that ended BEFORE the shift keeps its own end",
  (await one(`select to_at from driver_equipment_timeline where segment_id = $1`, [SEG1])).to_at.toISOString().startsWith('2026-08-08T12:00'));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
