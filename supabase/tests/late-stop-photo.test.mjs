// FuelGuard — migration 0645, a late photo for a stop the driver already finished (D-DV30, Q-DV7).
//
// Every migration is applied (lexical order, as production), a released load is walked to a
// completed stop the way a driver works it, and then `driver_add_stop_photos` is exercised. What must
// hold:
//   1. A late photo lands on a COMPLETED stop, and the stop itself does not change.
//   2. One `stop_photo_added` event per call that added something; an outbox replay adds nothing.
//   3. It is refused for: another driver's load, a pending/arrived/skipped stop, a canceled load, a
//      stop finished more than 14 days ago, a path outside this driver's folder, an empty list.
//   4. Only the service role may call it.
//
// Run: node supabase/tests/late-stop-photo.test.mjs

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
const num = async (q, p = []) => Number((await one(q, p)).n);
const err = (p) => p.then(() => null, (e) => ({ code: e.code ?? "?", msg: e.message }));

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
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

for (const f of ALL) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRV = (await one(`insert into drivers (org_id,full_name) values ($1,'Driver') returning id`, [ORG])).id;
const OTHER = (await one(`insert into drivers (org_id,full_name) values ($1,'Other Driver') returning id`, [ORG])).id;
const TRUCK = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'214','diesel',120) returning id`, [ORG])).id;
const APPROVER = (await one(`insert into auth.users (email) values ('dispatch@example.com') returning id`)).id;

/** A released two-stop load, accepted by DRV. Returns [loadId, pickupId, dropId]. */
async function acceptedLoad(ref) {
  const id = (await one(
    `insert into loads (org_id, driver_id, vehicle_id, ref, equipment, commodity) values ($1,$2,$3,$4,'Dry van','General freight') returning id`,
    [ORG, DRV, TRUCK, ref])).id;
  const w = `now(), now() + interval '2 hours'`;
  const pick = (await one(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end, required_photos) values ($1,$2,1,'pickup','Shipper',${w},'{seal,bol}') returning id`, [ORG, id])).id;
  const drop = (await one(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end, required_photos) values ($1,$2,2,'dropoff','Consignee',${w},'{bol}') returning id`, [ORG, id])).id;
  await db.query(`update loads set status='pending_approval' where id=$1`, [id]);
  await db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [id, APPROVER]);
  await db.query(`update loads set status='offered' where id=$1`, [id]);
  await db.query(`select driver_accept_load($1,$2,$3,null,null)`, [ORG, DRV, id]);
  return [id, pick, drop];
}
const complete = (load, stop, status = "completed", reason = "Seal photo blurry, will resend") =>
  db.query(`select driver_complete_stop($1,$2,$3,$4,$5,$6,'[]'::jsonb,null,null)`, [ORG, DRV, load, stop, status, reason]);
let n = 0;
const photo = (load, slot, over = {}) => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id, slot, storage_path: `${ORG}/${DRV}/${load}/${id}.jpg`, captured_at: new Date().toISOString(), ...over };
};
const add = (load, stop, photos, driver = DRV) =>
  db.query(`select driver_add_stop_photos($1,$2,$3,$4,$5::jsonb,null,null) as added`, [ORG, driver, load, stop, JSON.stringify(photos)]);
const events = (load) => num(`select count(*) n from load_events where load_id=$1 and kind='stop_photo_added'`, [load]);

// ── 1. a late photo lands, and the finished stop does not move ────────────────────────────────
const [L, PICK, DROP] = await acceptedLoad("LD-LATE");
await complete(L, PICK);
const before = await one(`select status, arrived_at, completed_at, skip_reason, updated_at from load_stops where id=$1`, [PICK]);
const seal = photo(L, "seal");
const first = await add(L, PICK, [seal]);
ok("a late photo is added to a completed stop, and the call says how many", first.rows[0].added === 1);
ok("...the photo row is on that stop, for that driver",
  (await num(`select count(*) n from load_stop_photos where id=$1 and stop_id=$2 and driver_id=$3`, [seal.id, PICK, DRV])) === 1);
const after = await one(`select status, arrived_at, completed_at, skip_reason, updated_at from load_stops where id=$1`, [PICK]);
ok("...and the finished stop is untouched: status, times, reason", JSON.stringify(after) === JSON.stringify(before), JSON.stringify([before, after]));
ok("...and it reads as LATE from the timestamps alone (uploaded after completion)",
  (await one(`select p.uploaded_at >= s.completed_at late from load_stop_photos p join load_stops s on s.id=p.stop_id where p.id=$1`, [seal.id])).late === true);

// ── 2. one event per addition; replays are free ───────────────────────────────────────────────
ok("one stop_photo_added event is written", (await events(L)) === 1);
const ev = await one(`select payload, actor_role from load_events where load_id=$1 and kind='stop_photo_added'`, [L]);
ok("...naming the stop, its seq, the count and the slots",
  ev.payload.stop_id === PICK && ev.payload.seq === 1 && ev.payload.photos === 1 && JSON.stringify(ev.payload.slots) === '["seal"]' && ev.actor_role === "driver",
  JSON.stringify(ev));
const replay = await add(L, PICK, [seal]);
ok("an outbox replay of the same photo adds nothing", replay.rows[0].added === 0);
ok("...and writes no second event", (await events(L)) === 1);
await add(L, PICK, [seal, photo(L, "bol")]);
ok("a later call with one new photo adds only that one and writes one more event",
  (await num(`select count(*) n from load_stop_photos where stop_id=$1`, [PICK])) === 2 && (await events(L)) === 2);

// ── 3. refusals ───────────────────────────────────────────────────────────────────────────────
ok("a stop that is not completed yet is refused (DL003): it goes through driver_complete_stop",
  (await err(add(L, DROP, [photo(L, "bol")])))?.code === "DL003");
ok("another driver cannot add to this load (DL002)",
  (await err(add(L, PICK, [photo(L, "bol", { storage_path: `${ORG}/${OTHER}/${L}/x.jpg` })], OTHER)))?.code === "DL002");
ok("a path outside this driver's folder is refused (DL010)",
  (await err(add(L, PICK, [photo(L, "bol", { storage_path: `${ORG}/${OTHER}/${L}/x.jpg` })])))?.code === "DL010");
ok("a photo with no slot is refused (DL010)", (await err(add(L, PICK, [photo(L, "")])))?.code === "DL010");
ok("an empty list is refused (DL010)", (await err(add(L, PICK, [])))?.code === "DL010");
ok("a stop that is not on this load is refused (DL005)",
  (await err(add(L, "00000000-0000-4000-8000-ffffffffffff", [photo(L, "bol")])))?.code === "DL005");

await complete(L, DROP);
ok("the load is delivered once both stops are done", (await one(`select status from loads where id=$1`, [L])).status === "delivered");
ok("...and a delivered load still takes a late photo (the usual case: the last stop)",
  (await add(L, DROP, [photo(L, "bol")])).rows[0].added === 1);

const [S] = await acceptedLoad("LD-SKIP");
const sStops = (await db.query(`select id from load_stops where load_id=$1 order by seq`, [S])).rows.map((r) => r.id);
// The pickup is completed first, so the load is under way (delivered, once the drop is skipped) and
// only the stop's own status can refuse — a skip on an unstarted load would be refused by the LOAD's
// status and prove nothing about skipped stops (caught by mutation, 2026-11-24).
await complete(S, sStops[0]);
await complete(S, sStops[1], "skipped", "Consignee closed");
ok("a skipped stop is refused (DL003): it was never visited",
  (await err(add(S, sStops[1], [photo(S, "bol")])))?.code === "DL003");

const [OLD, OLD_PICK] = await acceptedLoad("LD-OLD");
await complete(OLD, OLD_PICK);
await db.query(`update load_stops set completed_at = now() - interval '15 days' where id=$1`, [OLD_PICK]);
ok("a stop finished more than 14 days ago is refused (DL007)",
  (await err(add(OLD, OLD_PICK, [photo(OLD, "seal")])))?.code === "DL007");
await db.query(`update load_stops set completed_at = now() - interval '13 days' where id=$1`, [OLD_PICK]);
ok("...and one finished 13 days ago is not", (await add(OLD, OLD_PICK, [photo(OLD, "seal")])).rows[0].added === 1);

const [CX, CX_PICK] = await acceptedLoad("LD-CANCEL");
await complete(CX, CX_PICK);
await db.query(`update loads set status='canceled' where id=$1`, [CX]);
ok("a canceled load is refused (DL003)", (await err(add(CX, CX_PICK, [photo(CX, "seal")])))?.code === "DL003");

// ── 4. who may call it ───────────────────────────────────────────────────────────────────────
const grants = (await db.query(
  `select grantee from information_schema.routine_privileges where routine_name='driver_add_stop_photos' and privilege_type='EXECUTE'`)).rows.map((r) => r.grantee);
ok("only the service role may execute it (not anon, not authenticated)",
  grants.includes("service_role") && !grants.includes("anon") && !grants.includes("authenticated") && !grants.includes("PUBLIC"),
  JSON.stringify(grants));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
