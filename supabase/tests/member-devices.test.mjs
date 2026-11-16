// Silvicom 360 — signed-in devices: remembered past sign-out, and at most three at once
// (migration 0620, INSTALLED-APP-PLAN IA-S6; the owner's rulings of 2026-11-16, Q-IA14 … Q-IA19).
//
// What the database itself must guarantee, whoever calls `member_access_check`:
//   · it answers everything 0617's `member_access_state` does, identically — it is to replace it;
//   · a device takes one of the places the first time it is seen and keeps it; a fourth is STOPPED and writes
//     NOTHING, so an abandoned fourth sign-in never takes a place (Q-IA14 (b));
//   · the same app signing in again is the same device, in its own place; one session is one device whatever
//     key it sends later; a device idle past the window has lost its place, even on its own session;
//   · every address Supabase saw is remembered on the device, and survives the session's deletion;
//   · `p_limit` null limits nothing; a dead session is decided by its own rule and writes nothing;
//   · a browser can call neither function nor read either table.
//
// `auth.sessions` is Supabase's table, built with the columns measured on production 2026-11-16.
//
// Run: node supabase/tests/member-devices.test.mjs
// Run: node supabase/tests/second-factor-state.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
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
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};
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
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;
const person = async (email, org, role, name) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, id, role]);
  await db.query(`insert into user_profiles (user_id, full_name) values ($1,$2)`, [id, name]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher", "Ana Petrović");
const BEN = await person("ben@silvicom.test", ORG, "admin", "Ben Admin");
const DRIVER = await person("driver@silvicom.test", ORG, "driver", "Dan Driver");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

await db.exec(`
  create type auth.aal_level as enum ('aal1','aal2','aal3');
  create table auth.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz, updated_at timestamptz, factor_id uuid, aal auth.aal_level, not_after timestamptz,
    refreshed_at timestamp, user_agent text, ip inet, tag text, oauth_client_id uuid,
    refresh_token_hmac_key text, refresh_token_counter bigint, scopes text
  );
`);
await db.exec(`
  create type auth.factor_type as enum ('totp','webauthn','phone');
  create type auth.factor_status as enum ('unverified','verified');
  create table auth.mfa_factors (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    friendly_name text, factor_type auth.factor_type not null, status auth.factor_status not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    secret text, phone text, last_challenged_at timestamptz
  );
`);
const factor = async (user, status) =>
  (await one(`insert into auth.mfa_factors (user_id, factor_type, status, secret) values ($1,'totp',$2::auth.factor_status,'TOTP-SECRET') returning id`, [user, status])).id;
const KEY = (n) => `device-key-${String(n).padStart(8, "0")}-abcdef`;  // 30 chars, the app's alphabet
let ipN = 10;
const signIn = async (user, ip = `203.0.113.${ipN++}`, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/142") =>
  (await one(`insert into auth.sessions (user_id, created_at, updated_at, ip, user_agent) values ($1, now(), now(), $2::inet, $3) returning id`, [user, ip, ua])).id;
const check = async (user, sess, key, limit = 3, org = ORG, idle = 12) =>
  (await all(`select * from member_access_check($1,$2,$3,$4,$5,$6)`, [org, user, sess, key, limit, idle]))[0];
const devices = async (user) => Number((await one(`select count(*) n from member_devices where user_id=$1`, [user])).n);
const addresses = async (user) => Number((await one(`select count(*) n from member_device_addresses a join member_devices d on d.id=a.device_id where d.user_id=$1`, [user])).n);
const list = async (user, org = ORG) => all(`select * from member_devices_list($1,$2,12)`, [org, user]);

console.log("\n-- everything 0617's read answers, the same --");
const BS = await signIn(BEN);
const cmp = async (user, sess, org = ORG) => {
  const n = await all(`select role::text, suspended_at, session_alive, second_factor_required_from, has_second_factor from member_access_check($1,$2,$3,null,null,12)`, [org, user, sess]);
  const o = await all(`select role::text, suspended_at, session_alive, second_factor_required_from, has_second_factor from member_access_state($1,$2,$3)`, [org, user, sess]);
  return JSON.stringify(n) === JSON.stringify(o);
};
ok("a live session", await cmp(BEN, BS));
ok("no session named", await cmp(BEN, null));
ok("somebody else's session", await cmp(ANA, BS));
ok("no membership in that organisation is no row", (await cmp(BEN, BS, ORG_B)) && (await check(BEN, BS, KEY(1), 3, ORG_B)) === undefined);
await factor(BEN, "verified");
ok("a factor", await cmp(BEN, BS));
// A dispatcher, not BEN: the company's only admin cannot be suspended (memberships_keep_an_admin).
const AS = await signIn(ANA);
await db.query(`update memberships set suspended_at = now() where user_id=$1`, [ANA]);
ok("a suspension", await cmp(ANA, AS));
await db.query(`update memberships set suspended_at = null where user_id=$1`, [ANA]);
await db.query(`delete from auth.sessions where id=$1`, [AS]);
await db.query(`delete from member_devices`);

console.log("\n-- a device, remembered --");
const A1 = await signIn(ANA, "198.51.100.7", "Mozilla/5.0 (iPhone) Safari");
const r1 = await check(ANA, A1, KEY(1));
ok("the first device is admitted", r1.device_admitted === true && r1.devices_in_use === 1);
const row = await one(`select * from member_devices where user_id=$1`, [ANA]);
ok("...keyed by the app's own key, named by what Supabase saw", row.device_key === `app:${KEY(1)}` && row.user_agent === "Mozilla/5.0 (iPhone) Safari" && row.last_session_id === A1);
ok("...with the address Supabase saw", (await one(`select host(ip) ip from member_device_addresses where device_id=$1`, [row.id])).ip === "198.51.100.7");
await check(ANA, A1, KEY(1));
ok("seen again: no second device, no second address", (await devices(ANA)) === 1 && (await addresses(ANA)) === 1);
await check(ANA, A1, KEY(99));
ok("one session is one device, whatever key it sends later", (await devices(ANA)) === 1);
await db.query(`update auth.sessions set ip='192.0.2.44' where id=$1`, [A1]);
await check(ANA, A1, KEY(1));
ok("a new address on the same device is a second address, not a second device", (await devices(ANA)) === 1 && (await addresses(ANA)) === 2);
await db.query(`delete from auth.sessions where id=$1`, [A1]);
ok("signed out: the device and both addresses are still remembered", (await devices(ANA)) === 1 && (await addresses(ANA)) === 2);
const gone = (await list(ANA))[0];
ok("...shown as not signed in, with no session to end", gone.signed_in === false && gone.session_id === null && gone.addresses.length === 2);
const A1b = await signIn(ANA);
await check(ANA, A1b, KEY(1));
ok("the same app signing in again is the same device", (await devices(ANA)) === 1 && (await list(ANA))[0].signed_in === true);

console.log("\n-- three places --");
const A2 = await signIn(ANA), A3 = await signIn(ANA);
ok("a second and a third device are admitted",
  (await check(ANA, A2, KEY(2))).device_admitted === true && (await check(ANA, A3, KEY(3))).device_admitted === true);
const A4 = await signIn(ANA);
const r4 = await check(ANA, A4, KEY(4));
ok("the fourth is stopped", r4.device_admitted === false && r4.devices_in_use === 3);
ok("...and writes nothing", (await devices(ANA)) === 3);
ok("...but its session is still alive — it is the device's to use for signing another out", r4.session_alive === true);
ok("the three keep their places", (await check(ANA, A2, KEY(2))).device_admitted === true);
await db.query(`delete from auth.sessions where id=$1`, [A2]);
const A5 = await signIn(ANA);
ok("one signed out: the NEXT sign-in takes the place — the abandoned fourth never held one", (await check(ANA, A5, KEY(5))).device_admitted === true);
ok("...and the abandoned fourth, coming back, is stopped again", (await check(ANA, A4, KEY(4))).device_admitted === false);
const A1c = await signIn(ANA);
await db.query(`delete from auth.sessions where id=$1`, [A1b]);
ok("a device that signed out and in again reclaims its own place", (await check(ANA, A1c, KEY(1))).device_admitted === true && (await devices(ANA)) === 4);
const A6 = await signIn(ANA);
ok("an old build sending no key is keyed by its session — and is still the fourth", (await check(ANA, A6, null)).device_admitted === false);
ok("a key that is not the app's alphabet is treated as no key", (await check(ANA, A6, "'; drop table x; --")).device_admitted === false && (await devices(ANA)) === 4);

console.log("\n-- a password alone takes no place --");
const TOM = await person("tom@silvicom.test", ORG, "technician", "Tom Tech");
await factor(TOM, "verified");
const P1 = await signIn(TOM);
const half = await check(TOM, P1, KEY(50));
ok("a person with a factor: a session before its code is alive but takes no place", half.session_alive === true && half.device_admitted === null);
ok("...and nothing is written for it", Number((await one(`select count(*) n from member_devices where last_session_id=$1`, [P1])).n) === 0);
await db.query(`update auth.sessions set aal='aal2' where id=$1`, [P1]);
ok("the same session after its code is admitted", (await check(TOM, P1, KEY(50))).device_admitted === true);

console.log("\n-- idle --");
await db.query(`update member_devices set last_seen_at = now() - interval '13 hours' where last_session_id=$1`, [A3]);
ok("a device idle past the window has lost its place", (await check(ANA, A6, null)).device_admitted === true);
await db.query(`update auth.sessions set updated_at = now() where id=$1`, [A3]);
ok("...and coming back on its own renewed session it needs a free one", (await check(ANA, A3, KEY(3))).device_admitted === false);

console.log("\n-- no limit; a dead session --");
const D = [];
for (let i = 0; i < 5; i++) D.push(await signIn(DRIVER));
for (let i = 0; i < 5; i++) await check(DRIVER, D[i], KEY(20 + i), null);
ok("a null limit admits and remembers all five", (await devices(DRIVER)) === 5);
await db.query(`delete from auth.sessions where id=$1`, [D[0]]);
const dead = await check(DRIVER, D[0], KEY(20));
ok("a dead session: not alive, nothing decided", dead.session_alive === false && dead.device_admitted === null);
const NONE = await check(DRIVER, null, KEY(30));
ok("no session named: nothing decided, nothing written", NONE.session_alive === null && NONE.device_admitted === null && (await devices(DRIVER)) === 5);
const D6 = await signIn(DRIVER);
await check(DRIVER, D6, "'; drop table x; --", null);
ok("a key that is not the app's alphabet is never stored — the device is keyed by its session",
  (await one(`select device_key from member_devices where last_session_id=$1`, [D6])).device_key === `session:${D6}`);
ok("somebody else's session admits nothing to me", (await check(BEN, D[1], KEY(31))).session_alive === false && (await devices(BEN)) === 0);

console.log("\n-- the list --");
const L = await list(ANA);
// Five: three signed in (keys 1, 5, the keyless one), key 2 signed out, key 3 lost its place idle.
ok("signed-in devices first, the signed-out and idle ones still listed", L.length === 5 && L.filter((x) => x.signed_in).length === 3 && L.findIndex((x) => !x.signed_in) > L.findLastIndex((x) => x.signed_in));
ok("only that person's devices", (await list(DRIVER)).length === 6 && (await list(BEN)).length === 0);
ok("nothing in an organisation they are not a member of", (await list(ANA, ORG_B)).length === 0);
// A device remembered under ANOTHER company — a person who moved carriers keeps one sign-in account.
// It is signed in and seen now, so only the company filter keeps it out of the count below.
await db.query(`insert into member_devices (org_id, user_id, device_key, last_session_id) values ($1,$2,'app:moved-carrier-device-key',$3)`, [ORG_B, ANA, await signIn(ANA)]);
ok("a device remembered under another company is not listed under this one", (await list(ANA)).length === 5);
ok("...and does not take one of this company's places", (await check(ANA, await signIn(ANA), KEY(40))).devices_in_use === 3);
ok("no token or key leaves it", !/device-key|refresh|token/.test(JSON.stringify(L)));

console.log("\n-- a browser --");
const claims = { sub: ANA, role: "authenticated", org_id: ORG, user_role: "dispatcher" };
ok("(the browser can read its own company — so the refusals below are not an empty sign-in)",
  ((await asUser(claims, `select id from organizations where id = '${ORG}'`)).rows ?? []).length === 1);
ok("a browser cannot call member_access_check", !!(await asUser(claims, `select * from member_access_check('${ORG}','${ANA}','${A5}','${KEY(5)}',null,12)`)).error);
ok("...nor member_devices_list", !!(await asUser(claims, `select * from member_devices_list('${ORG}','${ANA}',12)`)).error);
const seen = await asUser(claims, `select * from member_devices`);
ok("...nor read its own devices", !!seen.error || seen.rows.length === 0);
const seenA = await asUser(claims, `select * from member_device_addresses`);
ok("...nor their addresses", !!seenA.error || seenA.rows.length === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
