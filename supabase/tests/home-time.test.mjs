// HOME-TIME-PLAN §3.1 and §3.6 (step HT1), migrations 0597 and 0598: a home-time period the office marks
// on a driver — one live period per driver, the shape every such row must keep, reopen, a driver merge that
// carries the period — and the notification routing storage: routes, a confirmed number, a delivery queued
// only for the items it claimed, the held-text window, the bell's three categories.
//
// Run:  node supabase/tests/home-time.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

// The REAL merge list, parsed the way lint:driver-references parses it.
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) {
  console.error("could not parse DRIVER_REASSIGNMENTS");
  process.exit(1);
}

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const all = async (q, p = []) => (await db.query(q, p)).rows;
/** null on success; else the SQLSTATE, and the DETAIL when the function sent one. */
const outcome = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return { code: e.code ?? String(e.message), detail: e.detail ?? null }; }
};
const sqlstate = async (q, p = []) => (await outcome(q, p))?.code ?? null;

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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────
const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Other carrier");
const user = async (o, role) => {
  const id = (await one(`insert into auth.users (id) values (gen_random_uuid()) returning id`)).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, $3)`, [o, id, role]);
  return id;
};
const DANA = await user(ORG, "dispatcher");
const IVO = await user(ORG, "dispatcher");
const driver = async (o, name) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, 'active') returning id`, [o, name])).id;
const MARCUS = await driver(ORG, "Marcus Hill");
const RAY = await driver(ORG, "Ray Diaz");
const NO_TRUCK = await driver(ORG, "Sam Pool");
const THEIR_DRIVER = await driver(OTHER, "Someone else");
const truck = async (o, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, $2, 150) returning id`, [o, unit])).id;
const TRUCK = await truck(ORG, "702");
const TRUCK_2 = await truck(ORG, "848");
const THEIR_TRUCK = await truck(OTHER, "702");

const START = "2026-11-10T14:00:00Z";
const BACK = "2026-11-17T14:00:00Z";
const mark = (o, d, { start = START, back = BACK, disposition = "with_driver", vehicle = TRUCK, actor = DANA } = {}) =>
  outcome(`select home_time_mark($1, $2, $3, $4, $5, $6, $7)`, [o, d, actor, start, back, disposition, vehicle]);
const live = async (d) =>
  all(`select id, end_at, canceled_at from driver_time_off where driver_id = $1 and provider = 'silvicom' and end_at is null and canceled_at is null order by start_at`, [d]);
const row = async (id) => one(`select * from driver_time_off where id = $1`, [id]);

// ── marking ───────────────────────────────────────────────────────────────────────────────────
ok("a period is marked on this carrier's driver", (await mark(ORG, MARCUS)) === null);
const P1 = (await live(MARCUS))[0].id;
{
  const r = await row(P1);
  ok("…as our own home-time row, signed by who marked it",
    r.provider === "silvicom" && r.kind === "home_time" && r.created_by === DANA && r.updated_by === DANA
      && r.truck_disposition === "with_driver" && r.vehicle_id === TRUCK && r.end_at === null && r.end_reason === null);
  ok("…with the return time in its own column, end_at left null (the fuel rule's 'still off')",
    new Date(r.expected_return_at).toISOString() === new Date(BACK).toISOString() && r.end_at === null);
}
ok("another carrier's driver is refused (HT001)", (await mark(ORG, THEIR_DRIVER))?.code === "HT001");
ok("another carrier's truck is refused (HT002)", (await mark(ORG, RAY, { vehicle: THEIR_TRUCK }))?.code === "HT002");
ok("'with the driver' without a truck is refused (HT003)", (await mark(ORG, RAY, { vehicle: null }))?.code === "HT003");
ok("'no truck' with a truck named is refused (HT003)", (await mark(ORG, RAY, { disposition: "no_truck" }))?.code === "HT003");
ok("a disposition outside the three is refused by the column's CHECK (23514)",
  (await mark(ORG, RAY, { disposition: "at_home", vehicle: TRUCK_2 }))?.code === "23514");
ok("a return time at or before the start is refused by the shape CHECK (23514)",
  (await mark(ORG, RAY, { back: START, vehicle: TRUCK_2 }))?.code === "23514");
ok("a driver with no truck is marked with 'no truck'", (await mark(ORG, NO_TRUCK, { disposition: "no_truck", vehicle: null })) === null);
ok("none of the refusals wrote a row", (await live(RAY)).length === 0);

// ── one live period per driver (D-HT3) ────────────────────────────────────────────────────────
{
  const second = await mark(ORG, MARCUS, { actor: IVO });
  ok("a second live period for the same driver is refused (HT010)", second?.code === "HT010");
  ok("…and the refusal names the period that is already live", second?.detail === P1, JSON.stringify(second));
  ok("…leaving exactly one", (await live(MARCUS)).length === 1);
}
ok("no unique index forbids two live rows — the driver merge needs to be able to land one on another",
  (await all(`select indexdef from pg_indexes where tablename = 'driver_time_off' and indexdef ilike '%unique%' and indexdef ilike '%driver_id%'`)).length === 0);

// ── the shape holds for the service's own UPDATEs ─────────────────────────────────────────────
const upd = (set, id = P1) => sqlstate(`update driver_time_off set ${set} where id = $1`, [id]);
ok("ending without a reason is refused (23514)", (await upd(`end_at = '2026-11-16T10:00:00Z'`)) === "23514");
ok("a reason without an end is refused (23514)", (await upd(`end_reason = 'returned'`)) === "23514");
ok("an end before the start is refused (23514)", (await upd(`end_at = '2026-11-09T10:00:00Z', end_reason = 'returned'`)) === "23514");
ok("an end reason outside the three is refused (23514)", (await upd(`end_at = '2026-11-16T10:00:00Z', end_reason = 'gone'`)) === "23514");
ok("clearing the return time is refused (23514)", (await upd(`expected_return_at = null`)) === "23514");
ok("changing the kind of our own row is refused (23514)", (await upd(`kind = 'pto'`)) === "23514");
ok("a change of the return time is accepted", (await upd(`expected_return_at = '2026-11-19T14:00:00Z', updated_by = '${IVO}'`)) === null);
ok("the truck going back to the yard is accepted", (await upd(`truck_disposition = 'at_yard'`)) === null);
ok("an end with its reason is accepted", (await upd(`end_at = '2026-11-16T10:00:00Z', end_reason = 'returned', ended_by = '${DANA}'`)) === null);
ok("canceling an ended period is refused — it ended, it was not a mistake (23514)", (await upd(`canceled_at = now()`)) === "23514");
ok("the McLeod ingest's rows are not held to our shape (no return time, any kind)",
  (await sqlstate(`insert into driver_time_off (org_id, provider, external_id, driver_id, start_at, kind) values ($1, 'mcleod', 'ext-1', $2, now(), 'pto')`, [ORG, RAY])) === null);

// ── reopen (D-HT6) ────────────────────────────────────────────────────────────────────────────
ok("with the first ended, the driver can be marked again", (await mark(ORG, MARCUS, { start: "2026-11-20T14:00:00Z", back: "2026-11-25T14:00:00Z" })) === null);
const P2 = (await live(MARCUS))[0].id;
{
  const blocked = await outcome(`select home_time_reopen($1, $2, $3)`, [ORG, P1, IVO]);
  ok("reopening the ended one is refused while a newer period is live (HT010)", blocked?.code === "HT010" && blocked?.detail === P2, JSON.stringify(blocked));
}
ok("a live period is not reopened (HT011)", (await sqlstate(`select home_time_reopen($1, $2, $3)`, [ORG, P2, IVO])) === "HT011");
ok("the newer one canceled as a mistake", (await upd(`canceled_at = now(), canceled_by = '${IVO}'`, P2)) === null);
ok("a canceled period is not reopened (HT011)", (await sqlstate(`select home_time_reopen($1, $2, $3)`, [ORG, P2, IVO])) === "HT011");
ok("another carrier cannot reopen this one (HT020)", (await sqlstate(`select home_time_reopen($1, $2, $3)`, [OTHER, P1, IVO])) === "HT020");
ok("a McLeod row is not ours to reopen (HT020)",
  (await sqlstate(`select home_time_reopen($1, (select id from driver_time_off where external_id = 'ext-1'), $2)`, [ORG, IVO])) === "HT020");
ok("the ended period is reopened", (await sqlstate(`select home_time_reopen($1, $2, $3)`, [ORG, P1, IVO])) === null);
{
  const r = await row(P1);
  ok("…live again: no end, no reason, nobody's ending, signed by who reopened it",
    r.end_at === null && r.end_reason === null && r.ended_by === null && r.updated_by === IVO);
  ok("…and the canceled one does not count as live", (await live(MARCUS)).length === 1 && (await live(MARCUS))[0].id === P1);
}

// ── a driver merge carries the period ─────────────────────────────────────────────────────────
ok("the merge list still moves driver_time_off", MOVES.some((m) => m.table === "driver_time_off" && m.column === "driver_id"));
{
  const DUP = await driver(ORG, "Marcus Hill (dup)");
  ok("the duplicate record is marked too", (await mark(ORG, DUP, { start: "2026-11-12T14:00:00Z", back: "2026-11-18T14:00:00Z", vehicle: TRUCK_2 })) === null);
  const mergeErr = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP, MARCUS, JSON.stringify(MOVES)]);
  ok("merging two drivers who are both home succeeds", mergeErr === null, String(mergeErr));
  const both = await live(MARCUS);
  ok("…and both live periods are now the surviving driver's, for a person to end one", both.length === 2 && both.some((p) => p.id === P1));
}

// ── the thresholds ────────────────────────────────────────────────────────────────────────────
const settings = (o, due, overdue, days) =>
  sqlstate(`insert into home_time_settings (org_id, return_due_hours, overdue_after_hours, truck_limit_days) values ($1, $2, $3, $4)
            on conflict (org_id) do update set return_due_hours = excluded.return_due_hours, overdue_after_hours = excluded.overdue_after_hours, truck_limit_days = excluded.truck_limit_days`,
    [o, due, overdue, days]);
ok("the carrier's thresholds are saved", (await settings(ORG, 24, 2, 8)) === null);
ok("a warning window of zero hours is refused (23514)", (await settings(ORG, 0, 2, 8)) === "23514");
ok("an overstay delay past three days is refused (23514)", (await settings(ORG, 24, 73, 8)) === "23514");
ok("a truck limit of zero days is refused (23514)", (await settings(ORG, 24, 2, 0)) === "23514");
ok("no threshold has a column default — the defaults are written once, in @silvicom/shared",
  (await all(`select column_name from information_schema.columns where table_name = 'home_time_settings' and column_default is not null and column_name like '%\\_hours' escape '\\'`)).length === 0
    && (await sqlstate(`insert into home_time_settings (org_id) values ($1)`, [OTHER])) === "23502");

// ── routes ────────────────────────────────────────────────────────────────────────────────────
const route = (kind, key, channel, enabled = true, alert = "home_time_overdue") =>
  sqlstate(`insert into notification_routes (org_id, alert, recipient_kind, recipient_key, channel, enabled) values ($1, $2, $3, $4, $5, $6)`,
    [ORG, alert, kind, key, channel, enabled]);
ok("a role's route is saved", (await route("role", "fleet_manager", "email")) === null);
ok("a person's route is saved, off — their own switch against their role's", (await route("user", DANA, "email", false)) === null);
ok("a relation's route is saved", (await route("relation", "marked_by", "bell")) === null);
ok("the same switch twice is refused (23505)", (await route("role", "fleet_manager", "email", false)) === "23505");
ok("the same recipient on another channel is its own switch", (await route("role", "fleet_manager", "sms")) === null);
ok("a channel outside the three is refused (23514)", (await route("role", "fleet_manager", "push")) === "23514");
ok("a recipient kind outside the three is refused (23514)", (await route("team", "night", "bell")) === "23514");

// ── a confirmed number ────────────────────────────────────────────────────────────────────────
const contact = (u, phone) => sqlstate(`insert into notification_contacts (org_id, user_id, phone) values ($1, $2, $3)`, [ORG, u, phone]);
ok("a mobile number in E.164 is saved", (await contact(DANA, "+17085550123")) === null);
ok("a number without the plus is refused (23514)", (await contact(IVO, "7085550123")) === "23514");
ok("one number per person per carrier (23505)", (await contact(DANA, "+17085550199")) === "23505");
ok("a new contact is unverified and not stopped",
  (await one(`select verified_at, stopped_at, attempts from notification_contacts where user_id = $1`, [DANA])).verified_at === null);

// ── a delivery is queued only for the items it claimed ────────────────────────────────────────
const queue = (u, channel, items, notBefore = null) =>
  outcome(`select queue_notification_delivery($1, $2, 'home_time_overdue', $3, 'dana@example.com', 'Home time overstayed', $4::jsonb, $5) as id`,
    [ORG, u, channel, JSON.stringify(items), notBefore]);
const queued = async (u, channel) =>
  all(`select id, items, status, not_before from notification_deliveries where user_id = $1 and channel = $2 order by created_at, id`, [u, channel]);
const A = { key: "home_time:p1:overdue:1", line: "Marcus Hill is 2 h past his return time" };
const B = { key: "home_time:p9:overdue:1", line: "Ray Diaz is 3 h past his return time" };
ok("the first queue of two items is accepted", (await queue(DANA, "email", [A, B])) === null);
{
  const q = await queued(DANA, "email");
  ok("…as one delivery holding both lines, queued", q.length === 1 && q[0].items.length === 2 && q[0].status === "queued");
}
ok("the same two items again queue nothing", (await queue(DANA, "email", [A, B])) === null && (await queued(DANA, "email")).length === 1);
{
  const C = { key: "home_time:p9:overdue:2", line: "Ray Diaz is 1 d past his return time" };
  await queue(DANA, "email", [A, C]);
  const q = await queued(DANA, "email");
  ok("an old item beside a new one queues only the new one", q.length === 2 && q[1].items.length === 1 && q[1].items[0].key === C.key, JSON.stringify(q[1]?.items));
}
ok("the same item on the other channel is its own claim", (await queue(DANA, "sms", [A], "2026-11-14T13:00:00Z")) === null && (await queued(DANA, "sms")).length === 1);
ok("…held until its not_before", (await queued(DANA, "sms"))[0].not_before !== null);
ok("the same item for another person is its own claim", (await queue(IVO, "email", [A])) === null && (await queued(IVO, "email")).length === 1);
ok("the claims are in the ledger, prefixed by channel — the bell's own key is untouched",
  (await all(`select dedupe_key from notification_dedupe_keys where audience_user_id = $1 and dedupe_key in ($2, $3, $4)`,
    [DANA, `email:${A.key}`, `sms:${A.key}`, A.key])).length === 2);
ok("a channel that is not email or sms is refused (NR001)", (await queue(DANA, "bell", [A]))?.code === "NR001");
ok("an item without a line is refused (NR002)", (await queue(DANA, "email", [{ key: "k" }]))?.code === "NR002");
ok("…and claimed nothing on the way out",
  (await all(`select 1 from notification_dedupe_keys where audience_user_id = $1 and dedupe_key = 'email:k'`, [DANA])).length === 0);
ok("a pruned delivery re-sends nothing: its keys outlive it",
  (await sqlstate(`delete from notification_deliveries where user_id = $1 and channel = 'email'`, [DANA])) === null
    && (await queue(DANA, "email", [A, B])) === null && (await queued(DANA, "email")).length === 0);

// ── the held-text window ──────────────────────────────────────────────────────────────────────
const quiet = (start, end) => sqlstate(`insert into notification_channel_settings (org_id, sms_quiet_start_min, sms_quiet_end_min) values ($1, $2, $3)
  on conflict (org_id) do update set sms_quiet_start_min = excluded.sms_quiet_start_min, sms_quiet_end_min = excluded.sms_quiet_end_min`, [ORG, start, end]);
ok("21:00 to 07:00 is saved as minutes past midnight", (await quiet(1260, 420)) === null);
ok("a minute past the day is refused (23514)", (await quiet(1440, 420)) === "23514");

// ── the bell's categories ─────────────────────────────────────────────────────────────────────
const contractSrc = readFileSync(join(SUPA, "..", "packages", "shared", "src", "notificationsContract.ts"), "utf8");
for (const c of ["home_time_return_due", "home_time_overdue", "home_time_truck_limit"]) {
  ok(`the contract lists ${c}`, new RegExp(`"${c}",`).test(contractSrc));
  ok(`notification_events accepts ${c}`,
    (await sqlstate(`insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, $3, 'x')`, [ORG, DANA, c])) === null);
}
ok("…and still refuses a category nobody declared (23514)",
  (await sqlstate(`insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, 'home_time', 'x')`, [ORG, DANA])) === "23514");

// ── the api's only door ───────────────────────────────────────────────────────────────────────
for (const t of ["home_time_settings", "notification_routes", "notification_contacts", "notification_deliveries", "notification_channel_settings"]) {
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  ok(`${t}: RLS on with no client policy — deny-all from a browser`,
    policies === 0 && (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true);
}
ok("driver_time_off keeps its two read policies — a driver still reads his own periods",
  Number((await one(`select count(*)::int n from pg_policies where tablename = 'driver_time_off'`)).n) === 2);
ok("…which is why it has no note column",
  (await all(`select 1 from information_schema.columns where table_name = 'driver_time_off' and column_name = 'note'`)).length === 0);
for (const fn of ["home_time_mark", "home_time_reopen", "queue_notification_delivery"]) {
  const r = await one(
    `select bool_or(has_function_privilege('anon', p.oid, 'execute')) a, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) u,
            bool_or(has_function_privilege('service_role', p.oid, 'execute')) s
       from pg_proc p where p.proname = $1`, [fn]);
  ok(`${fn}: service role only`, r.a === false && r.u === false && r.s === true, JSON.stringify(r));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
