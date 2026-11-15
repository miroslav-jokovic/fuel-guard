// Silvicom 360 — office chat: message text kept off the lock screen (migration 0614, INSTALLED-APP-PLAN IA-S4;
// Q-IA4 (a)).
//
// What the database itself must guarantee, whoever calls the functions:
//   · nobody hides until they say so, and saying so is one row per person beside their Do not disturb, which
//     it leaves exactly as it was (and which leaves it);
//   · the reader answers for a list: only the people in it who hide, never a person of another organisation,
//     a driver, or a suspended member;
//   · WHO is pushed does not change — a person who hides is pushed exactly as before;
//   · the setter refuses a non-member, a driver and a null; a browser can call neither function.
//
// Run: node supabase/tests/chat-push-text-hidden.test.mjs
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
await db.query(`insert into org_modules (org_id, module_key, enabled) values ($1,'notifications',true)`, [ORG]);

const hidden = async (users, org = ORG) => (await all(`select user_id from chat_push_text_hidden_for($1,$2::uuid[])`, [org, users])).map((r) => r.user_id);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const DIRECT = await uuid();
await db.query(`select chat_open_direct($1,$2,$3,$4)`, [ORG, ANA, BEN, DIRECT]);
const send = async (actor, thread, text) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, text]);
  return mid;
};
const pushed = async (message) => (await all(`select user_id from chat_push_targets($1,$2,null)`, [ORG, message])).map((r) => r.user_id);

console.log("\n-- nobody has set anything --");
ok("nobody hides by default", (await hidden([ANA, BEN, DRIVER, OUT])).length === 0);
ok("the column is false for a row written without it", await (async () => {
  await db.query(`select chat_dnd_pause($1,$2, now() + interval '1 hour')`, [ORG, ANA]);
  const r = await one(`select hide_push_text h from notification_preferences where user_id=$1`, [ANA]);
  await db.query(`select chat_dnd_pause($1,$2,null)`, [ORG, ANA]);
  return r.h === false;
})());

console.log("\n-- one person turns it on --");
ok("the setter returns what is now stored", (await one(`select chat_push_hide_text($1,$2,true) h`, [ORG, BEN])).h === true);
ok("that person hides", same(await hidden([BEN]), [BEN]));
ok("asked about several, only the one who hides is answered", same(await hidden([ANA, BEN]), [BEN]));
ok("asked about nobody, nobody is answered", (await hidden([])).length === 0);
ok("a person not in the list is not answered, even though they hide", (await hidden([ANA])).length === 0);
const L1 = await send(ANA, DIRECT, "4417 is loaded");
ok("a person who hides is pushed exactly as before — hiding is not muting", same(await pushed(L1), [BEN]));

console.log("\n-- beside Do not disturb, on one row --");
await db.query(`select chat_dnd_schedule($1,$2,'22:00','07:00','America/Chicago')`, [ORG, BEN]);
await db.query(`select chat_dnd_pause($1,$2, now() + interval '1 hour')`, [ORG, BEN]);
ok("setting a window and a pause leaves the switch on", same(await hidden([BEN]), [BEN]));
await db.query(`select chat_push_hide_text($1,$2,false)`, [ORG, BEN]);
const row = await one(`select paused_until, quiet_hours_start::text s, quiet_hours_end::text e, timezone, hide_push_text h from notification_preferences where user_id=$1`, [BEN]);
ok("turning the switch off leaves the pause and the window as they were",
  row.h === false && row.paused_until instanceof Date && row.s === "22:00:00" && row.e === "07:00:00" && row.timezone === "America/Chicago");
ok("...and nobody hides again", (await hidden([ANA, BEN])).length === 0);
ok("it is one row per person, never a second", Number((await one(`select count(*) n from notification_preferences where user_id=$1`, [BEN])).n) === 1);
await db.query(`select chat_dnd_pause($1,$2,null)`, [ORG, BEN]);
await db.query(`select chat_push_hide_text($1,$2,true)`, [ORG, BEN]);

console.log("\n-- who may be asked about, and who may set --");
ok("another organisation is not told that this person hides", (await hidden([BEN], ORG_B)).length === 0);
await db.query(`select chat_push_hide_text($1,$2,true)`, [ORG_B, OUT]);
ok("...and this organisation is not told about theirs", (await hidden([BEN, OUT])).join() === BEN && same(await hidden([OUT], ORG_B), [OUT]));
// Ana, not Ben: Ben is this organisation's only admin, and `memberships_keep_an_admin` (AM010) refuses to suspend him.
await db.query(`select chat_push_hide_text($1,$2,true)`, [ORG, ANA]);
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, ANA]);
ok("a suspended member is not answered", same(await hidden([ANA, BEN]), [BEN]));
ok("...and cannot set it (WP001)", (await sqlstate(`select chat_push_hide_text($1,$2,false)`, [ORG, ANA])) === "WP001");
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, ANA]);
ok("...and is answered again once reinstated: the switch was kept", same(await hidden([ANA, BEN]), [ANA, BEN]));
await db.query(`select chat_push_hide_text($1,$2,false)`, [ORG, ANA]);
ok("a driver cannot set it (WP001)", (await sqlstate(`select chat_push_hide_text($1,$2,true)`, [ORG, DRIVER])) === "WP001");
ok("...nor somebody of another organisation", (await sqlstate(`select chat_push_hide_text($1,$2,true)`, [ORG, OUT])) === "WP001");
ok("null is refused, not read as off", (await sqlstate(`select chat_push_hide_text($1,$2,null)`, [ORG, BEN])) === "22023");
ok("...and the refusal changed nothing", same(await hidden([BEN]), [BEN]));

console.log("\n-- a browser --");
const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_push_hide_text", `select chat_push_hide_text('${ORG}','${BEN}', false)`],
  ["chat_push_text_hidden_for", `select * from chat_push_text_hidden_for('${ORG}', array['${BEN}']::uuid[])`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
ok("...and the switch is still on after it tried", same(await hidden([BEN]), [BEN]));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
