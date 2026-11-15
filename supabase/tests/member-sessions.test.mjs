// Silvicom 360 — signed-in devices (migration 0615, INSTALLED-APP-PLAN IA-S3; Q-IA3 (b)).
//
// What the database itself must guarantee, whoever calls the functions:
//   · the reader returns a member's sessions, most recently used first, as six fields and nothing of a token;
//     a session past its own end is not a device; a person who is not of the organisation asked for has none;
//   · any member's are answerable — a driver's and a suspended person's included — because those are the ones
//     an admin has to end;
//   · ending one ends exactly that one, only when it is that person's and they are of that organisation, and
//     answers 0 rather than failing for anything else;
//   · a browser can call neither.
//
// `auth.sessions` is Supabase's table and the matrices shim only `auth.users`, so this file builds it with the
// columns measured on production on 2026-11-15 — including the token key the reader must never return.
//
// Run: node supabase/tests/member-sessions.test.mjs
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
const BOTH = await person("both@silvicom.test", ORG, "dispatcher", "Bo Both");
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'dispatcher')`, [ORG_B, BOTH]);

const session = async (user, { created, used = created, ua = "Mozilla/5.0 (test)", ip = "203.0.113.7", notAfter = null } = {}) =>
  (await one(
    `insert into auth.sessions (user_id, created_at, updated_at, user_agent, ip, not_after, refresh_token_hmac_key)
     values ($1,$2::timestamptz,$3::timestamptz,$4,$5::inet,$6::timestamptz,'SECRET-KEY-MATERIAL') returning id`,
    [user, created, used, ua, ip, notAfter])).id;
const list = async (user, org = ORG) => all(`select * from member_sessions($1,$2)`, [org, user]);
const end = async (user, id, org = ORG) => (await one(`select member_session_end($1,$2,$3) n`, [org, user, id])).n;
const left = async (user) => Number((await one(`select count(*) n from auth.sessions where user_id=$1`, [user])).n);

console.log("\n-- nobody is signed in --");
ok("a member with no sessions has none", (await list(ANA)).length === 0);

console.log("\n-- a person's devices --");
const PC = await session(ANA, { created: "2026-11-01T14:00:00Z", used: "2026-11-15T16:00:00Z", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/142", ip: "203.0.113.7" });
const PHONE = await session(ANA, { created: "2026-11-10T09:00:00Z", used: "2026-11-15T18:30:00Z", ua: "Mozilla/5.0 (iPhone) Safari/605", ip: "198.51.100.24" });
const OLD = await session(ANA, { created: "2026-09-02T09:00:00Z", used: null });
const BENS = await session(BEN, { created: "2026-11-12T09:00:00Z" });
const rows = await list(ANA);
ok("lists that person's sessions and nobody else's", rows.length === 3 && rows.every((r) => [PC, PHONE, OLD].includes(r.id)));
ok("most recently used first", rows.map((r) => r.id).join() === [PHONE, PC, OLD].join());
ok("six fields, and nothing of a token",
  Object.keys(rows[0]).sort().join() === "created_at,expires_at,id,ip,last_used_at,user_agent" && !JSON.stringify(rows).includes("SECRET"));
ok("says when it was last used, and what and where from",
  rows[0].last_used_at.toISOString() === "2026-11-15T18:30:00.000Z" && rows[0].user_agent === "Mozilla/5.0 (iPhone) Safari/605" && rows[0].ip === "198.51.100.24");
ok("the address is plain, without a network mask", rows.every((r) => !String(r.ip).includes("/")));
ok("a session never refreshed was last used when it was created", rows[2].last_used_at.toISOString() === "2026-09-02T09:00:00.000Z");
ok("an IPv6 address reads as one", await (async () => {
  const v6 = await session(BEN, { created: "2026-11-13T09:00:00Z", ip: "2001:db8::17" });
  const r = (await list(BEN)).find((x) => x.id === v6);
  await db.query(`delete from auth.sessions where id=$1`, [v6]);
  return r.ip === "2001:db8::17";
})());

console.log("\n-- a session with an end of its own --");
const DEAD = await session(ANA, { created: "2026-11-14T09:00:00Z", notAfter: "2026-11-14T21:00:00Z" });
const TIMED = await session(ANA, { created: "2026-11-15T09:00:00Z", used: "2026-11-15T09:00:01Z", notAfter: "2099-01-01T00:00:00Z" });
const now = await list(ANA);
ok("one that is past its end is not a device", !now.some((r) => r.id === DEAD));
ok("one that has an end still to come is listed with it", now.find((r) => r.id === TIMED)?.expires_at?.toISOString() === "2099-01-01T00:00:00.000Z");
ok("...and the others have none", now.find((r) => r.id === PC).expires_at === null);
await db.query(`delete from auth.sessions where id = any($1::uuid[])`, [[DEAD, TIMED]]);

console.log("\n-- whose may be asked about --");
ok("another organisation is told nothing about this person", (await list(ANA, ORG_B)).length === 0);
ok("...and this organisation nothing about theirs", await (async () => {
  await session(OUT, { created: "2026-11-12T09:00:00Z" });
  return (await list(OUT)).length === 0 && (await list(OUT, ORG_B)).length === 1;
})());
const DRIVERS = await session(DRIVER, { created: "2026-11-12T09:00:00Z" });
ok("a driver's phone is a device of this organisation", (await list(DRIVER)).map((r) => r.id).join() === DRIVERS);
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, ANA]);
ok("a suspended person's sessions are still answerable — they are the ones to end", (await list(ANA)).length === 3);
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, ANA]);
const SHARED = await session(BOTH, { created: "2026-11-12T09:00:00Z" });
ok("a person of two organisations has one set of sessions, answerable in both",
  (await list(BOTH)).map((r) => r.id).join() === SHARED && (await list(BOTH, ORG_B)).map((r) => r.id).join() === SHARED);

console.log("\n-- ending one --");
ok("ends that one and says so", (await end(ANA, PHONE)) === 1);
ok("...and only that one", (await list(ANA)).map((r) => r.id).join() === [PC, OLD].join() && (await left(BEN)) === 1);
ok("ending it again answers 0, not an error", (await end(ANA, PHONE)) === 0);
ok("somebody else's session is not ended by naming it under this person", (await end(ANA, BENS)) === 0 && (await left(BEN)) === 1);
ok("...nor this person's by naming them under another organisation", (await end(ANA, PC, ORG_B)) === 0 && (await left(ANA)) === 2);
ok("...nor a stranger's by an organisation they are not of", await (async () => {
  const theirs = (await list(OUT, ORG_B))[0].id;
  return (await end(OUT, theirs)) === 0 && (await left(OUT)) === 1;
})());
ok("no session named ends nothing", (await end(ANA, null)) === 0 && (await left(ANA)) === 2);
ok("a driver's can be ended", (await end(DRIVER, DRIVERS)) === 1 && (await left(DRIVER)) === 0);
ok("a person of two organisations can be ended from either", (await end(BOTH, SHARED, ORG_B)) === 1 && (await left(BOTH)) === 0);

console.log("\n-- a browser --");
const claims = { sub: ANA, role: "authenticated" };
for (const [what, sql] of [
  ["member_sessions", `select * from member_sessions('${ORG}','${ANA}')`],
  ["member_session_end", `select member_session_end('${ORG}','${ANA}','${PC}')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
ok("...and the session is still there after it tried", (await left(ANA)) === 2);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
