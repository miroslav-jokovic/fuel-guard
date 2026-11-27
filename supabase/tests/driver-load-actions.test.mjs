// Silvicom 360 — the driver can WORK the McLeod load 0655 lets him SEE (migration 0661, M-A;
// docs/plans/mcleod/v2/T1-driver-and-data.md N-8; D-MK19, D-MK20, D-MK21, D-MK23).
//
// What must hold, by group (the titles are the plan's, verbatim):
//   · visibility = action door — the driver functions admit exactly whom 0655's policies show, from
//     one definition (driver_visible_tms_load_ids), at the same five statuses;
//   · late evidence — a driver the load was taken from keeps his proof of work: stored, flagged, and
//     nothing of the current holder's touched; a driver never dispatched is still refused;
//   · replays — the outbox record id makes every action a one-time event, and an id reused for a
//     different action is refused (DL012);
//   · team and photos — the two seats of a team never meet DL003 for each other's work;
//   · a McLeod load's status stays McLeod's; "Got it"; late photos; the signatures.
//
// Run:  node supabase/tests/driver-load-actions.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

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
`);
for (const f of ALL) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier') returning id`)).id;
const SENDER = (await one(`insert into auth.users (email) values ('dispatch@carrier.test') returning id`)).id;
const user = async (email) => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
const driver = async (name, extra = {}) =>
  (await one(
    `insert into drivers (org_id, full_name, status, user_id, driver_type) values ($1,$2,'active',$3,$4) returning id`,
    [ORG, name, extra.user ?? null, extra.type ?? null])).id;
const U_D1 = await user("d1@carrier.test");
const U_CO = await user("co@carrier.test");
const D1 = await driver("Seat Driver", { user: U_D1 });
const CO = await driver("Co Driver", { user: U_CO });
const D2 = await driver("Repower Driver");
const D3 = await driver("Sent Driver");
const NEVER = await driver("Never Dispatched");
const OO = await driver("Owner Operator", { type: "owner_operator" });
const TRUCK = (await one(`insert into vehicles (org_id,unit_number,fuel_type,tank_capacity_gal) values ($1,'214','diesel',120) returning id`, [ORG])).id;

let seq = 0;
/** A McLeod load with two stops, seated as McLeod seats it. */
async function tmsLoad({ status = "in_transit", seat = D1, co = null } = {}) {
  seq++;
  const id = (await one(
    `insert into loads (org_id, ref, status, source, provider, external_id, driver_id, co_driver_id)
     values ($1, $2, $3, 'tms', 'mcleod', $2, $4, $5) returning id`,
    [ORG, `TMS:M${seq}`, status, seat, co])).id;
  const stops = [];
  for (const s of [1, 2]) {
    stops.push((await one(
      `insert into load_stops (org_id, load_id, seq, kind, name, mcleod_stop_id) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ORG, id, s, s === 1 ? "pickup" : "dropoff", s === 1 ? "Shipper" : "Consignee", `S${seq}-${s}`])).id);
  }
  return [id, ...stops];
}
let sentAgo = 1000;
/** The office presses Send. Each later call is a later send. */
const send = async (load, drv) =>
  (await one(
    `insert into load_dispatches (org_id, load_id, driver_id, sent_by, channel, outcome, outcome_reason, body, sent_at)
     values ($1,$2,$3,$4,'app','sent',null,'Load',now() - make_interval(mins => $5)) returning id`,
    [ORG, load, drv, SENDER, sentAgo--])).id;

/** A manual load walked to `offered` the way dispatch does it (load-lifecycle.test.mjs's makeLoad + release). */
async function manualLoad(drv, ref) {
  const id = (await one(
    `insert into loads (org_id, driver_id, vehicle_id, ref, equipment, commodity) values ($1,$2,$3,$4,'Dry van','General freight') returning id`,
    [ORG, drv, TRUCK, ref])).id;
  const w = `now(), now() + interval '2 hours'`;
  const a = (await one(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end) values ($1,$2,1,'pickup','Shipper',${w}) returning id`, [ORG, id])).id;
  const b = (await one(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end) values ($1,$2,2,'dropoff','Consignee',${w}) returning id`, [ORG, id])).id;
  await db.query(`update loads set status='pending_approval' where id=$1`, [id]);
  await db.query(`update loads set status='approved', approved_by=$2 where id=$1`, [id, SENDER]);
  await db.query(`update loads set status='offered' where id=$1`, [id]);
  return [id, a, b];
}

/** Named-argument call, the way the API's runRpc calls (driverLoads.ts). */
const call = async (fn, args) => {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  return (await db.query(sql, keys.map((k) => args[k]))).rows[0].r;
};
const stop = (drv, load, s, status, more = {}) =>
  call("driver_complete_stop", { p_org: ORG, p_driver: drv, p_load: load, p_stop: s, p_status: status, ...more });
const ack = (drv, load, id) => call("driver_acknowledge_load", { p_org: ORG, p_driver: drv, p_load: load, p_action_id: id });
const photo = (drv, load, slot, over = {}) => {
  const id = randomUUID();
  return { id, slot, storage_path: `${ORG}/${drv}/${load}/${id}.jpg`, captured_at: new Date().toISOString(), ...over };
};
const stopRow = (s) => one(`select status, arrived_at, completed_at, skip_reason, updated_at from load_stops where id=$1`, [s]);
const loadRow = (l) => one(`select status, driver_id, co_driver_id, updated_at, completed_at from loads where id=$1`, [l]);
const events = (l, kind) => num(`select count(*) n from load_events where load_id=$1 and kind=$2`, [l, kind]);
const HEX = "a".repeat(64);

// ── visibility = action door ────────────────────────────────────────────────────────────────────
{
  const [L, S1] = await tmsLoad({ seat: D1, co: CO });
  await send(L, D1);
  const r = await err(stop(CO, L, S1, "completed"));
  ok("the co-driver of a sent McLeod load may complete its stops",
    r === null && (await stopRow(S1)).status === "completed", JSON.stringify(r));
}
{
  const [L, S1] = await tmsLoad({ seat: D1 });
  await send(L, D3);
  const r = await stop(D3, L, S1, "arrived").catch((e) => ({ code: e.code }));
  ok("a driver the office sent a load McLeod seats on someone else may work it", r?.status === "recorded", JSON.stringify(r));
}
{
  const [L, S1] = await tmsLoad({ status: "pending_approval", seat: D1 });
  await send(L, D1);
  const r = await stop(D1, L, S1, "arrived").catch((e) => ({ code: e.code }));
  ok("a sent load at pending_approval can be worked", r?.status === "recorded", JSON.stringify(r));
}
{
  const [L, S1] = await tmsLoad({ seat: D1, co: CO });
  const a = await err(stop(D1, L, S1, "completed"));
  ok("an unsent McLeod load is refused to its McLeod driver (DL002)",
    a?.code === "DL002" && (await stopRow(S1)).status === "pending", JSON.stringify(a));
}
{
  const [L] = await tmsLoad({ seat: D1, co: CO });
  await send(L, D1);
  const [L2] = await tmsLoad({ seat: D2 });
  await send(L2, D1);
  const same = async (u, drv) => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: u, org_id: ORG, user_role: "driver" })]);
    const viaAuth = (await db.query(`select x from public.auth_visible_tms_load_ids() x order by 1`)).rows.map((r) => r.x);
    const viaSvc = (await db.query(`select x from public.driver_visible_tms_load_ids($1,$2) x order by 1`, [ORG, drv])).rows.map((r) => r.x);
    return { viaAuth, viaSvc };
  };
  const d1 = await same(U_D1, D1);
  const co = await same(U_CO, CO);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  ok("driver_visible_tms_load_ids answers what auth_visible_tms_load_ids answers, for both seats",
    d1.viaAuth.length >= 2 && co.viaAuth.length >= 1 && co.viaAuth.includes(L) && !co.viaAuth.includes(L2)
      && JSON.stringify(d1.viaAuth) === JSON.stringify(d1.viaSvc) && JSON.stringify(co.viaAuth) === JSON.stringify(co.viaSvc),
    JSON.stringify({ d1, co }));
}
{
  // The shared constant, read from its source — the action door must not keep a second list.
  const src = readFileSync(join(SUPA, "..", "packages", "shared", "src", "loadsLifecycle.ts"), "utf8");
  const block = src.match(/export const TMS_DRIVER_VISIBLE_STATUSES = \[([\s\S]*?)\]/)[1];
  const shared = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const def = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'loads_status_check'`)).d;
  const every = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  const current = [];
  for (const status of every) {
    // The status guard allows a McLeod load to be CREATED only at some statuses; the mirror moves it to
    // the rest. Replica mode skips the guard for this one insert, so every status the CHECK allows is asked.
    await db.exec(`set session_replication_role = replica`);
    const [L] = await tmsLoad({ status, seat: D1 });
    await db.exec(`set session_replication_role = origin`);
    await send(L, D1);
    if ((await one(`select public.driver_load_access($1,$2,$3) a`, [ORG, D1, L])).a === "current") current.push(status);
  }
  ok("the action door's statuses are TMS_DRIVER_VISIBLE_STATUSES",
    shared.length === 5 && JSON.stringify(current.sort()) === JSON.stringify(shared), JSON.stringify({ shared, current }));
}

// ── late evidence ───────────────────────────────────────────────────────────────────────────────
{
  const [L, S1] = await tmsLoad({ seat: D1 });
  await send(L, D1);
  await send(L, D3);
  const beforeStop = await stopRow(S1);
  const beforeLoad = await loadRow(L);
  const p = photo(D1, L, "bol", { sha256: HEX });
  const id = randomUUID();
  const r = await stop(D1, L, S1, "completed", { p_photos: JSON.stringify([p]), p_action_id: id });
  const ev = await one(`select kind, payload from load_events where id=$1`, [id]);
  ok("evidence from a driver the load was re-dispatched away from is stored and flagged",
    r?.status === "late_evidence"
      && (await num(`select count(*) n from load_stop_photos where id=$1 and sha256=$2`, [p.id, HEX])) === 1
      && ev?.kind === "stop_completed" && ev.payload.late_evidence === true && ev.payload.late_reason === "not_current_driver",
    JSON.stringify({ r, ev }));
  ok("late evidence changes no stop or load column",
    JSON.stringify(await stopRow(S1)) === JSON.stringify(beforeStop) && JSON.stringify(await loadRow(L)) === JSON.stringify(beforeLoad));
  const never = await err(stop(NEVER, L, S1, "completed"));
  ok("a driver never dispatched this load is still refused (DL002)", never?.code === "DL002", JSON.stringify(never));
}
{
  const [L, S1] = await tmsLoad({ seat: D1 });
  await send(L, D1);
  await db.query(`update loads set driver_id=$2 where id=$1`, [L, D2]);   // McLeod repowers…
  await send(L, D2);                                                       // …and the office re-sends
  const r = await stop(D1, L, S1, "arrived").catch((e) => ({ code: e.code }));
  ok("…after a McLeod repower changed the seats",
    r?.status === "late_evidence" && (await stopRow(S1)).arrived_at === null, JSON.stringify(r));
}
{
  const [L, S1] = await tmsLoad({ seat: D1, co: CO });
  await send(L, D1);
  await ack(CO, L, randomUUID());
  await db.query(`update loads set co_driver_id=null where id=$1`, [L]);   // McLeod takes the second seat away
  const r = await stop(CO, L, S1, "completed").catch((e) => ({ code: e.code }));
  ok("…from the co-driver who had acknowledged it", r?.status === "late_evidence", JSON.stringify(r));
}
{
  const [L, S1] = await tmsLoad({ seat: D1 });
  await send(L, D1);
  await db.query(`update load_stops set mcleod_removed_at = now() where id=$1`, [S1]);
  const id = randomUUID();
  const r = await stop(D1, L, S1, "completed", { p_action_id: id }).catch((e) => ({ code: e.code }));
  const ev = await one(`select payload from load_events where id=$1`, [id]);
  ok("evidence for a stop McLeod removed is stored and flagged, never DL005",
    r?.status === "late_evidence" && ev?.payload.late_reason === "removed_in_mcleod" && (await stopRow(S1)).status === "pending",
    JSON.stringify({ r, ev }));
}

// ── replays ─────────────────────────────────────────────────────────────────────────────────────
{
  const [L] = await manualLoad(D1, "MAN-DECLINE");
  const id = randomUUID();
  const args = { p_org: ORG, p_driver: D1, p_load: L, p_reason: "hours_of_service", p_action_id: id };
  await call("driver_decline_load", args);
  const again = await err(call("driver_decline_load", args));
  ok("a replayed decline writes one declined event, not two", again === null && (await events(L, "declined")) === 1,
    JSON.stringify({ again, n: await events(L, "declined") }));
}
{
  const [L] = await manualLoad(OO, "MAN-OO");
  const args = { p_org: ORG, p_driver: OO, p_load: L, p_reason: "rate_distance", p_action_id: randomUUID() };
  await call("driver_decline_load", args);
  const again = await err(call("driver_decline_load", args));
  ok("a replayed owner-operator decline is a no-op, not DL002",
    again === null && (await events(L, "declined")) === 1 && (await loadRow(L)).driver_id === null, JSON.stringify(again));
}
{
  const [L, S1, S2] = await manualLoad(D1, "MAN-REPLAY");
  const accept = randomUUID();
  await call("driver_accept_load", { p_org: ORG, p_driver: D1, p_load: L, p_action_id: accept });
  ok("the primary event's id is the action id",
    (await one(`select kind from load_events where id=$1`, [accept]))?.kind === "accepted");
  const arrive = randomUUID();
  await stop(D1, L, S1, "arrived", { p_action_id: arrive });
  await stop(D1, L, S1, "completed", { p_action_id: randomUUID() });
  const r = await stop(D1, L, S1, "arrived", { p_action_id: arrive }).catch((e) => ({ code: e.code }));
  ok("a replayed arrive after the stop completed is a no-op, not DL003",
    r?.status === "replayed" && (await events(L, "stop_arrived")) === 1, JSON.stringify(r));

  const [L2, T1] = await manualLoad(D1, "MAN-OTHER");
  await call("driver_accept_load", { p_org: ORG, p_driver: D1, p_load: L2 });
  const other = await err(stop(D1, L2, T1, "arrived", { p_action_id: arrive }));
  ok("an action id reused on another load is refused (DL012)", other?.code === "DL012", JSON.stringify(other));
  const otherStop = await err(stop(D1, L, S2, "arrived", { p_action_id: arrive }));
  ok("an action id reused for another stop of the same load is refused (DL012)", otherStop?.code === "DL012", JSON.stringify(otherStop));

  await stop(D1, L2, T1, "arrived");
  const plain = await stop(D1, L2, T1, "arrived").catch((e) => ({ code: e.code }));
  ok("a call without an action id keeps 0141's state-based idempotency",
    plain?.status === "replayed" && (await events(L2, "stop_arrived")) === 1, JSON.stringify(plain));
}
{
  const [L, S1] = await tmsLoad({ seat: D1 });
  await send(L, D1);
  const arrive = randomUUID();
  await stop(D1, L, S1, "arrived", { p_action_id: arrive });
  // A stop event's id handed to "Got it": same org and load, another kind (and no stop to tell them apart).
  const kind = await err(ack(D1, L, arrive));
  ok("an action id reused for another kind is refused (DL012)",
    kind?.code === "DL012" && (await events(L, "acknowledged")) === 0, JSON.stringify(kind));
}

// ── team and photos ─────────────────────────────────────────────────────────────────────────────
{
  const [L, S1, S2] = await tmsLoad({ seat: D1, co: CO });
  await send(L, D1);
  const p1 = photo(CO, L, "bol");
  await stop(CO, L, S1, "completed", { p_photos: JSON.stringify([p1]) });
  const done = await stopRow(S1);
  const r = await stop(D1, L, S1, "arrived", { p_action_id: randomUUID() }).catch((e) => ({ code: e.code }));
  ok("an Arrive after the co-driver completed the stop is a no-op, not DL003",
    r?.status === "already_done" && JSON.stringify(await stopRow(S1)) === JSON.stringify(done), JSON.stringify(r));

  const p2 = photo(D1, L, "seal");
  const again = await stop(D1, L, S1, "completed", { p_photos: JSON.stringify([p1, p2]), p_action_id: randomUUID() })
    .catch((e) => ({ code: e.code }));
  const after = await stopRow(S1);
  ok("a second Complete with new photos records them and changes nothing else",
    again?.status === "photos_added" && again.added === 1
      && (await num(`select count(*) n from load_stop_photos where stop_id=$1`, [S1])) === 2
      && after.completed_at.getTime() === done.completed_at.getTime() && after.status === "completed"
      && (await events(L, "stop_completed")) === 1 && (await events(L, "stop_photo_added")) === 1,
    JSON.stringify(again));

  const arrivedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const arriveId = randomUUID();
  await stop(D1, L, S2, "completed", { p_action_id: randomUUID(), p_arrived_at: arrivedAt, p_arrive_action_id: arriveId });
  const s2 = await stopRow(S2);
  const late = await stop(D1, L, S2, "arrived", { p_action_id: arriveId }).catch((e) => ({ code: e.code }));
  ok("a Complete that carries its Arrive records the arrival once, and the late Arrive is a no-op",
    s2.arrived_at?.toISOString() === arrivedAt
      && (await num(`select count(*) n from load_events where id=$1 and kind='stop_arrived'`, [arriveId])) === 1
      && late?.status === "replayed" && (await events(L, "stop_arrived")) === 1,
    JSON.stringify({ s2, late }));
}
{
  const [L, S1, S2] = await tmsLoad({ seat: D1 });
  await send(L, D1);
  await stop(D1, L, S1, "completed");
  ok("a Complete without an arrival leaves arrived_at empty on a McLeod load", (await stopRow(S1)).arrived_at === null);

  const id = randomUUID();
  await stop(D1, L, S2, "completed", {
    p_action_id: id,
    p_occurred_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    p_arrived_at: new Date().toISOString(),
  });
  const ev = await one(`select payload from load_events where id=$1`, [id]);
  ok("a carried arrival later than the departure is not used and is flagged",
    (await stopRow(S2)).arrived_at === null && (ev?.payload.time_flags ?? []).includes("arrival_after_departure"),
    JSON.stringify(ev));
}

// ── a McLeod load is McLeod's ───────────────────────────────────────────────────────────────────
{
  const [L, S1, S2] = await tmsLoad({ status: "approved", seat: D1 });
  await send(L, D1);
  await stop(D1, L, S1, "completed");
  await stop(D1, L, S2, "completed");
  ok("completing every stop of a McLeod load leaves loads.status as McLeod set it",
    (await loadRow(L)).status === "approved" && (await events(L, "completed")) === 0 && (await events(L, "started")) === 0);
  const base = { p_org: ORG, p_driver: D1, p_load: L };
  ok("start on a McLeod load is refused (DL013)", (await err(call("driver_start_load", base)))?.code === "DL013");
  ok("accept on a McLeod load is refused (DL014)", (await err(call("driver_accept_load", base)))?.code === "DL014");
  ok("decline on a McLeod load is refused (DL014)",
    (await err(call("driver_decline_load", { ...base, p_reason: "hours_of_service" })))?.code === "DL014");
}

// ── Got it ──────────────────────────────────────────────────────────────────────────────────────
{
  const [L] = await tmsLoad({ status: "approved", seat: D1, co: CO });
  const first = await send(L, D1);
  const id = randomUUID();
  const r = await ack(D1, L, id);
  const ev = await one(`select kind, payload from load_events where id=$1`, [id]);
  ok("Got it records one acknowledged event naming the current dispatch",
    r?.status === "recorded" && ev?.kind === "acknowledged" && ev.payload.dispatch_id === first && ev.payload.driver_id === D1
      && (await events(L, "acknowledged")) === 1, JSON.stringify({ r, ev }));
  const replay = await ack(D1, L, id);
  ok("a replayed Got it writes nothing", replay?.status === "replayed" && (await events(L, "acknowledged")) === 1);
  const phone2 = await ack(D1, L, randomUUID());
  ok("Got it from a second phone for the same dispatch writes nothing",
    phone2?.status === "replayed" && (await events(L, "acknowledged")) === 1, JSON.stringify(phone2));
  const second = await send(L, D1);
  const resent = await ack(D1, L, randomUUID());
  ok("after a re-send, Got it records a new acknowledgement",
    resent?.status === "recorded" && resent.dispatch_id === second && (await events(L, "acknowledged")) === 2, JSON.stringify(resent));
  const co = await ack(CO, L, randomUUID());
  ok("both seats of a team acknowledge separately",
    co?.status === "recorded"
      && (await num(`select count(*) n from load_events where load_id=$1 and kind='acknowledged' and payload->>'driver_id'=$2`, [L, CO])) === 1,
    JSON.stringify(co));
  ok("Got it without an action id is refused (DL015)", (await err(ack(D1, L, null)))?.code === "DL015");
  const [M] = await manualLoad(D1, "MAN-ACK");
  ok("a manual load is refused (DL014)", (await err(ack(D1, M, randomUUID())))?.code === "DL014");
}

// ── late photos ─────────────────────────────────────────────────────────────────────────────────
{
  const [L, S1] = await tmsLoad({ status: "approved", seat: D1 });
  await send(L, D1);
  await stop(D1, L, S1, "completed");
  const add = (photos) => call("driver_add_stop_photos", { p_org: ORG, p_driver: D1, p_load: L, p_stop: S1, p_photos: JSON.stringify(photos) });
  const p = photo(D1, L, "bol", { sha256: HEX });
  const added = await add([p]).catch((e) => ({ code: e.code }));
  ok("late photos on a sent McLeod load at approved are accepted", added === 1, JSON.stringify(added));
  const bad = await err(add([photo(D1, L, "seal", { sha256: "NOT-A-HASH" })]));
  ok("a photo's sha256 is stored, and a malformed one is refused",
    (await one(`select sha256 from load_stop_photos where id=$1`, [p.id]))?.sha256 === HEX && bad?.code === "23514",
    JSON.stringify(bad));
}

// ── signatures and grants ───────────────────────────────────────────────────────────────────────
{
  const old = (await one(
    `select to_regprocedure('public.driver_complete_stop(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,timestamptz)') r`)).r;
  const all = (await db.query(
    `select pg_get_function_identity_arguments(oid) a from pg_proc where proname = 'driver_complete_stop'`)).rows;
  ok("the old nine-argument driver_complete_stop no longer exists",
    old === null && all.length === 1 && all[0].a.split(",").length === 13, JSON.stringify(all));

  const def = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'load_events_kind_check'`)).d;
  ok("load_events keeps stop_photo_added, stop_removed_in_mcleod and stop_mirror_refused",
    ["stop_photo_added", "stop_removed_in_mcleod", "stop_mirror_refused", "acknowledged"].every((k) => def.includes(`'${k}'`)), def);

  const fns = ["driver_visible_tms_load_ids", "driver_load_access", "assert_driver_load", "load_action_seen",
    "driver_accept_load", "driver_decline_load", "driver_start_load", "driver_complete_stop",
    "driver_acknowledge_load", "driver_add_stop_photos"];
  const acl = (await db.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
            has_function_privilege('authenticated', p.oid, 'execute') auth,
            has_function_privilege('service_role', p.oid, 'execute') svc
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [fns])).rows;
  ok("every new or replaced parameterised function is service-role only",
    acl.length === fns.length && acl.every((r) => r.svc && !r.anon && !r.auth), JSON.stringify(acl));
  const w = await one(
    `select has_function_privilege('anon', 'public.auth_visible_tms_load_ids()', 'execute') anon,
            has_function_privilege('authenticated', 'public.auth_visible_tms_load_ids()', 'execute') auth,
            has_function_privilege('service_role', 'public.auth_visible_tms_load_ids()', 'execute') svc`);
  ok("the wrapper keeps 0655's ACL (anon, authenticated, service_role)", w.anon && w.auth && w.svc, JSON.stringify(w));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
