// Silvicom 360 — office chat Do not disturb (migration 0603, CHAT-WEB-PUSH-PLAN WP5; D-WP13, D-WP14).
//
// What the database itself must guarantee, whoever calls the functions:
//   · a person who paused, or is inside their nightly window in THEIR timezone (wrapping midnight), is pushed
//     nothing — a direct line or a mention alike — and is pushed again once the pause has passed;
//   · the pause never touches the bell: `notification_allowed` answers exactly as 0154 did — window suppresses
//     non-critical, critical passes, the pause plays no part, an unknown timezone allows;
//   · the setters refuse a non-member, a pause beyond seven days, half a window, an unknown timezone; a pause in
//     the past is a resume; the state says whether it holds now;
//   · a browser can call none of it.
//
// Run: node supabase/tests/chat-do-not-disturb.test.mjs
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

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const send = async (actor, thread, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const pushed = async (message) => (await all(`select user_id from chat_push_targets($1,$2,null)`, [ORG, message])).map((r) => r.user_id);
const quietAt = async (user, at) => (await one(`select person_quiet_at($1,$2::timestamptz) q`, [user, at])).q;
const bell = async (user, at, severity = "info") =>
  (await one(`select notification_allowed($1,$2,'fuel_alert',$3,$4::timestamptz) a`, [ORG, user, severity, at])).a;

const DIRECT = await uuid();
await db.query(`select chat_open_direct($1,$2,$3,$4)`, [ORG, ANA, BEN, DIRECT]);

console.log("\n-- nobody has set anything --");
const L0 = await send(ANA, DIRECT, "4417 is loaded");
ok("a person with no preferences is pushed as before", JSON.stringify(await pushed(L0)) === JSON.stringify([BEN]));
ok("...and the bell allows as before", (await bell(BEN, "2026-11-13T03:00:00Z")) === true);

console.log("\n-- the pause --");
const until = (await one(`select chat_dnd_pause($1,$2, now() + interval '1 hour') u`, [ORG, BEN])).u;
ok("pausing returns the instant it lasts until", until instanceof Date && until.getTime() > Date.now());
const L1 = await send(ANA, DIRECT, `<@${BEN}> are you there?`);
ok("a paused person is pushed nothing — not even a mention in a direct line", (await pushed(L1)).length === 0);
ok("the pause does not touch the bell (D-WP14): its alerts still arrive", (await bell(BEN, new Date().toISOString())) === true);
const st = await one(`select * from chat_dnd_state($1,$2)`, [ORG, BEN]);
ok("the state says it holds now, and until when", st.quiet_now === true && st.paused_until.getTime() === until.getTime());
await db.query(`select chat_dnd_pause($1,$2,null)`, [ORG, BEN]);
ok("resuming pushes again (the line is still unread)", JSON.stringify(await pushed(L1)) === JSON.stringify([BEN]));
await db.query(`select chat_dnd_pause($1,$2, now() - interval '1 minute')`, [ORG, BEN]);
ok("a pause in the past is a resume", (await one(`select paused_until from notification_preferences where user_id=$1`, [BEN])).paused_until === null);
ok("a pause beyond seven days is refused", (await sqlstate(`select chat_dnd_pause($1,$2, now() + interval '8 days')`, [ORG, BEN])) === "22023");
ok("a driver cannot pause chat notifications (WP001)", (await sqlstate(`select chat_dnd_pause($1,$2, now() + interval '1 hour')`, [ORG, DRIVER])) === "WP001");
ok("...nor somebody of another organisation", (await sqlstate(`select chat_dnd_pause($1,$2, now() + interval '1 hour')`, [ORG, OUT])) === "WP001");
ok("...and their state reads as nothing", (await all(`select * from chat_dnd_state($1,$2)`, [ORG, OUT])).length === 0);

console.log("\n-- every night, in the person's own timezone --");
await db.query(`select chat_dnd_schedule($1,$2,'22:00','07:00','America/Chicago')`, [ORG, BEN]);
// 2026-11-13 is CST (UTC-6): 23:30 Chicago = 05:30Z next day; 06:59 = 12:59Z; 07:00 = 13:00Z; 21:59 = 03:59Z.
ok("23:30 in Chicago is quiet", (await quietAt(BEN, "2026-11-14T05:30:00Z")) === true);
ok("06:59 in Chicago is quiet (the window wraps midnight)", (await quietAt(BEN, "2026-11-14T12:59:00Z")) === true);
ok("07:00 is not — the end is open", (await quietAt(BEN, "2026-11-14T13:00:00Z")) === false);
ok("21:59 is not", (await quietAt(BEN, "2026-11-14T03:59:00Z")) === false);
ok("...whatever the server's own clock zone says: 23:30 UTC is 17:30 in Chicago", (await quietAt(BEN, "2026-11-13T23:30:00Z")) === false);
ok("a window that does not wrap: 13:00–14:00", await (async () => {
  await db.query(`select chat_dnd_schedule($1,$2,'13:00','14:00','UTC')`, [ORG, BEN]);
  return (await quietAt(BEN, "2026-11-14T13:30:00Z")) === true && (await quietAt(BEN, "2026-11-14T14:00:00Z")) === false;
})());

console.log("\n-- the bell keeps 0154's rule (D-WP13) --");
await db.query(`select chat_dnd_schedule($1,$2,'22:00','07:00','America/Chicago')`, [ORG, BEN]);
ok("the bell suppresses a non-critical alert inside the window, as it always has", (await bell(BEN, "2026-11-14T05:30:00Z")) === false);
ok("...lets a critical one through", (await bell(BEN, "2026-11-14T05:30:00Z", "critical")) === true);
ok("...and allows outside it", (await bell(BEN, "2026-11-14T15:00:00Z")) === true);
await db.query(`update notification_preferences set timezone = 'Mars/Olympus' where user_id=$1`, [BEN]);
ok("an unknown timezone silences nobody — on the bell", (await bell(BEN, "2026-11-14T05:30:00Z")) === true);
ok("...or on the phone", (await quietAt(BEN, "2026-11-14T05:30:00Z")) === false);
ok("a muted bell category is still muted", await (async () => {
  await db.query(`update notification_preferences set muted_categories = '{fuel_alert}', timezone='UTC' where user_id=$1`, [BEN]);
  const r = (await bell(BEN, "2026-11-14T15:00:00Z")) === false;
  await db.query(`update notification_preferences set muted_categories = '{}' where user_id=$1`, [BEN]);
  return r;
})());
await db.query(`delete from org_modules where org_id=$1 and module_key='notifications'`, [ORG]);
ok("...and an org without the notifications module still gets no bell alerts", (await bell(BEN, "2026-11-14T15:00:00Z")) === false);

console.log("\n-- the setters refuse what makes no sense --");
ok("half a window is refused", (await sqlstate(`select chat_dnd_schedule($1,$2,'22:00',null,'UTC')`, [ORG, BEN])) === "22023");
ok("a window that starts where it ends is refused", (await sqlstate(`select chat_dnd_schedule($1,$2,'22:00','22:00','UTC')`, [ORG, BEN])) === "22023");
ok("an unknown timezone is refused", (await sqlstate(`select chat_dnd_schedule($1,$2,'22:00','07:00','Mars/Olympus')`, [ORG, BEN])) === "22023");
await db.query(`select chat_dnd_schedule($1,$2,null,null,'UTC')`, [ORG, BEN]);
ok("no window clears it", (await quietAt(BEN, "2026-11-14T05:30:00Z")) === false);
ok("the pause and the window are one row per person, never a second", Number((await one(`select count(*) n from notification_preferences where user_id=$1`, [BEN])).n) === 1);

console.log("\n-- a browser --");
const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_dnd_pause", `select chat_dnd_pause('${ORG}','${BEN}', now() + interval '1 hour')`],
  ["chat_dnd_schedule", `select chat_dnd_schedule('${ORG}','${BEN}','22:00','07:00','UTC')`],
  ["chat_dnd_state", `select * from chat_dnd_state('${ORG}','${BEN}')`],
  ["person_quiet_at", `select person_quiet_at('${BEN}', now())`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
