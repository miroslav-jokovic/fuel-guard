// Silvicom 360 — office chat (migrations 0511 + 0512, OFFICE-CHAT-PLAN.md CH1a).
//
// What the database itself must guarantee, whoever writes to it:
//   · who may be in an office conversation (D-CHAT4), one direct conversation per pair, idempotent
//     creates and sends on client ids;
//   · per-conversation sequence and revision numbers, unread as last_seq − read_seq (D-CHAT5);
//   · an edit keeps the words it replaced, a retraction keeps the row, a message never moves (D-CHAT13);
//   · a person who left reads nothing, and the browser writes nothing (D-CHAT3);
//   · the ledger is complete, gapless per org, append-only for every caller, and `chat_ledger_verify()`
//     names the row a person with raw database access altered (D-CHAT12).
//
// PGlite is one connection, so two truly concurrent appends cannot be staged here. What stops a fork is
// `pg_advisory_xact_lock` per org in the chain trigger plus `unique (org_id, seq)`; this matrix checks
// that a writer cannot choose its own seq or hash, which is the half a single connection can show.
//
// Run: node supabase/tests/office-chat.test.mjs
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

// ── People ──────────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;
const person = async (email, org, role, name, suspended = false) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role, suspended_at) values ($1,$2,$3,$4)`,
    [org, id, role, suspended ? new Date().toISOString() : null]);
  if (name) await db.query(`insert into user_profiles (user_id, full_name) values ($1,$2)`, [id, name]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher", "Ana Petrović");
const BEN = await person("ben@silvicom.test", ORG, "admin", "Ben Admin");
const CLEO = await person("cleo@silvicom.test", ORG, "safety_manager", "Cleo Safety");
const DAN = await person("dan@silvicom.test", ORG, "driver", "Dan Driver");
const SUS = await person("sus@silvicom.test", ORG, "dispatcher", null, true);
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");
const OUT2 = await person("outsider2@other.test", ORG_B, "dispatcher", "Other Dispatcher");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const send = async (actor, thread, body, id) =>
  one(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, id ?? (await uuid()), body]);

// ── Who may be in a conversation (D-CHAT4) ──────────────────────────────────────────────────────
console.log("\n-- who may be in a conversation --");
const DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, ANA, BEN, await uuid()])).id;
ok("opening a direct conversation twice returns the same one",
  (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, ANA, BEN, await uuid()])).id === DM);
ok("...from either side",
  (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, BEN, ANA, await uuid()])).id === DM);
ok("a driver login is not an office chat member",
  (await sqlstate(`select chat_open_direct($1,$2,$3,gen_random_uuid())`, [ORG, ANA, DAN])) === "CH002");
ok("a suspended member cannot be added",
  (await sqlstate(`select chat_open_direct($1,$2,$3,gen_random_uuid())`, [ORG, ANA, SUS])) === "CH002");
ok("a person from another organisation cannot be added",
  (await sqlstate(`select chat_open_direct($1,$2,$3,gen_random_uuid())`, [ORG, ANA, OUT])) === "CH002");
ok("nobody opens a direct conversation with themselves",
  (await sqlstate(`select chat_open_direct($1,$2,$3,gen_random_uuid())`, [ORG, ANA, ANA])) === "CH002");

const GROUP_ID = await uuid();
const GROUP = (await one(`select chat_create_group($1,$2,$3,'Night dispatch',$4) id`, [ORG, ANA, GROUP_ID, [BEN, CLEO]])).id;
ok("a group is created with its creator as owner",
  (await one(`select member_role from thread_participants where thread_id=$1 and user_id=$2`, [GROUP, ANA])).member_role === "owner");
ok("creating the same group again (a retried request) returns it",
  (await one(`select chat_create_group($1,$2,$3,'Night dispatch',$4) id`, [ORG, ANA, GROUP_ID, [BEN, CLEO]])).id === GROUP);
ok("a client id that names another conversation is refused",
  (await sqlstate(`select chat_create_group($1,$2,$3,'x',$4)`, [ORG, ANA, DM, [BEN]])) === "CH007");
ok("a group with nobody else in it is refused",
  (await sqlstate(`select chat_create_group($1,$2,gen_random_uuid(),'x',$3)`, [ORG, ANA, []])) === "CH002");
ok("a group naming a driver is refused whole",
  (await sqlstate(`select chat_create_group($1,$2,gen_random_uuid(),'x',$3)`, [ORG, ANA, [BEN, DAN]])) === "CH002");

// ── Sequence, idempotency, unread (D-CHAT5) ─────────────────────────────────────────────────────
console.log("\n-- sequence and unread --");
const M1 = await uuid();
const s1 = await send(ANA, DM, "Truck 654 is at the yard.", M1);
const s2 = await send(ANA, DM, "Driver wants a 30 minute break.");
ok("messages are numbered 1, 2 in their conversation", Number(s1.seq) === 1 && Number(s2.seq) === 2,
  JSON.stringify([String(s1.seq), String(s2.seq)]));
const again = await send(ANA, DM, "Truck 654 is at the yard.", M1);
ok("a retried send returns the first one's position and says so", again.duplicate === true && Number(again.seq) === 1);
ok("...and takes no new number",
  Number((await one(`select last_seq from message_threads where id=$1`, [DM])).last_seq) === 2);
ok("a message id reused in another conversation is refused",
  (await sqlstate(`select chat_send($1,$2,$3,$4,'x')`, [ORG, ANA, GROUP, M1])) === "CH007");
ok("a person not in the conversation cannot send into it",
  (await sqlstate(`select chat_send($1,$2,$3,gen_random_uuid(),'hi')`, [ORG, CLEO, DM])) === "CH001");
ok("...even writing the row directly (the sequence trigger checks the sender)",
  (await sqlstate(`insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'hi')`,
    [DM, ORG, CLEO])) === "CH001");

const inbox = async (user, kinds = ["direct", "group", "channel"], before = [null, null], limit = 50) =>
  all(`select * from chat_inbox($1,$2,$3,$4,$5,$6)`, [ORG, user, kinds, before[0], before[1], limit]);
const row = (rows, id) => rows.find((r) => r.thread_id === id);
ok("the reader sees 2 unread", Number(row(await inbox(BEN), DM).unread) === 2);
ok("the author sees none of their own words as unread", Number(row(await inbox(ANA), DM).unread) === 0);
await send(BEN, DM, "Approved.");
ok("replying marks the conversation read for the one replying", Number(row(await inbox(BEN), DM).unread) === 0);
ok("...and the other side now has 1", Number(row(await inbox(ANA), DM).unread) === 1);
ok("the inbox row carries the last line and who wrote it",
  row(await inbox(ANA), DM).last_message.body === "Approved." && row(await inbox(ANA), DM).last_message.sender_name === "Ben Admin");
ok("a direct row's title names the other person", row(await inbox(ANA), DM).title_members[0].name === "Ben Admin");
await one(`select chat_mark_read($1,$2,$3,$4) s`, [ORG, ANA, DM, 99]);
ok("reading never moves past the end", Number((await one(`select read_seq from thread_participants where thread_id=$1 and user_id=$2`, [DM, ANA])).read_seq) === 3);
await one(`select chat_mark_read($1,$2,$3,$4) s`, [ORG, ANA, DM, 1]);
ok("...and never backwards", Number((await one(`select read_seq from thread_participants where thread_id=$1 and user_id=$2`, [DM, ANA])).read_seq) === 3);

await send(CLEO, GROUP, "Inspection at 8.");
const page1 = await inbox(ANA, ["direct", "group", "channel"], [null, null], 1);
const page2 = await inbox(ANA, ["direct", "group", "channel"], [page1[0].last_message_at, page1[0].thread_id], 1);
ok("the inbox pages newest first without repeating a row",
  page1.length === 1 && page2.length === 1 && page1[0].thread_id === GROUP && page2[0].thread_id === DM);
ok("a person in another organisation sees none of it",
  (await all(`select * from chat_inbox($1,$2,$3,null,null,50)`, [ORG_B, OUT, ["direct", "group"]])).length === 0);

const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office'),($1,$2,$4,'driver')`,
  [DRIVER_THREAD, ORG, ANA, DAN]);
ok("0096's driver threads stay out of the office inbox", !row(await inbox(ANA), DRIVER_THREAD));
ok("...and are still `driver` by default", (await one(`select kind from message_threads where id=$1`, [DRIVER_THREAD])).kind === "driver");

const people = await all(`select * from chat_people($1)`, [ORG]);
ok("the people list is the office members who are not suspended, by name",
  people.map((p) => p.name).join() === "Ana Petrović,Ben Admin,Cleo Safety", people.map((p) => p.name).join());
ok("the inbox narrows to one conversation for its header",
  (await all(`select * from chat_inbox($1,$2,$3,null,null,50,$4)`, [ORG, ANA, ["direct", "group"], DM])).map((r) => r.thread_id).join() === DM);

// ── History, edit, retract (D-CHAT13) ───────────────────────────────────────────────────────────
console.log("\n-- history, versions, retraction --");
const hist = await all(`select * from chat_history($1,$2,$3,null,2)`, [ORG, ANA, DM]);
const older = await all(`select * from chat_history($1,$2,$3,$4,2)`, [ORG, ANA, DM, hist[1].seq]);
ok("history pages backwards by seq", hist.map((m) => Number(m.seq)).join() === "3,2" && older.map((m) => Number(m.seq)).join() === "1");
ok("history is refused to a non-member",
  (await sqlstate(`select * from chat_history($1,$2,$3,null,50)`, [ORG, CLEO, DM])) === "CH001");

const revBefore = Number((await one(`select rev from messages where id=$1`, [M1])).rev);
await one(`select chat_edit($1,$2,$3,'Truck 654 is at the YARD GATE.') r`, [ORG, ANA, M1]);
const v = await all(`select * from message_versions where message_id=$1`, [M1]);
ok("an edit keeps the words it replaced", v.length === 1 && v[0].body === "Truck 654 is at the yard." && v[0].replaced_by === ANA);
ok("...and stamps edited_at", (await one(`select edited_at from messages where id=$1`, [M1])).edited_at !== null);
ok("only the author may edit",
  (await sqlstate(`select chat_edit($1,$2,$3,'mine now')`, [ORG, BEN, M1])) === "CH006");
const synced = await all(`select * from chat_sync($1,$2,$3,$4,50)`, [ORG, BEN, DM, revBefore]);
ok("sync since the last revision returns the edit", synced.some((m) => m.id === M1 && m.body === "Truck 654 is at the YARD GATE."));
ok("the edit took a new revision, not a new position",
  Number((await one(`select rev from messages where id=$1`, [M1])).rev) > revBefore && Number((await one(`select seq from messages where id=$1`, [M1])).seq) === 1);

await one(`select chat_retract($1,$2,$3) r`, [ORG, ANA, M1]);
ok("a retracted message keeps its place with no body",
  (await all(`select * from chat_history($1,$2,$3,null,50)`, [ORG, BEN, DM])).find((m) => m.id === M1).body === null);
ok("...while the row keeps its words", (await one(`select body from messages where id=$1`, [M1])).body === "Truck 654 is at the YARD GATE.");
ok("a retracted message cannot be edited",
  (await sqlstate(`select chat_edit($1,$2,$3,'undo')`, [ORG, ANA, M1])) === "CH004");
ok("...or restored, even by the service role",
  (await sqlstate(`update messages set deleted_at = null where id=$1`, [M1])) === "CH004");
ok("a message cannot move conversation",
  (await sqlstate(`update messages set thread_id=$2 where id=$1`, [M1, GROUP])) === "CH003");
ok("...or change author", (await sqlstate(`update messages set sender_user_id=$2 where id=$1`, [M1, BEN])) === "CH003");
ok("...or change its position", (await sqlstate(`update messages set seq=99 where id=$1`, [M1])) === "CH003");
ok("the author's account being deleted may clear the author (the FK's set null)",
  (await sqlstate(`update messages set sender_user_id=null where id=$1`, [s2.message_id])) === null);
ok("a message is never hard-deleted (0096's MG001 still holds)",
  (await sqlstate(`delete from messages where id=$1`, [M1])) === "MG001");

// ── Leaving, removing, owners ───────────────────────────────────────────────────────────────────
console.log("\n-- leaving and removing --");
ok("a direct conversation cannot be left",
  (await sqlstate(`select chat_leave($1,$2,$3,null)`, [ORG, ANA, DM])) === "CH006");
ok("a direct conversation has no name to change",
  (await sqlstate(`select chat_rename($1,$2,$3,'x')`, [ORG, ANA, DM])) === "CH006");
ok("a member who is not an owner cannot remove somebody",
  (await sqlstate(`select chat_leave($1,$2,$3,$4)`, [ORG, BEN, GROUP, CLEO])) === "CH008");
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
ok("a person who left reads no history", (await sqlstate(`select * from chat_history($1,$2,$3,null,50)`, [ORG, CLEO, GROUP])) === "CH001");
ok("...and nothing through RLS either",
  (await asUser({ org_id: ORG, user_role: "safety_manager", sub: CLEO }, "select count(*)::int n from messages")).rows?.[0]?.n === 0);
ok("...and cannot send", (await sqlstate(`select chat_send($1,$2,$3,gen_random_uuid(),'back')`, [ORG, CLEO, GROUP])) === "CH001");
await one(`select chat_add_members($1,$2,$3,$4) n`, [ORG, BEN, GROUP, [CLEO]]);
ok("being added again brings a person back", row(await inbox(CLEO), GROUP) !== undefined);
await db.query(`select chat_leave($1,$2,$3,$4)`, [ORG, ANA, GROUP, BEN]);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, ANA, GROUP]);
ok("when the last owner leaves, the longest-standing member becomes owner",
  (await one(`select member_role from thread_participants where thread_id=$1 and user_id=$2`, [GROUP, CLEO])).member_role === "owner");

// ── The browser writes nothing (D-CHAT3) ────────────────────────────────────────────────────────
console.log("\n-- the browser --");
const anaJwt = { org_id: ORG, user_role: "dispatcher", sub: ANA };
ok("a participant's browser cannot insert a message (0096's messages_send is gone)",
  !!(await asUser(anaJwt, `insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'x')`, [DM, ORG, ANA])).error);
ok("...cannot edit its own message",
  ((await asUser(anaJwt, `update messages set body='x' where sender_user_id=$1 returning id`, [ANA])).rows?.length ?? 0) === 0);
ok("...cannot move its own read boundary (the API does)",
  ((await asUser(anaJwt, `update thread_participants set read_seq=0 where user_id=$1 returning user_id`, [ANA])).rows?.length ?? 0) === 0);
ok("...cannot call the chat functions",
  /permission denied/.test((await asUser(anaJwt, `select * from chat_send($1,$2,$3,gen_random_uuid(),'x')`, [ORG, ANA, DM])).error ?? ""));
ok("...still READS its conversations (the driver app's realtime is authorised by it)",
  (await asUser(anaJwt, `select count(*)::int n from messages where thread_id=$1`, [DM])).rows?.[0]?.n === 3);
ok("...and reads none of the ledger",
  (await asUser(anaJwt, "select count(*)::int n from chat_ledger")).rows?.[0]?.n === 0);
ok("...or of the versions",
  (await asUser(anaJwt, "select count(*)::int n from message_versions")).rows?.[0]?.n === 0);

// ── The ledger (D-CHAT12) ───────────────────────────────────────────────────────────────────────
console.log("\n-- the ledger --");
const dmActions = (await all(`select action from chat_ledger where thread_id=$1 order by seq`, [DM])).map((r) => r.action);
ok("a direct conversation's life is in the ledger, in order",
  dmActions.join() === "conversation_created,member_added,member_added,message_sent,message_sent,message_sent,message_edited,message_retracted",
  dmActions.join());
ok("a sent message carries the hash of its words",
  (await one(`select body_sha256 = encode(sha256(convert_to('Approved.','UTF8')),'hex') ok from chat_ledger where action='message_sent' and thread_id=$1 order by seq desc limit 1`, [DM])).ok === true);
ok("an edit records the hash of the words it replaced",
  (await one(`select detail->>'previous_sha256' = encode(sha256(convert_to('Truck 654 is at the yard.','UTF8')),'hex') ok from chat_ledger where action='message_edited' and message_id=$1`, [M1])).ok === true);
const removed = await one(`select actor_user_id, subject_user_id from chat_ledger where action='member_removed' and thread_id=$1`, [GROUP]);
ok("a removal names who removed whom", removed?.actor_user_id === ANA && removed?.subject_user_id === BEN);
ok("walking out yourself is a leave, by yourself",
  (await all(`select 1 from chat_ledger where action='member_left' and thread_id=$1 and actor_user_id=$2 and subject_user_id=$2`, [GROUP, CLEO])).length === 1);
ok("coming back is recorded", (await all(`select 1 from chat_ledger where action='member_rejoined' and subject_user_id=$1`, [CLEO])).length === 1);
const seqs = (await all(`select seq from chat_ledger where org_id=$1 order by seq`, [ORG])).map((r) => Number(r.seq));
ok("the org's ledger numbers run 1..n with no gap", seqs.every((s, i) => s === i + 1), seqs.join());
await db.query(`select chat_open_direct($1,$2,$3,gen_random_uuid())`, [ORG_B, OUT, OUT2]);
ok("another organisation's chain starts at its own 1",
  Number((await one(`select min(seq) s from chat_ledger where org_id=$1`, [ORG_B])).s) === 1);
await db.query(`insert into chat_ledger (org_id, action, seq, prev_hash, hash) values ($1,'compliance_search',999,repeat('f',64),repeat('f',64))`, [ORG]);
const forged = await one(`select seq, hash from chat_ledger where org_id=$1 order by seq desc limit 1`, [ORG]);
ok("a writer cannot choose its own number or hash", Number(forged.seq) === seqs.length + 1 && forged.hash !== "f".repeat(64));
const verify = async (org = ORG) => one(`select * from chat_ledger_verify($1)`, [org]);
const clean = await verify();
ok("the verifier finds the chain intact", clean.problem === null && Number(clean.checked) === seqs.length + 1, JSON.stringify(clean));

ok("the ledger refuses UPDATE, even to the database owner",
  (await sqlstate(`update chat_ledger set detail='{}' where org_id=$1`, [ORG])) === "CL001");
ok("...and DELETE", (await sqlstate(`delete from chat_ledger where org_id=$1`, [ORG])) === "CL001");
ok("...and TRUNCATE", (await sqlstate(`truncate chat_ledger`)) === "CL001");
ok("the replaced words refuse UPDATE too", (await sqlstate(`update message_versions set body='x'`)) === "CL001");
ok("...and DELETE", (await sqlstate(`delete from message_versions`)) === "CL001");

// Somebody with raw database access switches the protections off and rewrites history. The ledger
// cannot stop that; the verifier must name it. Each case runs in a transaction that is rolled back.
const tampered = async (sql) => {
  await db.exec("begin");
  try {
    await db.exec("alter table chat_ledger disable trigger user; alter table messages disable trigger user;");
    await db.query(sql, [ORG]);
    return await verify();
  } finally {
    await db.exec("rollback");
  }
};
ok("an altered ledger row is named",
  (await tampered(`update chat_ledger set actor_user_id = null where org_id=$1 and seq = 4`)).problem === "ledger row altered");
const gap = await tampered(`delete from chat_ledger where org_id=$1 and seq = 5`);
ok("a deleted ledger row is named", gap.problem === "ledger row missing" && Number(gap.first_bad_seq) === 5);
const rewritten = await tampered(`update messages set body = 'Not approved.' where org_id=$1 and body = 'Approved.'`);
ok("a message rewritten behind the triggers is named", rewritten.problem === "message text differs from the ledger" && rewritten.message_id !== null);
const slipped = await tampered(`insert into messages (id, thread_id, org_id, sender_user_id, body, seq, rev)
  select gen_random_uuid(), id, org_id, null, 'planted', 99, 99 from message_threads where org_id=$1 and kind='direct' limit 1`);
ok("a message planted with no ledger entry is named", slipped.problem === "message has no ledger entry");
ok("after the rollbacks the chain verifies again", (await verify()).problem === null);

// ── The office write budget (D-CHAT8) ───────────────────────────────────────────────────────────
ok("the per-person write counter takes the office chat bucket",
  (await one(`select allowed from bump_driver_write_counter($1,$2,'chat_message',3000)`, [ORG, ANA])).allowed === true);
ok("...and still refuses a bucket nobody defined",
  (await sqlstate(`select bump_driver_write_counter($1,$2,'gossip',10)`, [ORG, ANA])) === "23514");

// ── Archived ────────────────────────────────────────────────────────────────────────────────────
await db.query(`update message_threads set archived_at = now() where id=$1`, [DM]);
ok("an archived conversation takes no new messages",
  (await sqlstate(`select chat_send($1,$2,$3,gen_random_uuid(),'x')`, [ORG, ANA, DM])) === "CH005");
ok("archiving is recorded", (await all(`select 1 from chat_ledger where action='conversation_archived' and thread_id=$1`, [DM])).length === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
