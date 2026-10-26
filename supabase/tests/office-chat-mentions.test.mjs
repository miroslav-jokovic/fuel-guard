// Silvicom 360 — office chat mentions, mute and Activity (migration 0521, OFFICE-CHAT-PLAN CH6b-1).
//
// What the database itself must guarantee, whoever calls the functions (§9.2's rows):
//   · a mention names somebody in the conversation now (Q-CHAT20): anybody else — a team member who
//     has not joined a public channel, one not in a private channel, another organisation — is CH013
//     and leaves no line; a driver conversation's words are never read for tokens;
//   · the index equals the body: an edit that removes a mention removes its row, one that adds one
//     adds it, and somebody named before they left stays named when the line is corrected;
//   · Activity is mentions of you and replies to posts you wrote or replied to, never your own line,
//     never a retracted one, never in a conversation you left; its read instant only moves forward;
//   · mute is one person's: another's is untouched, and it writes no ledger row;
//   · the bell's targets follow D-CHAT23: never the author, never a conversation muted `all`,
//     `mentions` still rings for a mention; the dedupe key moves with the read boundary;
//   · nothing of another organisation's; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-mentions.test.mjs
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
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const tok = (id) => `<@${id}>`;
const send = async (actor, thread, body, id) => {
  const mid = id ?? (await uuid());
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const reply = async (actor, thread, parent, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send_reply($1,$2,$3,$4,$5,$6)`, [ORG, actor, thread, mid, parent, body]);
  return mid;
};
const named = async (message) => (await all(`select user_id from message_mentions where message_id=$1 order by user_id`, [message])).map((r) => r.user_id);
const activity = (user, org = ORG) => all(`select * from chat_activity($1,$2,null,null,50)`, [org, user]);
const unread = async (user) => Number((await one(`select chat_activity_unread($1,$2) n`, [ORG, user])).n);
const targets = (message) => all(`select * from chat_notify_targets($1,$2)`, [ORG, message]);
const lastSeq = async (thread) => Number((await one(`select last_seq from message_threads where id=$1`, [thread])).last_seq);

// A group of Ana, Ben and Cleo; a Dispatch team of all four, with a public Loads channel only Cleo is
// in and a private Payroll channel of Ben and Cleo.
const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN, CLEO]]);
const DISPATCH = await uuid(), GENERAL = await uuid(), LOADS = await uuid(), PAYROLL = await uuid();
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, DISPATCH, GENERAL, [ANA, CLEO, DEV]]);
await db.query(`select chat_channel_create($1,$2,$3,$4,'Loads','public',null)`, [ORG, CLEO, DISPATCH, LOADS]);
await db.query(`select chat_channel_create($1,$2,$3,$4,'Payroll','private',$5)`, [ORG, BEN, DISPATCH, PAYROLL, [CLEO]]);

// ── Mentions ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- mentions --");
const M1 = await send(ANA, GROUP, `${tok(BEN)} can you take 4417? ${tok(BEN)} and ${tok(CLEO.toUpperCase())} too`);
ok("a token names a person once, whatever its case", JSON.stringify(await named(M1)) === JSON.stringify([BEN, CLEO].sort()));

let seqBefore = await lastSeq(GROUP);
let msgId = await uuid();
ok("naming somebody not in the conversation is CH013", (await sqlstate(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, ANA, GROUP, msgId, `hi ${tok(DEV)}`])) === "CH013");
ok("...and writes no line and takes no position",
  !(await one(`select 1 x from messages where id=$1`, [msgId])) && (await lastSeq(GROUP)) === seqBefore);
ok("...as does naming somebody of another organisation", (await sqlstate(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, ANA, GROUP, await uuid(), tok(OUT)])) === "CH013");

seqBefore = await lastSeq(LOADS);
ok("a team member who has not joined a public channel cannot be named in it (Q-CHAT20)",
  (await sqlstate(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, CLEO, LOADS, await uuid(), `${tok(DEV)} see this`])) === "CH013"
  && (await lastSeq(LOADS)) === seqBefore);
await db.query(`select chat_channel_add_members($1,$2,$3,$4)`, [ORG, CLEO, LOADS, [DEV]]);
const L1 = await send(CLEO, LOADS, `${tok(DEV)} see this`);
ok("...and can once they are added", JSON.stringify(await named(L1)) === JSON.stringify([DEV]));
ok("a team member not in a private channel cannot be named in it",
  (await sqlstate(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, BEN, PAYROLL, await uuid(), tok(ANA)])) === "CH013");

const PLAIN = await send(ANA, GROUP, "ask <@bob> or <@1234> or @Ben");
ok("anything but `<@uuid>` is text: sent, nobody named", (await named(PLAIN)).length === 0);

// A driver conversation (0096) is written by /api/messages and is not office chat's syntax.
const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office')`, [DRIVER_THREAD, ORG, ANA]);
const DRV = await uuid();
ok("a driver conversation's words are never read for tokens",
  (await sqlstate(`insert into messages (id, thread_id, org_id, sender_user_id, body) values ($1,$2,$3,$4,$5)`, [DRV, DRIVER_THREAD, ORG, ANA, tok(DEV)])) === null
  && (await named(DRV)).length === 0);

// Edits keep the index equal to the body.
await db.query(`select chat_edit($1,$2,$3,$4)`, [ORG, ANA, M1, `${tok(BEN)} can you take 4417?`]);
ok("an edit that removes a mention removes its row", JSON.stringify(await named(M1)) === JSON.stringify([BEN]));
const benAt = (await one(`select created_at from message_mentions where message_id=$1 and user_id=$2`, [M1, BEN])).created_at;
await db.query(`select chat_edit($1,$2,$3,$4)`, [ORG, ANA, M1, `${tok(BEN)} can you take 4417? cc ${tok(CLEO)}`]);
ok("an edit that adds one adds it", JSON.stringify(await named(M1)) === JSON.stringify([BEN, CLEO].sort()));
ok("...and a mention the edit kept keeps its time",
  (await one(`select created_at from message_mentions where message_id=$1 and user_id=$2`, [M1, BEN])).created_at.getTime() === benAt.getTime());
const versionsBefore = Number((await one(`select count(*) n from message_versions where message_id=$1`, [M1])).n);
ok("an edit naming somebody not in the conversation is CH013",
  (await sqlstate(`select chat_edit($1,$2,$3,$4)`, [ORG, ANA, M1, `${tok(BEN)} ${tok(CLEO)} ${tok(DEV)}`])) === "CH013");
ok("...and leaves the words and their versions as they were",
  (await one(`select body from messages where id=$1`, [M1])).body === `${tok(BEN)} can you take 4417? cc ${tok(CLEO)}`
  && Number((await one(`select count(*) n from message_versions where message_id=$1`, [M1])).n) === versionsBefore);

const M2 = await send(ANA, GROUP, `${tok(CLEO)} morning`);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
ok("a person named before they left stays named when the line is corrected",
  (await sqlstate(`select chat_edit($1,$2,$3,$4)`, [ORG, ANA, M2, `${tok(CLEO)} good morning`])) === null
  && JSON.stringify(await named(M2)) === JSON.stringify([CLEO]));
ok("...but cannot be named afresh", (await sqlstate(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, ANA, GROUP, await uuid(), tok(CLEO)])) === "CH013");
await db.query(`select chat_add_members($1,$2,$3,$4)`, [ORG, ANA, GROUP, [CLEO]]);

const m1Facts = await all(`select action, body_sha256 from chat_ledger where message_id=$1 order by seq`, [M1]);
ok("a mention is no ledger row of its own: the line's rows hash the body that carries it",
  m1Facts.map((f) => f.action).join() === "message_sent,message_edited,message_edited"
  && m1Facts.at(-1).body_sha256 === (await one(`select chat_sha256(body) h from messages where id=$1`, [M1])).h, JSON.stringify(m1Facts));

// ── Activity ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- activity --");
let benAct = await activity(BEN);
ok("Activity lists a mention of you, with its conversation and who said it",
  benAct.some((a) => a.message_id === M1 && a.reason === "mention" && a.thread_id === GROUP && a.kind === "group"
    && a.subject === "Night desk" && a.sender_name === "Ana Petrović" && a.unread === true), JSON.stringify(benAct));
const SELF = await send(BEN, GROUP, `note to ${tok(BEN)}: call the shop`);
ok("...never your own line, even one naming you", !(await activity(BEN)).some((a) => a.message_id === SELF));
ok("...and nothing of yours in another organisation's Activity", (await activity(BEN, ORG_B)).length === 0);

const GONE = await send(ANA, GROUP, `${tok(BEN)} wrong truck`);
ok("a retracted line's mention leaves Activity",
  (await activity(BEN)).some((a) => a.message_id === GONE)
  && (await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, GONE]), !(await activity(BEN)).some((a) => a.message_id === GONE)));

// Replies: Cleo posts in General; Ana answers; Dev answers after her.
const POST = await send(CLEO, GENERAL, "Who has the 4417 paperwork?");
const EARLY = await reply(BEN, GENERAL, POST, "not me");
const R1 = await reply(ANA, GENERAL, POST, "I do");
const R2 = await reply(DEV, GENERAL, POST, "scanned it too");
const R3 = await reply(DEV, GENERAL, POST, `${tok(ANA)} thanks`);
const cleoAct = await activity(CLEO);
ok("the author of a post sees every reply to it", [EARLY, R1, R2, R3].every((r) => cleoAct.some((a) => a.message_id === r && a.reason === "reply" && a.parent_id === POST)));
const anaAct = await activity(ANA);
ok("a person who replied sees the replies after theirs", anaAct.some((a) => a.message_id === R2 && a.reason === "reply"));
ok("...not the ones before, nor their own", !anaAct.some((a) => a.message_id === EARLY || a.message_id === R1));
ok("a reply that also names you is one item, a mention", anaAct.filter((a) => a.message_id === R3).map((a) => a.reason).join() === "mention");
ok("Activity is newest first", cleoAct.every((a, i) => i === 0 || cleoAct[i - 1].at >= a.at));
const page1 = await all(`select * from chat_activity($1,$2,null,null,2)`, [ORG, CLEO]);
const page2 = await all(`select * from chat_activity($1,$2,$3,$4,2)`, [ORG, CLEO, page1[1].at, page1[1].message_id]);
ok("...and pages without repeating or skipping", page1.length === 2 && page2.length === 2
  && new Set([...page1, ...page2].map((a) => a.message_id)).size === 4 && page2[0].at <= page1[1].at);

// Read instant.
const cleoUnread = await unread(CLEO);
ok("the unread count is the unread items", cleoUnread === cleoAct.filter((a) => a.unread).length && cleoUnread > 0);
const readAt = (await one(`select chat_activity_mark_read($1,$2,null) at`, [ORG, CLEO])).at;
ok("marking Activity read clears it", (await unread(CLEO)) === 0 && (await activity(CLEO)).every((a) => !a.unread));
ok("...and leaves another person's untouched", (await unread(ANA)) > 0);
const back = (await one(`select chat_activity_mark_read($1,$2,$3) at`, [ORG, CLEO, "2020-01-01T00:00:00Z"])).at;
ok("the read instant never moves back", back.getTime() === readAt.getTime());
const ahead = (await one(`select chat_activity_mark_read($1,$2,$3) at, now() n`, [ORG, CLEO, "2999-01-01T00:00:00Z"]));
ok("...nor past now", ahead.at.getTime() <= ahead.n.getTime());
// PGlite's clock can read the same instant for two statements in a row; a person replies later than that.
await new Promise((r) => setTimeout(r, 20));
const R4 = await reply(ANA, GENERAL, POST, "on your desk");
ok("a reply after the read instant is unread again", (await activity(CLEO)).find((a) => a.message_id === R4)?.unread === true && (await unread(CLEO)) === 1);

await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, BEN, GROUP]);
ok("Activity never lists a conversation you left", !(await activity(BEN)).some((a) => a.thread_id === GROUP));
await db.query(`select chat_add_members($1,$2,$3,$4)`, [ORG, ANA, GROUP, [BEN]]);

// ── Mute ──────────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- mute --");
const muteOf = async (thread, user) => (await one(`select muted from thread_participants where thread_id=$1 and user_id=$2`, [thread, user])).muted;
const ledgerAtMute = Number((await one(`select count(*) n from chat_ledger where org_id=$1`, [ORG])).n);
ok("a person mutes a conversation", (await one(`select chat_set_mute($1,$2,$3,'all') m`, [ORG, BEN, GROUP])).m === "all" && (await muteOf(GROUP, BEN)) === "all");
ok("...which writes no ledger row", Number((await one(`select count(*) n from chat_ledger where org_id=$1`, [ORG])).n) === ledgerAtMute);
ok("...and leaves another person's mute untouched", (await muteOf(GROUP, ANA)) === "none" && (await muteOf(GROUP, CLEO)) === "none");
ok("the shown inbox carries it", (await one(`select muted from chat_inbox($1,$2,array['group'],null,null,50,$3)`, [ORG, BEN, GROUP])).muted === "all");
ok("a mute is none, mentions or all", (await sqlstate(`select chat_set_mute($1,$2,$3,'loud')`, [ORG, BEN, GROUP])) === "CH006"
  && (await sqlstate(`select chat_set_mute($1,$2,$3,null)`, [ORG, BEN, GROUP])) === "CH006");
ok("somebody not in the conversation cannot mute it", (await sqlstate(`select chat_set_mute($1,$2,$3,'all')`, [ORG, DEV, GROUP])) === "CH001");
ok("...nor another organisation", (await sqlstate(`select chat_set_mute($1,$2,$3,'all')`, [ORG_B, OUT, GROUP])) === "CH001");

// ── The bell's targets (D-CHAT23) ─────────────────────────────────────────────────────────────────
console.log("\n-- bell targets --");
await db.query(`select chat_set_mute($1,$2,$3,'none')`, [ORG, BEN, GROUP]);
const B1 = await send(ANA, GROUP, `${tok(BEN)} ${tok(ANA)} the 4417 again`);
let tg = await targets(B1);
const benRead = Number((await one(`select read_seq from thread_participants where thread_id=$1 and user_id=$2`, [GROUP, BEN])).read_seq);
ok("a mention tells the person named, keyed by their read boundary",
  tg.length === 1 && tg[0].user_id === BEN && tg[0].category === "chat_mention" && tg[0].dedupe_key === `chat_mention:${GROUP}:${benRead}`, JSON.stringify(tg));
ok("...never the author, even naming themselves", !tg.some((t) => t.user_id === ANA));
const B2 = await send(ANA, GROUP, `${tok(BEN)} and again`);
ok("a second mention before they read folds into the same bell item", (await targets(B2))[0].dedupe_key === tg[0].dedupe_key);
await db.query(`select chat_mark_read($1,$2,$3,null)`, [ORG, BEN, GROUP]);
const B3 = await send(ANA, GROUP, `${tok(BEN)} one more`);
ok("...and the first one after they read is a new one", (await targets(B3))[0].dedupe_key !== tg[0].dedupe_key);
await db.query(`select chat_set_mute($1,$2,$3,'mentions')`, [ORG, BEN, GROUP]);
ok("muted to mentions, a mention still rings", (await targets(await send(ANA, GROUP, `${tok(BEN)} hi`))).some((t) => t.user_id === BEN));
await db.query(`select chat_set_mute($1,$2,$3,'all')`, [ORG, BEN, GROUP]);
ok("muted all, nothing rings", (await targets(await send(ANA, GROUP, `${tok(BEN)} hi`))).length === 0);
ok("a line naming nobody rings nobody", (await targets(await send(ANA, GROUP, "plain words"))).length === 0);

const R5 = await reply(BEN, GENERAL, POST, "found it");
tg = await targets(R5);
ok("a reply tells the post's author and everyone who replied before, as replies",
  [CLEO, ANA, DEV].every((u) => tg.some((t) => t.user_id === u && t.category === "chat_reply")) && tg.length === 3, JSON.stringify(tg));
ok("...never the person replying", !tg.some((t) => t.user_id === BEN));
await db.query(`select chat_set_mute($1,$2,$3,'mentions')`, [ORG, DEV, GENERAL]);
const R6 = await reply(ANA, GENERAL, POST, `${tok(CLEO)} all sorted`);
tg = await targets(R6);
ok("muted to mentions, a reply does not ring", !tg.some((t) => t.user_id === DEV));
ok("a reply naming the author is one item, a mention", tg.filter((t) => t.user_id === CLEO).map((t) => t.category).join() === "chat_mention");
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, R6]);
ok("a retracted line rings nobody", (await targets(R6)).length === 0);
const LPOST = await send(CLEO, LOADS, "Truck 12 is in the yard");
await reply(DEV, LOADS, LPOST, "on it");
await db.query(`select chat_channel_leave($1,$2,$3,null,false)`, [ORG, DEV, LOADS]);
ok("somebody who replied and then left hears nothing more of it", !(await targets(await reply(CLEO, LOADS, LPOST, "thanks"))).some((t) => t.user_id === DEV));
ok("another organisation's line is nothing here", (await all(`select * from chat_notify_targets($1,$2)`, [ORG_B, R5])).length === 0);

// ── The bell's categories and the browser ─────────────────────────────────────────────────────────
console.log("\n-- categories and access --");
const check = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='notification_events_category_check'`)).d;
ok("the bell accepts the two chat categories", check.includes("'chat_mention'") && check.includes("'chat_reply'") && check.includes("'unit_file_expired'"));
const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_activity", `select * from chat_activity('${ORG}','${BEN}',null,null,50)`],
  ["chat_activity_mark_read", `select chat_activity_mark_read('${ORG}','${BEN}',null)`],
  ["chat_set_mute", `select chat_set_mute('${ORG}','${BEN}','${GROUP}','none')`],
  ["chat_notify_targets", `select * from chat_notify_targets('${ORG}','${B1}')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
const seen = await asUser(claims, `select count(*) n from message_mentions`);
ok("a browser reads no mention rows", !!seen.error || Number(seen.rows[0].n) === 0);
const state = await asUser(claims, `select count(*) n from chat_person_state`);
ok("...nor anybody's Activity state", !!state.error || Number(state.rows[0].n) === 0);
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
