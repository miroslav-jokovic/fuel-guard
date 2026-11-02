// Silvicom 360 — office chat: reactions to your lines in Activity (migration 0541, OFFICE-CHAT-PLAN
// CH6c, D-CHAT25's third reason).
//
// What the database itself must guarantee, whoever calls the functions:
//   · somebody else's reaction to a line of yours is one Activity item for that line, saying the latest
//     reaction — who and which — and arriving when it did; your own reactions never count;
//   · it stays derived: taking the latest back lets the one before stand in, taking the last back removes
//     the item; a retracted line or a conversation you left drops it, as for mentions and replies;
//   · a new reaction after you read Activity is unread again, and the badge counts what the list shows;
//   · mentions and replies are as 0521 left them, and paging still visits every item exactly once;
//   · nothing of another organisation's; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-activity-reactions.test.mjs
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
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const send = async (actor, thread, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const react = (actor, message, reaction, on = true) =>
  db.query(`select chat_react($1,$2,$3,$4,$5)`, [ORG, actor, message, reaction, on]);
// Reactions land microseconds apart; the rows that turn on "which is latest" set the instant themselves.
const at = (actor, message, reaction, iso) =>
  db.query(`update message_reactions set created_at=$4 where message_id=$1 and user_id=$2 and reaction=$3`, [message, actor, reaction, iso]);
const activity = (user, org = ORG) => all(`select * from chat_activity($1,$2,null,null,50)`, [org, user]);
const itemOf = async (user, message) => (await activity(user)).filter((a) => a.message_id === message);
const unread = async (user) => Number((await one(`select chat_activity_unread($1,$2) n`, [ORG, user])).n);
const iso = (d) => new Date(d).toISOString();

const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN, CLEO, DEV]]);

// ── One item per line, the latest reaction speaking ───────────────────────────────────────────────
console.log("\n-- a reaction to your line --");
const M1 = await send(ANA, GROUP, "Truck 12 is loaded");
ok("before anybody reacts, Ana's own line is not in her Activity", (await itemOf(ANA, M1)).length === 0);
await react(BEN, M1, "thumbs_up");
await at(BEN, M1, "thumbs_up", "2026-11-02T10:00:00Z");
let items = await itemOf(ANA, M1);
ok("Ben's 👍 on Ana's line is one Activity item of hers, reason reaction",
  items.length === 1 && items[0].reason === "reaction", JSON.stringify(items));
ok("...saying who and which, the line's sender staying Ana",
  items[0]?.reaction === "thumbs_up" && items[0]?.reactor_user_id === BEN && items[0]?.reactor_name === "Ben Admin"
  && items[0]?.sender_user_id === ANA && items[0]?.body === "Truck 12 is loaded", JSON.stringify(items[0]));
ok("...arriving when the reaction did, not when the line was sent",
  iso(items[0]?.at) === "2026-11-02T10:00:00.000Z", String(items[0]?.at));
ok("Ben's own reaction is nothing in Ben's Activity", (await itemOf(BEN, M1)).length === 0);

await react(ANA, M1, "done");
await at(ANA, M1, "done", "2026-11-02T11:00:00Z");
items = await itemOf(ANA, M1);
ok("Ana reacting to her own line, later, does not speak for it: still Ben's 👍",
  items.length === 1 && items[0].reactor_user_id === BEN && items[0].reaction === "thumbs_up", JSON.stringify(items));

await react(CLEO, M1, "heart");
await at(CLEO, M1, "heart", "2026-11-02T12:00:00Z");
await react(DEV, M1, "thumbs_up");
await at(DEV, M1, "thumbs_up", "2026-11-02T09:00:00Z");
items = await itemOf(ANA, M1);
ok("four reactions from three people are still ONE item for the line",
  items.length === 1, JSON.stringify(items));
ok("...the latest speaks for it: Cleo's ❤, at Cleo's instant",
  items[0]?.reactor_user_id === CLEO && items[0]?.reaction === "heart" && iso(items[0]?.at) === "2026-11-02T12:00:00.000Z",
  JSON.stringify(items[0]));

// Two at one instant: the choice is total, so two reads never disagree.
const M2 = await send(ANA, GROUP, "Detention at the shipper");
await react(BEN, M2, "sad"); await react(CLEO, M2, "sad");
await at(BEN, M2, "sad", "2026-11-02T08:00:00Z"); await at(CLEO, M2, "sad", "2026-11-02T08:00:00Z");
const tieWinner = [BEN, CLEO].sort().at(-1);
const tie1 = await itemOf(ANA, M2), tie2 = await itemOf(ANA, M2);
ok("two reactions at one instant: one item, the same reactor every read (the larger id)",
  tie1.length === 1 && tie1[0].reactor_user_id === tieWinner && tie2[0].reactor_user_id === tieWinner, JSON.stringify(tie1));

// ── Derived: taking back, retracting, leaving ─────────────────────────────────────────────────────
console.log("\n-- it stays derived --");
await react(CLEO, M1, "heart", false);
items = await itemOf(ANA, M1);
ok("Cleo takes her ❤ back: Ben's 👍 at 10:00 stands in (Dev's at 09:00 is older)",
  items.length === 1 && items[0].reactor_user_id === BEN && iso(items[0].at) === "2026-11-02T10:00:00.000Z", JSON.stringify(items));
await react(BEN, M1, "thumbs_up", false);
await react(DEV, M1, "thumbs_up", false);
ok("every reaction of others taken back (Ana's own ✅ left): the item is gone", (await itemOf(ANA, M1)).length === 0);

const M3 = await send(ANA, GROUP, "Wrong truck, ignore");
await react(BEN, M3, "laugh");
ok("a reaction to a line Ana then retracts is in her Activity first...", (await itemOf(ANA, M3)).length === 1);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, M3]);
ok("...and gone once the line is", (await itemOf(ANA, M3)).length === 0);

// ── Unread and the badge ──────────────────────────────────────────────────────────────────────────
console.log("\n-- unread --");
const M4 = await send(ANA, GROUP, "Fuel stop at Effingham");
const readAt = (await one(`select chat_activity_mark_read($1,$2,null) at`, [ORG, ANA])).at;
ok("after Ana reads Activity, nothing of hers is unread", (await unread(ANA)) === 0);
await react(DEV, M4, "surprised");
// A clock can return one instant twice in a row; the reaction is set a second after the read, as it is in life.
await at(DEV, M4, "surprised", new Date(new Date(readAt).getTime() + 1000).toISOString());
items = await itemOf(ANA, M4);
ok("a reaction after she read is an unread item", items.length === 1 && items[0].unread === true, JSON.stringify(items));
ok("...and the badge counts exactly the unread items the list shows",
  (await unread(ANA)) === (await activity(ANA)).filter((a) => a.unread).length && (await unread(ANA)) === 1);
await react(BEN, M2, "done");
await at(BEN, M2, "done", new Date(new Date(readAt).getTime() + 2000).toISOString());
ok("a new reaction to an OLD line lifts it to the top of the list, unread",
  (await activity(ANA))[0].message_id === M2 && (await activity(ANA))[0].unread === true, JSON.stringify((await activity(ANA))[0]));

// ── Mentions and replies unchanged; paging ────────────────────────────────────────────────────────
console.log("\n-- mentions, replies, paging --");
const NAMED = await send(BEN, GROUP, `<@${ANA}> can you take the 4pm?`);
items = await itemOf(ANA, NAMED);
ok("a mention of Ana is still a mention item, with no reaction and no reactor",
  items.length === 1 && items[0].reason === "mention" && items[0].reaction === null && items[0].reactor_user_id === null
  && items[0].reactor_name === null, JSON.stringify(items));
await react(DEV, NAMED, "thumbs_up");
ok("a reaction to somebody else's line is nothing of Ana's: her mention item stays the only one",
  (await itemOf(ANA, NAMED)).length === 1 && (await itemOf(ANA, NAMED))[0].reason === "mention");
ok("...it is Ben's line, so Dev's 👍 is a reaction item in BEN's Activity",
  (await itemOf(BEN, NAMED)).length === 1 && (await itemOf(BEN, NAMED))[0].reason === "reaction"
  && (await itemOf(BEN, NAMED))[0].reactor_user_id === DEV);

const full = await activity(ANA);
const walked = [];
let before = [null, null];
for (let guard = 0; guard < 20; guard++) {
  const page = await all(`select * from chat_activity($1,$2,$3,$4,1)`, [ORG, ANA, before[0], before[1]]);
  if (!page.length) break;
  walked.push(page[0].message_id);
  before = [page[0].at, page[0].message_id];
}
ok("paging one at a time visits all three items (M2, M4, the mention) exactly once, in the list's order",
  full.length === 3 && JSON.stringify(walked) === JSON.stringify(full.map((a) => a.message_id)),
  `${JSON.stringify(walked)} vs ${JSON.stringify(full.map((a) => a.message_id))}`);
ok("every message is one item at most — the list keys on it",
  new Set(full.map((a) => a.message_id)).size === full.length);

// ── Leaving; another organisation; the browser ────────────────────────────────────────────────────
console.log("\n-- leaving, isolation, the browser --");
ok("before Ana leaves, the group's reactions are in her Activity", (await activity(ANA)).some((a) => a.reason === "reaction"));
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, ANA, GROUP]);
ok("once she has left the conversation, none of its items are", (await activity(ANA)).length === 0);
ok("another organisation's call for the same person sees nothing", (await activity(ANA, ORG_B)).length === 0);
ok("...nor for its own admin", (await activity(OUT, ORG_B)).length === 0);

const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_activity", `select * from chat_activity('${ORG}','${BEN}',null,null,50)`],
  ["chat_activity_items", `select * from chat_activity_items('${ORG}','${BEN}')`],
  ["chat_activity_unread", `select chat_activity_unread('${ORG}','${BEN}')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
