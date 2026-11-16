// Silvicom 360 — two-step sign-in: the company's date and a person's factor, in the API's one read
// (migration 0617, INSTALLED-APP-PLAN IA-S1).
//
// What the database itself must guarantee, whoever calls the function:
//   · every company has a date, 14 days after it (or the column) was made, and it can be moved;
//   · the function answers everything 0616's does, identically — it is to replace it — plus two FACTS:
//     that company's date, and whether THIS person has a VERIFIED factor (an abandoned enrolment is not one,
//     and somebody else's is not theirs);
//   · it decides nothing about who is required: an admin and a dispatcher get the same shape of answer;
//   · a browser cannot call it, and cannot read or move the date.
//
// `auth.mfa_factors` is Supabase's table, built here with the columns measured on production 2026-11-15.
//
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
const session = async (user, notAfter = null) =>
  (await one(`insert into auth.sessions (user_id, created_at, updated_at, not_after) values ($1, now(), now(), $2::timestamptz) returning id`, [user, notAfter])).id;
const factor = async (user, status) =>
  (await one(`insert into auth.mfa_factors (user_id, factor_type, status, secret) values ($1,'totp',$2::auth.factor_status,'TOTP-SECRET') returning id`, [user, status])).id;
const state = async (user, sess, org = ORG) => all(`select * from member_access_state($1,$2,$3)`, [org, user, sess]);
const old = async (user, sess, org = ORG) => all(`select role::text, suspended_at, session_alive from member_token_state($1,$2,$3)`, [org, user, sess]);
const days = (d) => (d.getTime() - Date.now()) / 86_400_000;

console.log("\n-- the company's date --");
const d = (await one(`select second_factor_required_from f from organizations where id=$1`, [ORG])).f;
ok("a company has a date 14 days out", d instanceof Date && days(d) > 13.9 && days(d) < 14.1);
const NEW = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Made later') returning second_factor_required_from f`)).f;
ok("a company made later gets its own 14 days", days(NEW) > 13.9 && days(NEW) < 14.1);
ok("the date cannot be emptied", (await sqlstate(`update organizations set second_factor_required_from = null where id=$1`, [ORG])) === "23502");

console.log("\n-- everything 0616's function answers, the same --");
const PC = await session(ANA);
const BENS = await session(BEN);
const same = async (user, sess, org = ORG) => {
  const n = await state(user, sess, org), o = await old(user, sess, org);
  return n.length === o.length && (n.length === 0 || (n[0].role === o[0].role && String(n[0].suspended_at) === String(o[0].suspended_at) && n[0].session_alive === o[0].session_alive));
};
ok("a live session", (await same(ANA, PC)) && (await state(ANA, PC))[0].session_alive === true);
ok("no session named is NULL", (await same(ANA, null)) && (await state(ANA, null))[0].session_alive === null);
ok("somebody else's session is not alive", (await same(ANA, BENS)) && (await state(ANA, BENS))[0].session_alive === false);
ok("no membership in that organisation is no row", (await same(ANA, PC, ORG_B)) && (await state(ANA, PC, ORG_B)).length === 0);
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, ANA]);
ok("a suspension", (await same(ANA, PC)) && (await state(ANA, PC))[0].suspended_at instanceof Date);
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, ANA]);
await db.query(`delete from auth.sessions where id=$1`, [PC]);
ok("an ended session", (await same(ANA, PC)) && (await state(ANA, PC))[0].session_alive === false);

console.log("\n-- the two facts --");
const s0 = (await state(BEN, BENS))[0];
ok("seven fields would be a leak; it is five", Object.keys(s0).sort().join() === "has_second_factor,role,second_factor_required_from,session_alive,suspended_at");
ok("the date is the company's", s0.second_factor_required_from.getTime() === d.getTime());
ok("nobody has a factor until they have one", s0.has_second_factor === false && (await state(ANA, null))[0].has_second_factor === false);
const HALF = await factor(BEN, "unverified");
ok("an enrolment started and abandoned is not a factor", (await state(BEN, BENS))[0].has_second_factor === false);
await db.query(`update auth.mfa_factors set status='verified' where id=$1`, [HALF]);
ok("a verified one is", (await state(BEN, BENS))[0].has_second_factor === true);
ok("...and is that person's, not their colleague's", (await state(ANA, null))[0].has_second_factor === false);
ok("nothing of the factor's secret is returned", !JSON.stringify(await state(BEN, BENS)).includes("TOTP-SECRET"));
await factor(ANA, "verified");
ok("a dispatcher who turned it on is reported exactly as an admin is — who is REQUIRED is not decided here",
  (await state(ANA, null))[0].has_second_factor === true && (await state(ANA, null))[0].role === "dispatcher");
await db.query(`delete from auth.mfa_factors where user_id=$1`, [BEN]);
ok("a removed factor is gone from the answer", (await state(BEN, BENS))[0].has_second_factor === false);
await db.query(`update organizations set second_factor_required_from = '2026-01-01T00:00:00Z' where id=$1`, [ORG]);
ok("a company's date can be moved, and only that company's",
  (await state(BEN, BENS))[0].second_factor_required_from.toISOString() === "2026-01-01T00:00:00.000Z"
  && days((await state(OUT, null, ORG_B))[0].second_factor_required_from) > 13.9);

console.log("\n-- 0618: the notice period starts when the notice ships --");
const run0618 = () => db.exec(read(join("migrations", "0618_second_factor_notice_starts.sql")));
// ORG's date was moved to the past above — a company already being held to it; ORG_B's is still ahead.
await db.query(`update organizations set second_factor_required_from = now() + interval '3 days' where id=$1`, [ORG_B]);
await run0618();
ok("a company still inside its notice gets the full 14 days again", days((await one(`select second_factor_required_from f from organizations where id=$1`, [ORG_B])).f) > 13.9);
ok("a company already being held to it is NOT given a fresh two weeks",
  (await one(`select second_factor_required_from f from organizations where id=$1`, [ORG])).f.toISOString() === "2026-01-01T00:00:00.000Z");

console.log("\n-- a browser --");
// As the token hook mints it for the company's own ADMIN — the browser with the most reach there is.
const claims = { sub: BEN, role: "authenticated", org_id: ORG, user_role: "admin" };
ok("(the admin's browser can read its own company — so the next two refusals are not an empty sign-in)",
  ((await asUser(claims, `select id from organizations where id = '${ORG}'`)).rows ?? []).length === 1);
ok("a browser cannot call member_access_state", !!(await asUser(claims, `select * from member_access_state('${ORG}','${BEN}','${BENS}')`)).error);
const moved = await asUser(claims, `update organizations set second_factor_required_from = now() + interval '10 years' where id = '${ORG}' returning id`);
ok("...and cannot move its company's date", !!moved.error || moved.rows.length === 0);
ok("...which is still where it was", (await one(`select second_factor_required_from f from organizations where id=$1`, [ORG])).f.toISOString() === "2026-01-01T00:00:00.000Z");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
