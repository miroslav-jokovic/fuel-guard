// Silvicom 360 — office chat Web Push (migration 0599, CHAT-WEB-PUSH-PLAN WP1).
//
// What the database itself must guarantee, whoever calls the functions:
//   · one row per endpoint; the latest person to turn it on holds it, and a device that changed hands
//     starts a new history (D-WP1); only an active office member of the organisation may register;
//   · a person turns off or signs out of their own row only; offboarding (`revoke_push_tokens`) stops
//     every browser as well as every Expo phone;
//   · who a line is pushed to is Q-CHAT18 (a)'s rule (D-WP2): direct and group lines to every other
//     participant who has not muted them, channel lines only for a mention or a reply, `mentions` mute
//     rings for a mention only, `all` never; never the author, one who left, a suspended member, a
//     driver conversation, a retracted line or another organisation's;
//   · only whoever has not read past the line (D-WP3); an edit's new mention by Activity's read instant;
//   · a browser can call none of it and read no subscription.
//
// Run: node supabase/tests/chat-web-push.test.mjs
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
const CLEO = await person("cleo@silvicom.test", ORG, "safety_manager", "Cleo Safety");
const DEV = await person("dev@silvicom.test", ORG, "dispatcher", "Dev Dispatch");
const DRIVER = await person("driver@silvicom.test", ORG, "driver", "Dan Driver");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const tok = (id) => `<@${id}>`;
const send = async (actor, thread, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const reply = async (actor, thread, parent, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send_reply($1,$2,$3,$4,$5,$6)`, [ORG, actor, thread, mid, parent, body]);
  return mid;
};
const targets = async (message, mentioned = null, org = ORG) =>
  (await all(`select * from chat_push_targets($1,$2,$3)`, [org, message, mentioned])).map((r) => `${r.user_id}:${r.reason}`).sort();
const want = (...pairs) => pairs.map(([u, r]) => `${u}:${r}`).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastSeq = async (thread) => Number((await one(`select last_seq from message_threads where id=$1`, [thread])).last_seq);

// Keys shaped like a browser's: 65-byte P-256 point and 16-byte secret, base64url without padding.
const P256 = "B" + "a".repeat(86);
const AUTH = "c".repeat(22);
const ORIGIN = "https://360.silvicominc.com";
const E1 = "https://fcm.googleapis.com/fcm/send/device-one";
const E2 = "https://web.push.apple.com/device-two";
const subscribe = (org, user, endpoint, label = "Chrome on Android") =>
  one(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7) id`, [org, user, endpoint, P256, AUTH, ORIGIN, label]);
const row = (endpoint) => one(`select * from web_push_subscriptions where endpoint=$1`, [endpoint]);

// ── Subscriptions ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- subscriptions --");
const first = (await subscribe(ORG, ANA, E1)).id;
let r = await row(E1);
ok("an office member registers a device", r.user_id === ANA && r.org_id === ORG && r.revoked_at === null && r.origin === ORIGIN);
await db.query(`update web_push_subscriptions set last_success_at = now(), created_at = now() - interval '3 days' where id=$1`, [first]);
const again = (await subscribe(ORG, ANA, E1)).id;
r = await row(E1);
ok("registering the same device again refreshes the one row, keeping its history",
  again === first && r.last_success_at !== null && Date.now() - r.created_at.getTime() > 2 * 86400_000);
await subscribe(ORG, BEN, E1, "Chrome on Windows");
r = await row(E1);
ok("another person turning it on in the same browser takes the row over (one person per device)",
  r.user_id === BEN && r.device_label === "Chrome on Windows" && Number((await one(`select count(*) n from web_push_subscriptions where endpoint=$1`, [E1])).n) === 1);
ok("...and starts a new history: the last delivery was somebody else's",
  r.last_success_at === null && Date.now() - r.created_at.getTime() < 60_000);
ok("a driver cannot register (WP001)", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, DRIVER, E2, P256, AUTH, ORIGIN, null])) === "WP001");
ok("...nor somebody of another organisation", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, OUT, E2, P256, AUTH, ORIGIN, null])) === "WP001");
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, DEV]);
ok("...nor a suspended member", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, DEV, E2, P256, AUTH, ORIGIN, null])) === "WP001");
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, DEV]);
ok("an endpoint that is not https is refused", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, ANA, "http://fcm.googleapis.com/x", P256, AUTH, ORIGIN, null])) === "23514");
ok("a key that is not a browser's is refused", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, ANA, E2, "not a key", AUTH, ORIGIN, null])) === "23514");
ok("an origin with a path is refused", (await sqlstate(`select web_push_subscribe($1,$2,$3,$4,$5,$6,$7)`, [ORG, ANA, E2, P256, AUTH, `${ORIGIN}/chat`, null])) === "23514");

console.log("\n-- turning off --");
ok("a person cannot turn off somebody else's device",
  Number((await one(`select web_push_unsubscribe($1,$2,$3,'turned_off') n`, [ORG, ANA, E1])).n) === 0 && (await row(E1)).revoked_at === null);
ok("...the holder can", Number((await one(`select web_push_unsubscribe($1,$2,$3,'turned_off') n`, [ORG, BEN, E1])).n) === 1
  && (await row(E1)).revoked_reason === "turned_off");
ok("a reason other than turning off or signing out is refused", (await sqlstate(`select web_push_unsubscribe($1,$2,$3,'gone')`, [ORG, BEN, E1])) === "22023");
await subscribe(ORG, BEN, E1);
r = await row(E1);
ok("turning it on again clears the revocation", r.revoked_at === null && r.revoked_reason === null);
await subscribe(ORG, BEN, E2, "Safari on iPhone");
await db.query(`insert into device_push_tokens (token, org_id, user_id, platform) values ('ExponentPushToken[ben]', $1, $2, 'ios')`, [ORG, BEN]);
ok("offboarding revokes every browser and every Expo phone of the person",
  Number((await one(`select revoke_push_tokens($1) n`, [BEN])).n) === 3
  && Number((await one(`select count(*) n from web_push_subscriptions where user_id=$1 and revoked_reason='revoked_all'`, [BEN])).n) === 2
  && (await one(`select revoked_at from device_push_tokens where token='ExponentPushToken[ben]'`)).revoked_at !== null);

// ── Who a line is pushed to ──────────────────────────────────────────────────────────────────────
console.log("\n-- targets --");
const DIRECT = await uuid();
await db.query(`select chat_open_direct($1,$2,$3,$4)`, [ORG, ANA, BEN, DIRECT]);
const D1 = await send(ANA, DIRECT, "can you take 4417?");
ok("a direct line goes to the other person, never the author", same(await targets(D1), want([BEN, "line"])));
await db.query(`select chat_mark_read($1,$2,$3,$4)`, [ORG, BEN, DIRECT, await lastSeq(DIRECT)]);
ok("...and to nobody once they have read it, on any device (D-WP3)", (await targets(D1)).length === 0);
ok("nothing of it for another organisation", (await targets(D1, null, ORG_B)).length === 0);
// The author's own read boundary normally passes their line, which would hide the author rule; set it
// back so the rule itself is what keeps the author out.
await db.query(`update thread_participants set read_seq = 0 where thread_id=$1 and user_id=$2`, [DIRECT, ANA]);
ok("the author is never pushed their own line, whatever their read boundary", !(await targets(D1)).some((t) => t.startsWith(ANA)));

const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN, CLEO, DEV]]);
await db.query(`select chat_set_mute($1,$2,$3,'all')`, [ORG, BEN, GROUP]);
await db.query(`select chat_set_mute($1,$2,$3,'mentions')`, [ORG, CLEO, GROUP]);
const G1 = await send(ANA, GROUP, "trailer 88 is back");
ok("a group line goes to every participant who has not muted it", same(await targets(G1), want([DEV, "line"])));
const G2 = await send(ANA, GROUP, `${tok(CLEO)} ${tok(BEN)} can one of you sign?`);
ok("muted to mentions: a mention still rings; muted all: never", same(await targets(G2), want([CLEO, "mention"], [DEV, "line"])));
await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, DEV]);
const G3 = await send(ANA, GROUP, "anyone?");
ok("a suspended member is pushed nothing", (await targets(G3)).length === 0);
await db.query(`update memberships set suspended_at = null where org_id=$1 and user_id=$2`, [ORG, DEV]);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, DEV, GROUP]);
const G4 = await send(ANA, GROUP, "still anyone?");
ok("...nor somebody who left", !(await targets(G4)).some((t) => t.startsWith(DEV)));
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, G2]);
ok("a retracted line is pushed to nobody", (await targets(G2)).length === 0);

const DISPATCH = await uuid(), GENERAL = await uuid();
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, DISPATCH, GENERAL, [ANA, CLEO, DEV]]);
const POST = await send(CLEO, GENERAL, "Who has the 4417 paperwork?");
ok("a channel post rings nobody", (await targets(POST)).length === 0);
const R1 = await reply(ANA, GENERAL, POST, "I do");
ok("a reply rings the post's author", same(await targets(R1), want([CLEO, "reply"])));
const R2 = await reply(DEV, GENERAL, POST, `${tok(CLEO)} ${tok(BEN)} scanned it`);
ok("a later reply rings who replied before; a mention is a mention", same(await targets(R2), want([ANA, "reply"], [BEN, "mention"], [CLEO, "mention"])));
await db.query(`select chat_mark_read($1,$2,$3,$4)`, [ORG, CLEO, GENERAL, await lastSeq(GENERAL)]);
ok("...and not whoever has the channel read past it", same(await targets(R2), want([ANA, "reply"], [BEN, "mention"])));

const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office'),($1,$2,$4,'office')`, [DRIVER_THREAD, ORG, ANA, BEN]);
const DRV = await uuid();
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values ($1,$2,$3,$4,'load 9')`, [DRV, DRIVER_THREAD, ORG, ANA]);
ok("a driver conversation is never pushed (drivers have the app)", (await targets(DRV)).length === 0);

console.log("\n-- an edit --");
const E_LINE = await send(BEN, DIRECT, "the shop called");
await db.query(`select chat_mark_read($1,$2,$3,$4)`, [ORG, ANA, DIRECT, await lastSeq(DIRECT)]);
ok("an edit that names nobody new pushes nobody", (await targets(E_LINE, [])).length === 0);
await db.query(`select chat_edit($1,$2,$3,$4)`, [ORG, BEN, E_LINE, `${tok(ANA)} the shop called`]);
ok("an edit's new mention rings, though the line was read before it named them",
  same(await targets(E_LINE, [ANA]), want([ANA, "mention"])));
ok("...and nobody it does not newly name", (await targets(E_LINE, [CLEO])).length === 0);
await db.query(`select chat_activity_mark_read($1,$2,null)`, [ORG, ANA]);
ok("...until Activity is read past it", (await targets(E_LINE, [ANA])).length === 0);

// ── A browser ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- a browser --");
const claims = { sub: ANA, role: "authenticated" };
for (const [what, sql] of [
  ["web_push_subscribe", `select web_push_subscribe('${ORG}','${ANA}','${E2}','${P256}','${AUTH}','${ORIGIN}',null)`],
  ["web_push_unsubscribe", `select web_push_unsubscribe('${ORG}','${ANA}','${E2}','turned_off')`],
  ["chat_push_targets", `select * from chat_push_targets('${ORG}','${D1}',null)`],
  ["revoke_push_tokens", `select revoke_push_tokens('${BEN}')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
await subscribe(ORG, ANA, E2);
const seen = await asUser(claims, `select count(*) n from web_push_subscriptions`);
ok("a browser reads no subscription, not even its own", !!seen.error || Number(seen.rows[0].n) === 0);
ok("row level security is on", (await one(`select relrowsecurity r from pg_class where relname='web_push_subscriptions'`)).r === true);
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
