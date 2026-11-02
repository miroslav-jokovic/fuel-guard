// Silvicom 360 — office chat search (migration 0542, OFFICE-CHAT-PLAN CH8).
//
// What the database itself must guarantee, whoever calls the function:
//   · a line is found by every word of the search, each as a prefix ("load" finds "loaded", "2048" finds
//     "L-20481"), whatever the case; one word missing and it is not;
//   · only lines a person can read: office conversations they are in now — never one they left, never
//     one they were never in, never a driver conversation, never a retracted line, never another
//     organisation's — and the current words, not the words before an edit;
//   · inside one conversation when asked, and refused (CH001) for one the person is not in;
//   · no search text is ever read as tsquery syntax, and a search with no words is an empty answer;
//   · newest first, and paging visits every match exactly once; the index is the one the query uses;
//   · a browser can call none of it.
//
// Run: node supabase/tests/office-chat-search.test.mjs
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
const send = async (actor, thread, body, org = ORG) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [org, actor, thread, mid, body]);
  return mid;
};
const search = (user, q, thread = null, org = ORG, limit = 25) =>
  all(`select * from chat_search($1,$2,$3,$4,null,null,$5)`, [org, user, q, thread, limit]);
const ids = async (user, q, thread) => (await search(user, q, thread)).map((r) => r.id);

const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN, CLEO]]);
const PRIVATE = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Payroll',$4)`, [ORG, BEN, PRIVATE, [DEV]]);
const DISPATCH = await uuid(), GENERAL = await uuid();
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, DISPATCH, GENERAL, [ANA, CLEO, DEV]]);

const LOADED = await send(ANA, GROUP, "Truck 702 is loaded for L-20481");
const DETENTION = await send(BEN, GROUP, "Detention at the shipper, two hours");
const SECRET = await send(BEN, PRIVATE, "Truck 702 payroll advance");
const POST = await send(BEN, GENERAL, "Who has the reefer for Monday?");
const REPLY = await uuid();
await db.query(`select * from chat_send_reply($1,$2,$3,$4,$5,$6)`, [ORG, CLEO, GENERAL, REPLY, POST, "Reefer 5531 is free Monday"]);

// ── Matching ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- matching --");
ok("a word of the line finds it", (await ids(ANA, "detention")).includes(DETENTION));
ok("...whatever the case", (await ids(ANA, "DETENTION")).includes(DETENTION));
ok("a word's beginning finds it: 'load' finds 'loaded'", (await ids(ANA, "load")).includes(LOADED));
ok("a number's beginning inside a load number: '2048' finds 'L-20481'", (await ids(ANA, "2048")).includes(LOADED));
ok("the load number as typed finds it", (await ids(ANA, "L-20481")).includes(LOADED));
ok("...and its digits alone do (the parser would read '-20481' as a negative number)", (await ids(ANA, "20481")).includes(LOADED));
ok("every word must match: 'truck shipper' finds neither line",
  (await search(ANA, "truck shipper")).length === 0);
ok("two words of one line, in any order, find it", (await ids(ANA, "loaded 702")).includes(LOADED));
ok("a word in the middle of nothing finds nothing", (await search(ANA, "banana")).length === 0);

// ── Only what the person can read ─────────────────────────────────────────────────────────────────
console.log("\n-- readable lines only --");
ok("Ana never sees a line of a conversation she is not in (Payroll's 'Truck 702')",
  !(await ids(ANA, "truck 702")).includes(SECRET) && (await ids(ANA, "truck 702")).includes(LOADED));
ok("...which Ben, who is in it, does", (await ids(BEN, "truck 702")).includes(SECRET));
ok("a channel post and its reply are both found, the reply carrying its post",
  (await search(ANA, "reefer")).length === 2
  && (await search(ANA, "reefer")).find((r) => r.id === REPLY)?.parent_id === POST
  && (await search(ANA, "reefer")).find((r) => r.id === REPLY)?.kind === "channel");
const hit = (await search(ANA, "detention"))[0];
ok("a match names its conversation, its sender and its words",
  hit?.thread_id === GROUP && hit?.kind === "group" && hit?.subject === "Night desk" && hit?.sender_user_id === BEN
  && hit?.sender_name === "Ben Admin" && hit?.body === "Detention at the shipper, two hours", JSON.stringify(hit));

const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office')`, [DRIVER_THREAD, ORG, ANA]);
const DRV = await uuid();
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values ($1,$2,$3,$4,'Detention pay for the driver')`, [DRV, DRIVER_THREAD, ORG, ANA]);
ok("a driver conversation's line is never found, even by one of its participants",
  (await one(`select kind from message_threads where id=$1`, [DRIVER_THREAD])).kind === "driver"
  && !(await ids(ANA, "detention")).includes(DRV));

const OTHER_GROUP = await uuid();
const OUT2 = await person("out2@other.test", ORG_B, "dispatcher", "Other Two");
await db.query(`select chat_create_group($1,$2,$3,'Elsewhere',$4)`, [ORG_B, OUT, OTHER_GROUP, [OUT2]]);
const ELSEWHERE = await send(OUT, OTHER_GROUP, "Detention at the shipper too", ORG_B);
ok("another organisation's line is not found by this one's people", !(await ids(BEN, "detention")).includes(ELSEWHERE));
ok("...nor this one's by theirs", (await search(OUT, "detention", null, ORG_B)).map((r) => r.id).join() === ELSEWHERE);
ok("asking under another organisation's id finds nothing of Ana's", (await search(ANA, "detention", null, ORG_B)).length === 0);

await db.query(`select chat_edit($1,$2,$3,$4)`, [ORG, BEN, DETENTION, "Waiting at the receiver, two hours"]);
ok("after an edit the new words find the line", (await ids(ANA, "receiver")).includes(DETENTION));
ok("...and the old ones no longer do", !(await ids(ANA, "detention shipper")).includes(DETENTION));
await db.query(`select chat_retract($1,$2,$3)`, [ORG, BEN, DETENTION]);
ok("a retracted line is never found", !(await ids(ANA, "receiver")).includes(DETENTION));

// ── In one conversation ───────────────────────────────────────────────────────────────────────────
console.log("\n-- one conversation --");
const inGroup = await search(BEN, "702", GROUP);
ok("searching one conversation finds only its lines", inGroup.length === 1 && inGroup[0].id === LOADED, JSON.stringify(inGroup.map((r) => r.id)));
ok("...across all of Ben's, 'Truck 702' is in two", (await search(BEN, "702")).length === 2);
ok("searching a conversation Ana is not in is refused CH001",
  (await sqlstate(`select * from chat_search($1,$2,'702',$3,null,null,25)`, [ORG, ANA, PRIVATE])) === "CH001");
ok("...even with a search of no words", (await sqlstate(`select * from chat_search($1,$2,'',$3,null,null,25)`, [ORG, ANA, PRIVATE])) === "CH001");

// ── Input is words, never syntax ──────────────────────────────────────────────────────────────────
console.log("\n-- input --");
for (const q of ["", "   ", "&|!", "'", "\\", ":*", "a & !b | c", "702 & | !", "o'brien", "\\'"]) {
  const code = await sqlstate(`select * from chat_search($1,$2,$3,null,null,null,25)`, [ORG, ANA, q]);
  ok(`the search ${JSON.stringify(q)} is answered, not refused`, code === null, String(code));
}
ok("a search of no words is an empty answer", (await search(ANA, "  ")).length === 0 && (await search(ANA, "&|!")).length === 0);
ok("operators typed in a search are ignored, its words still found", (await ids(ANA, "702 & | !")).includes(LOADED));
const OBRIEN = await send(ANA, GROUP, "Call O'Brien at the yard");
ok("a word with an apostrophe finds its line", (await ids(ANA, "o'brien")).includes(OBRIEN));
ok("a search is read to its 200th character: a word past it does not narrow the match",
  (await ids(ANA, `loaded${" ".repeat(200)}banana`)).includes(LOADED)
  && !(await ids(ANA, "loaded banana")).includes(LOADED));

// ── Order and paging ──────────────────────────────────────────────────────────────────────────────
console.log("\n-- order and paging --");
const many = [];
for (let i = 0; i < 2; i++) many.push(await send(ANA, GROUP, `Fuel stop ${i}`));
await db.exec("begin"); // three lines in one transaction share now(): a tie the keyset must break
for (let i = 2; i < 5; i++) many.push(await send(ANA, GROUP, `Fuel stop ${i}`));
await db.exec("commit");
for (let i = 5; i < 7; i++) many.push(await send(ANA, GROUP, `Fuel stop ${i}`));
ok("the setup holds a tie: the three sent in one transaction share one created_at",
  Number((await one(`select count(distinct created_at) n from messages where id = any($1)`, [many.slice(2, 5)])).n) === 1);
const full = await search(ANA, "fuel stop", null, ORG, 50);
const key = (r) => [new Date(r.created_at).getTime(), r.id];
const sorted = [...full].sort((a, b) => (key(b)[0] - key(a)[0]) || (key(b)[1] < key(a)[1] ? -1 : key(b)[1] > key(a)[1] ? 1 : 0));
ok("newest first, ties broken by id descending", full.length === 7 && JSON.stringify(full.map((r) => r.id)) === JSON.stringify(sorted.map((r) => r.id)));
const walked = [];
let before = [null, null];
for (let guard = 0; guard < 20; guard++) {
  const page = await all(`select * from chat_search($1,$2,'fuel stop',null,$3,$4,2)`, [ORG, ANA, before[0], before[1]]);
  if (!page.length) break;
  walked.push(...page.map((r) => r.id));
  before = [page.at(-1).created_at, page.at(-1).id];
}
ok("paging two at a time visits all seven exactly once, in the list's order (three share an instant)",
  JSON.stringify(walked) === JSON.stringify(full.map((r) => r.id)), `${walked.length}`);
const bulk = [];
await db.exec("begin");
for (let i = 0; i < 52; i++) bulk.push(await send(BEN, GENERAL, `Yard check ${i}`));
await db.exec("commit");
ok("a page is at most 50, however many are asked for",
  (await all(`select * from chat_search($1,$2,'yard check',null,null,null,1000)`, [ORG, ANA])).length === 50);
ok("a page of 0 asked is a page of one", (await all(`select * from chat_search($1,$2,'fuel',null,null,null,0)`, [ORG, ANA])).length === 1);

// ── Leaving; the index; the browser ───────────────────────────────────────────────────────────────
console.log("\n-- leaving, the index, the browser --");
ok("before Cleo leaves the group, she finds its lines", (await ids(CLEO, "702")).includes(LOADED));
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
ok("once she has left, she finds none of them", !(await ids(CLEO, "702")).includes(LOADED));

await db.exec("set enable_seqscan = off");
const plan = (await all(`explain select id from messages where chat_search_vector(body) @@ chat_search_query('truck')`)).map((r) => r["QUERY PLAN"]).join("\n");
await db.exec("reset enable_seqscan");
ok("the function's match expression is the index's: the planner can use idx_messages_search", plan.includes("idx_messages_search"), plan);

const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_search", `select * from chat_search('${ORG}','${BEN}','truck',null,null,null,25)`],
  ["chat_search_query", `select chat_search_query('truck')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
