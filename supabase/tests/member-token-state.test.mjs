// Silvicom 360 — a token's state in one read (migration 0616, INSTALLED-APP-PLAN Q-IA10 (a)).
//
// What the database itself must guarantee, whoever calls the function:
//   · it answers what the membership read answered — the role and the suspension — and no row at all when
//     there is no membership in THAT organisation;
//   · the session is alive only when it exists, is that person's and is not past its own end; a session ended
//     through 0615, or through "sign out everywhere" (0363), is not alive from that moment;
//   · no session named is NULL — "cannot tell" — never false and never true;
//   · a browser cannot call it.
//
// Run: node supabase/tests/member-token-state.test.mjs
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
const session = async (user, notAfter = null) =>
  (await one(`insert into auth.sessions (user_id, created_at, updated_at, not_after) values ($1, now(), now(), $2::timestamptz) returning id`, [user, notAfter])).id;
const state = async (user, sess, org = ORG) => all(`select role::text, suspended_at, session_alive from member_token_state($1,$2,$3)`, [org, user, sess]);
const NOBODY = "00000000-0000-4000-8000-00000000dead";

const PC = await session(ANA);
const PHONE = await session(ANA);
const BENS = await session(BEN);

console.log("\n-- what the membership read answered --");
const s0 = await state(ANA, PC);
ok("one row: the role, not suspended, the session alive", s0.length === 1 && s0[0].role === "dispatcher" && s0[0].suspended_at === null && s0[0].session_alive === true);
ok("no membership in that organisation is no row", (await state(ANA, PC, ORG_B)).length === 0);
ok("...and nobody is no row", (await state(NOBODY, PC)).length === 0);
ok("a driver's token is answered like anybody's", (await state(DRIVER, await session(DRIVER)))[0].role === "driver");
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, ANA]);
ok("a suspension is reported, with the session still said alive — two separate facts",
  (await state(ANA, PC))[0].suspended_at instanceof Date && (await state(ANA, PC))[0].session_alive === true);
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, ANA]);

console.log("\n-- the session --");
ok("no session named is NULL — cannot tell", (await state(ANA, null))[0].session_alive === null);
ok("a session that does not exist is not alive", (await state(ANA, NOBODY))[0].session_alive === false);
ok("somebody else's live session is not alive for this person", (await state(ANA, BENS))[0].session_alive === false);
ok("...and is alive for its owner", (await state(BEN, BENS))[0].session_alive === true);
ok("a session past its own end is not alive", (await state(ANA, await session(ANA, "2026-11-14T21:00:00Z")))[0].session_alive === false);
ok("a session with an end still to come is alive", (await state(ANA, await session(ANA, "2099-01-01T00:00:00Z")))[0].session_alive === true);

console.log("\n-- ended --");
await db.query(`select member_session_end($1,$2,$3)`, [ORG, ANA, PHONE]);
ok("a device signed out through 0615 is not alive from that moment", (await state(ANA, PHONE))[0].session_alive === false);
ok("...and the person's other device still is", (await state(ANA, PC))[0].session_alive === true);
await db.query(`select revoke_user_sessions($1)`, [ANA]);
ok("sign out everywhere (0363) ends that one too", (await state(ANA, PC))[0].session_alive === false);
ok("...and nobody else's", (await state(BEN, BENS))[0].session_alive === true);

console.log("\n-- a browser --");
ok("a browser cannot call member_token_state",
  !!(await asUser({ sub: BEN, role: "authenticated" }, `select * from member_token_state('${ORG}','${BEN}','${BENS}')`)).error);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
