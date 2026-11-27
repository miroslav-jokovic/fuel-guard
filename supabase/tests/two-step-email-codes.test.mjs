// Silvicom 360 — two-step sign-in by an emailed code, trusted on a device for seven days
// (migration 0662, INSTALLED-APP-PLAN IA-S1 rev 2; the owner's ruling of 2026-11-27, Q-IA20).
//
// What the database itself must guarantee, whoever calls these functions:
//   · a code is one live row per device; a second send inside the resend window mails nothing; the hourly budget holds;
//   · entering it is spent once, five wrong entries kill it, an expired or revoked code is never accepted;
//   · the right code trusts THAT device (and no other, and in no other company) from that moment;
//   · `member_access_gate` reports when this device last gave its code, and takes one of 0620's device places only
//     once the code is not owed — a password alone cannot fill the three;
//   · a browser can call none of the functions and read neither table.
//
// `auth.sessions` is Supabase's table, built with the columns measured on production 2026-11-16 (as 0620's matrix).
//
// Run: node supabase/tests/two-step-email-codes.test.mjs
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

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;
const person = async (email, org, role) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, id, role]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher");
const BEN = await person("ben@silvicom.test", ORG, "admin");
const DRIVER = await person("driver@silvicom.test", ORG, "driver");
const OUT = await person("outsider@other.test", ORG_B, "admin");

const KEY = (n) => `device-key-${String(n).padStart(8, "0")}-abcdef`;
const H = (n) => String(n).padStart(64, "0");                   // a stand-in for the API's HMAC: 64 hex
let ipN = 10;
const signIn = async (user) =>
  (await one(`insert into auth.sessions (user_id, created_at, updated_at, ip, user_agent) values ($1, now(), now(), $2::inet, 'Chrome')
              returning id`, [user, `203.0.113.${ipN++}`])).id;
const issue = async (user, sess, key, hash, { org = ORG, perHour = 5, resend = 60 } = {}) =>
  (await all(`select * from two_step_code_issue($1,$2,$3,$4,$5,10,$6,$7)`, [org, user, sess, key, hash, perHour, resend]))[0];
const verify = async (user, sess, key, hash, org = ORG) =>
  (await one(`select two_step_code_verify($1,$2,$3,$4,$5,5) v`, [org, user, sess, key, hash])).v;
const gate = async (user, sess, key, { org = ORG, required = true, limit = 3 } = {}) =>
  (await all(`select * from member_access_gate($1,$2,$3,$4,$5,12,7,$6)`, [org, user, sess, key, limit, required]))[0];
const devices = async (user) => Number((await one(`select count(*) n from member_devices where user_id=$1`, [user])).n);
const live = async (user) => Number((await one(`select count(*) n from two_step_codes where user_id=$1 and used_at is null and revoked_at is null`, [user])).n);

console.log("\n-- sending --");
const A1 = await signIn(ANA);
const first = await issue(ANA, A1, KEY(1), H(111111));
ok("a code is issued, expiring in ten minutes", first.outcome === "issued" && first.code_id &&
  Math.abs(new Date(first.expires_at).getTime() - Date.now() - 600_000) < 5_000);
const again = await issue(ANA, A1, KEY(1), H(222222));
ok("a second send inside the resend window mails nothing: the same code, 'recent'", again.outcome === "recent" && again.code_id === first.code_id && (await live(ANA)) === 1);
const fresh = await issue(ANA, A1, KEY(1), H(333333), { resend: 0 });
ok("after the window a new code replaces the old — still one live per device", fresh.outcome === "issued" && fresh.code_id !== first.code_id && (await live(ANA)) === 1);
ok("the replaced code is revoked, not deleted", (await one(`select revoked_at from two_step_codes where id=$1`, [first.code_id])).revoked_at !== null);
ok("the old code is no longer accepted", (await verify(ANA, A1, KEY(1), H(111111))) === "wrong");
await issue(ANA, A1, KEY(2), H(444444), { resend: 0 });
await issue(ANA, A1, KEY(3), H(555555), { resend: 0 });
const fifth = await issue(ANA, A1, KEY(4), H(666666), { resend: 0 });
ok("('recent' made no row: this is the fifth code of the hour, and it is issued)", fifth.outcome === "issued");
const sixth = await issue(ANA, A1, KEY(5), H(777777), { resend: 0 });
ok("five codes in the hour, then 'throttled' — across devices, per person", sixth.outcome === "throttled" && sixth.code_id === null);
ok("no key and no session: nothing to remember it against", (await issue(BEN, null, null, H(1))).outcome === "no_device");
ok("a person with no membership in the company gets nothing", (await issue(OUT, null, KEY(9), H(1))) === undefined);
const bad = await issue(BEN, await signIn(BEN), "'; drop table x; --", H(7));
ok("a key outside the app's alphabet is never stored: the code is keyed by the session",
  bad.outcome === "issued" && (await one(`select device_key from two_step_codes where id=$1`, [bad.code_id])).device_key.startsWith("session:"));
ok("a code hash that is not 64 hex is refused by the table", !!(await db.query(`select * from two_step_code_issue($1,$2,null,$3,'not-a-hash',10,5,60)`, [ORG, DRIVER, KEY(50)]).catch((e) => e)).message);

console.log("\n-- entering --");
const B1 = await signIn(BEN);
const bc = await issue(BEN, B1, KEY(10), H(101010));
ok("wrong once: 'wrong'", (await verify(BEN, B1, KEY(10), H(1))) === "wrong");
ok("the right code from ANOTHER device is not this device's code", (await verify(BEN, B1, KEY(11), H(101010))) === "expired");
ok("...nor in another company", (await verify(BEN, B1, KEY(10), H(101010), ORG_B)) === "expired");
ok("the right code: 'ok'", (await verify(BEN, B1, KEY(10), H(101010))) === "ok");
ok("spent: the same code again is 'expired'", (await verify(BEN, B1, KEY(10), H(101010))) === "expired");
const trusted = await one(`select * from two_step_devices where user_id=$1`, [BEN]);
ok("the device is trusted from now, with the session that gave it", trusted.device_key === `app:${KEY(10)}` && trusted.last_session_id === B1 && Date.now() - new Date(trusted.verified_at).getTime() < 5_000);
ok("the code row records the entries it took", (await one(`select attempts from two_step_codes where id=$1`, [bc.code_id])).attempts === 2);

const D1 = await signIn(DRIVER);
const dc = await issue(DRIVER, D1, KEY(20), H(202020));
for (let i = 0; i < 4; i++) await verify(DRIVER, D1, KEY(20), H(i + 1));
ok("the fifth wrong entry is 'too_many'", (await verify(DRIVER, D1, KEY(20), H(9))) === "too_many");
ok("...and kills it: even the right code is refused", (await verify(DRIVER, D1, KEY(20), H(202020))) === "expired");
ok("...and nothing was trusted", Number((await one(`select count(*) n from two_step_devices where user_id=$1`, [DRIVER])).n) === 0);
ok("the dead code is revoked", (await one(`select revoked_at from two_step_codes where id=$1`, [dc.code_id])).revoked_at !== null);

const ec = await issue(DRIVER, D1, KEY(21), H(212121));
await db.query(`update two_step_codes set expires_at = now() - interval '1 second' where id=$1`, [ec.code_id]);
ok("an expired code is refused, even when right", (await verify(DRIVER, D1, KEY(21), H(212121))) === "expired");
const rc = await issue(DRIVER, D1, KEY(22), H(222222));
await db.query(`select two_step_code_revoke($1,$2,$3)`, [ORG, DRIVER, rc.code_id]);
ok("a code revoked after its email failed is refused", (await verify(DRIVER, D1, KEY(22), H(222222))) === "expired");
await db.query(`select two_step_code_revoke($1,$2,$3)`, [ORG, ANA, (await issue(DRIVER, D1, KEY(23), H(232323))).code_id]);
ok("revoke names the person: another person's id revokes nothing", (await verify(DRIVER, D1, KEY(23), H(232323))) === "ok");

console.log("\n-- the gate --");
const N1 = await signIn(ANA);
const owed = await gate(ANA, N1, KEY(30));
ok("a device that never gave its code: two_step_at null, alive", owed.two_step_at === null && owed.session_alive === true);
ok("...and it takes no device place — a password alone fills nothing", owed.device_admitted === null && (await devices(ANA)) === 0);
await issue(ANA, N1, KEY(30), H(303030), { perHour: 50 });
await verify(ANA, N1, KEY(30), H(303030));
const given = await gate(ANA, N1, KEY(30));
ok("after the code: two_step_at is now, and the device takes its place", given.two_step_at !== null && given.device_admitted === true && (await devices(ANA)) === 1);
const N2 = await signIn(ANA);
ok("a NEW sign-in on the same device is trusted — the week belongs to the device, not the session", (await gate(ANA, N2, KEY(30))).two_step_at !== null);
ok("the same person on another device is not", (await gate(ANA, N2, KEY(31))).two_step_at === null);
ok("...nor the same device under another company", (await gate(ANA, N2, KEY(30), { org: ORG_B })) === undefined);
await db.query(`update two_step_devices set verified_at = now() - interval '8 days' where user_id=$1`, [ANA]);
const stale = await gate(ANA, await signIn(ANA), KEY(30));
ok("eight days on: the date is still reported (the API decides), and no new place is taken", stale.two_step_at !== null && stale.device_admitted === null);
ok("not required (a driver's role, said by the API): admitted without a code", (await gate(DRIVER, await signIn(DRIVER), KEY(40), { required: false })).device_admitted === true);
ok("required left null is read as required", (await all(`select * from member_access_gate($1,$2,$3,$4,3,12,7,null)`, [ORG, ANA, await signIn(ANA), KEY(41)]))[0].device_admitted === null);
const deadS = await signIn(BEN);
await db.query(`delete from auth.sessions where id=$1`, [deadS]);
ok("a dead session: not alive, nothing decided", (await gate(BEN, deadS, KEY(10))).session_alive === false);
ok("the role and suspension are reported as 0620 reported them", (await gate(BEN, B1, KEY(10))).role === "admin" && (await gate(BEN, B1, KEY(10))).suspended_at === null);

console.log("\n-- a browser --");
const claims = { sub: ANA, role: "authenticated", org_id: ORG, user_role: "dispatcher" };
ok("(the browser can read its own company — so the refusals below are not an empty sign-in)",
  ((await asUser(claims, `select id from organizations where id = '${ORG}'`)).rows ?? []).length === 1);
ok("a browser cannot call member_access_gate", !!(await asUser(claims, `select * from member_access_gate('${ORG}','${ANA}',null,'${KEY(1)}',3,12,7,true)`)).error);
ok("...nor issue a code", !!(await asUser(claims, `select * from two_step_code_issue('${ORG}','${ANA}',null,'${KEY(1)}','${H(1)}',10,5,60)`)).error);
ok("...nor enter one", !!(await asUser(claims, `select two_step_code_verify('${ORG}','${ANA}',null,'${KEY(1)}','${H(1)}',5)`)).error);
ok("...nor revoke one", !!(await asUser(claims, `select two_step_code_revoke('${ORG}','${ANA}','${first.code_id}')`)).error);
const seenC = await asUser(claims, `select * from two_step_codes`);
ok("...nor read the codes", !!seenC.error || seenC.rows.length === 0);
const seenD = await asUser(claims, `select * from two_step_devices`);
ok("...nor the trusted devices", !!seenD.error || seenD.rows.length === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
