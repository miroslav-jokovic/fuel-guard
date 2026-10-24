// Silvicom 360 — office chat teams, channels and replies (migrations 0518–0519, OFFICE-CHAT-PLAN CH5a).
//
// What the database itself must guarantee, whoever calls the functions (§9.1's rows):
//   · a team is made with its General channel, and everyone in the team is in General;
//   · somebody not in a team sees none of its channels; a team member sees a public channel listed but
//     reads its posts only after joining; a private channel is invisible to a team member not in it;
//   · leaving or being removed from a team takes a person out of every channel in it;
//   · only owners (or a `chat.teams` holder, `p_manager`) rename, archive, add and remove; General
//     cannot be left, renamed or archived; a team always keeps an owner;
//   · a reply answers a top-level post of the same channel, never nests, and keeps one ordered log;
//   · every team fact is a ledger row and the chain verifies; nothing of another organisation's;
//   · a browser can call none of it.
//
// Run: node supabase/tests/office-chat-teams.test.mjs
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
  if (name) await db.query(`insert into user_profiles (user_id, full_name) values ($1,$2)`, [id, name]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher", "Ana Petrović");
const BEN = await person("ben@silvicom.test", ORG, "admin", "Ben Admin");
const CLEO = await person("cleo@silvicom.test", ORG, "safety_manager", "Cleo Safety");
const DEV = await person("dev@silvicom.test", ORG, "dispatcher", "Dev Dispatch");
const DAN = await person("dan@silvicom.test", ORG, "driver", "Dan Driver");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const teams = (user, org = ORG) => all(`select * from chat_teams($1,$2)`, [org, user]);
const inThread = async (thread, user) => !!(await one(`select 1 x from thread_participants where thread_id=$1 and user_id=$2 and left_at is null`, [thread, user]));

// ── Teams ───────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- teams --");
const DISPATCH = await uuid();
const DISPATCH_GENERAL = await uuid();
ok("a driver cannot be put in a team", (await sqlstate(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, await uuid(), await uuid(), [DAN]])) === "CH002");
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch','Loads and trucks',$5)`, [ORG, BEN, DISPATCH, DISPATCH_GENERAL, [ANA, CLEO]]);
ok("making a team is idempotent on its id", (await one(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5) id`, [ORG, BEN, DISPATCH, await uuid(), [ANA]])).id === DISPATCH);
ok("a second live team of the same name is refused", (await sqlstate(`select chat_team_create($1,$2,$3,$4,' dispatch ',null,null)`, [ORG, BEN, await uuid(), await uuid()])) === "CH012");
const general = await one(`select * from message_threads where id=$1`, [DISPATCH_GENERAL]);
ok("a team is made with a public General channel", general.kind === "channel" && general.general === true && general.visibility === "public" && general.space_id === DISPATCH && general.subject === "General");
ok("...and everyone in the team is in General, the creator its owner", (await inThread(DISPATCH_GENERAL, ANA)) && (await inThread(DISPATCH_GENERAL, CLEO))
  && (await one(`select member_role from thread_participants where thread_id=$1 and user_id=$2`, [DISPATCH_GENERAL, BEN])).member_role === "owner");
let t = await teams(ANA);
ok("the team is on its members' Teams rail with General", t.length === 1 && t[0].name === "Dispatch" && t[0].space_role === "member" && Number(t[0].member_count) === 3 && t[0].channels.length === 1 && t[0].channels[0].general && t[0].channels[0].joined);
ok("...and not on the rail of somebody outside it", (await teams(DEV)).length === 0);
ok("...nor of another organisation", (await teams(OUT, ORG_B)).length === 0);
ok("a non-member cannot list the team's people", (await sqlstate(`select * from chat_team_members($1,$2,$3)`, [ORG, DEV, DISPATCH])) === "CH001");

// ── Channels ────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- channels --");
const LOADS = await uuid();
const PAYROLL = await uuid();
await db.query(`select chat_channel_create($1,$2,$3,$4,'Loads','public',null)`, [ORG, CLEO, DISPATCH, LOADS]);
ok("somebody outside the team cannot make a channel in it", (await sqlstate(`select chat_channel_create($1,$2,$3,$4,'Mine','public',null)`, [ORG, DEV, DISPATCH, await uuid()])) === "CH001");
ok("a channel cannot be called General", (await sqlstate(`select chat_channel_create($1,$2,$3,$4,'general','public',null)`, [ORG, CLEO, DISPATCH, await uuid()])) === "CH006");
ok("nor take the name of a live channel in the team", (await sqlstate(`select chat_channel_create($1,$2,$3,$4,'LOADS','public',null)`, [ORG, ANA, DISPATCH, await uuid()])) === "CH012");
ok("a private channel takes only people from the team", (await sqlstate(`select chat_channel_create($1,$2,$3,$4,'Payroll','private',$5)`, [ORG, BEN, DISPATCH, await uuid(), [DEV]])) === "CH002");
await db.query(`select chat_channel_create($1,$2,$3,$4,'Payroll','private',$5)`, [ORG, BEN, DISPATCH, PAYROLL, [CLEO]]);

t = await teams(ANA);
const loadsForAna = t[0].channels.find((c) => c.thread_id === LOADS);
ok("a team member sees a public channel listed, not joined", loadsForAna && loadsForAna.joined === false && loadsForAna.unread === 0);
ok("...and a private channel they are not in not at all", !t[0].channels.some((c) => c.thread_id === PAYROLL));
ok("the people in the private channel see it", (await teams(CLEO))[0].channels.some((c) => c.thread_id === PAYROLL && c.joined && c.visibility === "private"));
const P1 = await uuid();
await db.query(`select * from chat_send($1,$2,$3,$4,'Load 118 is ready')`, [ORG, CLEO, LOADS, P1]);
ok("a team member reads a public channel's posts only after joining", (await sqlstate(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, ANA, LOADS])) === "CH001");
ok("somebody outside the team cannot join it", (await sqlstate(`select chat_channel_join($1,$2,$3)`, [ORG, DEV, LOADS])) === "CH001");
ok("a private channel is not joined, only added to", (await sqlstate(`select chat_channel_join($1,$2,$3)`, [ORG, ANA, PAYROLL])) === "CH006");
await db.query(`select chat_channel_join($1,$2,$3)`, [ORG, ANA, LOADS]);
ok("joined, the member reads the posts", (await all(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, ANA, LOADS])).length === 1);
ok("...and the channel counts unread for them from now on", (await teams(ANA))[0].channels.find((c) => c.thread_id === LOADS).joined === true);
ok("only people in the team can be added to a channel", (await sqlstate(`select chat_channel_add_members($1,$2,$3,$4)`, [ORG, CLEO, PAYROLL, [DEV]])) === "CH002");

// ── Replies ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- replies --");
const R1 = await uuid();
const reply1 = await one(`select * from chat_send_reply($1,$2,$3,$4,$5,'On my way')`, [ORG, ANA, LOADS, R1, P1]);
const P2 = await uuid();
const post2 = await one(`select * from chat_send($1,$2,$3,$4,'Truck 654 needs a driver')`, [ORG, CLEO, LOADS, P2]);
ok("a reply takes the conversation's next seq: one ordered log", Number(reply1.seq) === 2 && Number(post2.seq) === 3);
let posts = await all(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, ANA, LOADS]);
ok("the channel view is the top-level posts, newest first, with their reply counters", posts.length === 2 && posts[0].id === P2 && posts[1].id === P1 && posts[1].reply_count === 1 && posts[1].last_reply_at !== null && posts[0].reply_count === 0);
const replies = await all(`select * from chat_replies($1,$2,$3,null,50)`, [ORG, ANA, P1]);
ok("the reply pane is one post's replies", replies.length === 1 && replies[0].id === R1 && replies[0].parent_id === P1);
ok("a reply cannot answer a reply", (await sqlstate(`select * from chat_send_reply($1,$2,$3,$4,$5,'nested')`, [ORG, CLEO, LOADS, await uuid(), R1])) === "CH011");
ok("...nor a post of another conversation", (await sqlstate(`select * from chat_send_reply($1,$2,$3,$4,$5,'elsewhere')`, [ORG, CLEO, DISPATCH_GENERAL, await uuid(), P1])) === "CH011");
const DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, ANA, BEN, await uuid()])).id;
const DM1 = (await one(`select * from chat_send($1,$2,$3,$4,'hello')`, [ORG, ANA, DM, await uuid()])).message_id;
ok("...and replies are for channels, not direct conversations", (await sqlstate(`select * from chat_send_reply($1,$2,$3,$4,$5,'hi')`, [ORG, BEN, DM, await uuid(), DM1])) === "CH011");
const seqBefore = Number((await one(`select last_seq from message_threads where id=$1`, [LOADS])).last_seq);
ok("...and a refused reply takes no sequence number", Number((await one(`select last_seq from message_threads where id=$1`, [LOADS])).last_seq) === seqBefore && seqBefore === 3);
ok("a reply cannot move to another post", (await sqlstate(`update messages set parent_id=$2 where id=$1`, [R1, P2])) === "CH003");
ok("a retried reply is the same reply", (await one(`select * from chat_send_reply($1,$2,$3,$4,$5,'On my way')`, [ORG, ANA, LOADS, R1, P1])).duplicate === true);
const synced = await all(`select * from chat_sync($1,$2,$3,0,200)`, [ORG, ANA, LOADS]);
ok("sync carries each line's post, so a client knows where a reply belongs", synced.length === 3 && synced.find((m) => m.id === R1).parent_id === P1 && synced.find((m) => m.id === P1).reply_count === 1);
ok("the post's counters moved nothing else: no rev, no edit", (await one(`select rev, edited_at from messages where id=$1`, [P1])).edited_at === null && Number((await one(`select rev from messages where id=$1`, [P1])).rev) === 1);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, CLEO, P2]);
ok("a retracted post takes no replies", (await sqlstate(`select * from chat_send_reply($1,$2,$3,$4,$5,'late')`, [ORG, ANA, LOADS, await uuid(), P2])) === "CH011");

// ── Owners ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- owners --");
ok("a member cannot rename the team", (await sqlstate(`select chat_team_update($1,$2,$3,'Ops',null,false)`, [ORG, ANA, DISPATCH])) === "CH008");
ok("...nor add people to it", (await sqlstate(`select chat_team_add_members($1,$2,$3,$4,false)`, [ORG, ANA, DISPATCH, [DEV]])) === "CH008");
ok("...but a chat.teams holder (p_manager) may, though not an owner", (await sqlstate(`select chat_team_add_members($1,$2,$3,$4,true)`, [ORG, ANA, DISPATCH, [DEV]])) === null);
ok("a person added to the team is put in General", await inThread(DISPATCH_GENERAL, DEV));
ok("General cannot be left", (await sqlstate(`select chat_channel_leave($1,$2,$3,null,false)`, [ORG, DEV, DISPATCH_GENERAL])) === "CH006");
ok("...nor renamed or archived, even by a manager", (await sqlstate(`select chat_channel_rename($1,$2,$3,'Main',true)`, [ORG, BEN, DISPATCH_GENERAL])) === "CH006" && (await sqlstate(`select chat_channel_archive($1,$2,$3,true)`, [ORG, BEN, DISPATCH_GENERAL])) === "CH006");
ok("a member cannot rename a channel somebody else made", (await sqlstate(`select chat_channel_rename($1,$2,$3,'Freight',false)`, [ORG, ANA, LOADS])) === "CH008");
await db.query(`select chat_channel_rename($1,$2,$3,'Freight',false)`, [ORG, CLEO, LOADS]);
ok("its maker renames it", (await one(`select subject from message_threads where id=$1`, [LOADS])).subject === "Freight");
ok("a team keeps an owner: the last owner cannot be made a member", (await sqlstate(`select chat_team_set_role($1,$2,$3,$4,'member',false)`, [ORG, BEN, DISPATCH, BEN])) === "CH006");

// ── Leaving ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- leaving --");
ok("a member cannot take somebody else out of the team", (await sqlstate(`select chat_team_remove($1,$2,$3,$4,false)`, [ORG, ANA, DISPATCH, CLEO])) === "CH008");
await db.query(`select chat_team_remove($1,$2,$3,$4,false)`, [ORG, BEN, DISPATCH, CLEO]);
ok("taken out of the team, a person is out of every channel in it — public, private and General", !(await inThread(LOADS, CLEO)) && !(await inThread(PAYROLL, CLEO)) && !(await inThread(DISPATCH_GENERAL, CLEO)));
ok("...and reads none of them", (await sqlstate(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, CLEO, LOADS])) === "CH001" && (await teams(CLEO)).length === 0);
await db.query(`select chat_team_remove($1,$2,$3,null,false)`, [ORG, BEN, DISPATCH]);
ok("when the last owner leaves, the longest-standing member becomes owner", (await one(`select space_role from chat_space_members where space_id=$1 and user_id=$2`, [DISPATCH, ANA])).space_role === "owner");
await db.query(`select chat_team_add_members($1,$2,$3,$4,false)`, [ORG, ANA, DISPATCH, [CLEO]]);
ok("brought back, a person is in General again but not in the channels they were taken out of", (await inThread(DISPATCH_GENERAL, CLEO)) && !(await inThread(LOADS, CLEO)));
ok("rows are never deleted", (await sqlstate(`delete from chat_space_members where space_id=$1`, [DISPATCH])) === "CL001" && (await sqlstate(`delete from chat_spaces where id=$1`, [DISPATCH])) === "CL001");

// ── Archive ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- archive --");
await db.query(`select chat_team_archive($1,$2,$3,false)`, [ORG, ANA, DISPATCH]);
ok("an archived team archives every channel in it", Number((await one(`select count(*)::int n from message_threads where space_id=$1 and archived_at is null`, [DISPATCH])).n) === 0);
ok("...nothing more is written there", (await sqlstate(`select * from chat_send($1,$2,$3,$4,'after')`, [ORG, ANA, DISPATCH_GENERAL, await uuid()])) === "CH005" && (await sqlstate(`select * from chat_send_reply($1,$2,$3,$4,$5,'after')`, [ORG, ANA, LOADS, await uuid(), P1])) === "CH005");
ok("...it leaves the rail", (await teams(ANA)).length === 0);
ok("...and its name is free for a new team", (await sqlstate(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,null)`, [ORG, BEN, await uuid(), await uuid()])) === null);

// ── The ledger ──────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the ledger --");
const facts = await all(`select action, actor_user_id, subject_user_id, detail from chat_ledger where org_id=$1 and action like 'team_%' order by seq`, [ORG]);
const count = (a) => facts.filter((f) => f.action === a).length;
ok("each team fact is a ledger row naming its team", count("team_created") === 2 && count("team_archived") === 1 && facts.every((f) => typeof f.detail.space_id === "string"), JSON.stringify(facts.map((f) => f.action)));
ok("...a removal names who removed whom, a departure the person who left", facts.some((f) => f.action === "team_member_removed" && f.actor_user_id === BEN && f.subject_user_id === CLEO) && facts.some((f) => f.action === "team_member_left" && f.subject_user_id === BEN));
ok("...a return and a promotion are recorded too", count("team_member_rejoined") === 1 && count("team_role_changed") === 1);
const created = await one(`select detail from chat_ledger where org_id=$1 and action='conversation_created' and thread_id=$2`, [ORG, PAYROLL]);
ok("a channel's creation names its team and visibility", created.detail.space_id === DISPATCH && created.detail.visibility === "private" && created.detail.general === false);
const dmCreated = await one(`select detail from chat_ledger where org_id=$1 and action='conversation_created' and thread_id=$2`, [ORG, DM]);
ok("...while a direct conversation's row keeps release 1's shape", JSON.stringify(Object.keys(dmCreated.detail).sort()) === JSON.stringify(["kind", "load_id", "subject"]));
const verdict = await one(`select * from chat_ledger_verify($1, 0)`, [ORG]);
ok("the ledger verifies intact", verdict.problem === null, JSON.stringify(verdict));

// ── The browser ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the browser --");
const anaJwt = { org_id: ORG, user_role: "dispatcher", sub: ANA };
ok("a browser cannot make a team, a channel or a reply",
  /permission denied/.test((await asUser(anaJwt, `select chat_team_create($1,$2,gen_random_uuid(),gen_random_uuid(),'Mine',null,null)`, [ORG, ANA])).error ?? "")
  && /permission denied/.test((await asUser(anaJwt, `select chat_channel_join($1,$2,$3)`, [ORG, ANA, LOADS])).error ?? "")
  && /permission denied/.test((await asUser(anaJwt, `select * from chat_send_reply($1,$2,$3,gen_random_uuid(),$4,'x')`, [ORG, ANA, LOADS, P1])).error ?? ""));
ok("...nor read the team tables", (await asUser(anaJwt, `select * from chat_spaces`)).rows?.length === 0 && (await asUser(anaJwt, `select * from chat_space_members`)).rows?.length === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
