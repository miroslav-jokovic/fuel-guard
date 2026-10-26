// Silvicom 360 — the office chat compliance console's reads (migration 0516, OFFICE-CHAT-PLAN CHA2).
//
// What the database itself must guarantee, whoever calls the functions:
//   · no read without a reason: a missing or malformed reason is a refusal (CH009) and never a row;
//   · every read that returns words appends its own ledger row FIRST, in the same transaction, naming
//     the actor, the reason and what was asked — and the chain stays intact afterwards;
//   · the console sees everything the org wrote: driver threads, retracted words, every earlier
//     version — and nothing of another organisation's;
//   · the Access log returns exactly those rows, newest first, and reading it leaves none;
//   · a browser can call none of it.
//
// Run: node supabase/tests/office-chat-compliance.test.mjs
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

// ── People and conversations ────────────────────────────────────────────────────────────────────
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
const DAN = await person("dan@silvicom.test", ORG, "driver", "Dan Driver");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");
const OUT2 = await person("outsider2@other.test", ORG_B, "dispatcher", "Other Dispatcher");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const send = async (org, actor, thread, body) => one(`select * from chat_send($1,$2,$3,$4,$5)`, [org, actor, thread, await uuid(), body]);

const DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, ANA, BEN, await uuid()])).id;
const M1 = (await send(ORG, ANA, DM, "Truck 654 is at the yard.")).message_id;
await db.query(`select chat_edit($1,$2,$3,'Truck 654 is at the YARD GATE.')`, [ORG, ANA, M1]);
const M2 = (await send(ORG, BEN, DM, "Approved, 100% sure.")).message_id;
await db.query(`select chat_retract($1,$2,$3)`, [ORG, BEN, M2]);
const GROUP = (await one(`select chat_create_group($1,$2,$3,'Night dispatch',$4) id`, [ORG, ANA, await uuid(), [BEN, CLEO]])).id;
await send(ORG, CLEO, GROUP, "Night shift starts at 9.");
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
// A driver thread (0096), written as dispatch writes it.
const DRV = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office'),($1,$2,$4,'driver')`, [DRV, ORG, ANA, DAN]);
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'Load 1 ready for the night')`, [DRV, ORG, DAN]);
// The other organisation's conversation, which must never appear.
const OTHER_DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG_B, OUT, OUT2, await uuid()])).id;
await send(ORG_B, OUT, OTHER_DM, "Night shift at the other carrier");

const REASON = { category: "hr", text: "Grievance HR-14: messages about the night shift" };
const ledgerBefore = Number((await one(`select count(*)::int n from chat_ledger where org_id=$1`, [ORG])).n);

// ── The reason ──────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the reason --");
ok("no reason, no read", (await sqlstate(`select * from chat_compliance_messages($1,$2,null,null,null,null,null,null,null,null,50)`, [ORG, BEN])) === "CH009");
ok("a category outside the list is refused", (await sqlstate(`select * from chat_compliance_messages($1,$2,$3,null,null,null,null,null,null,null,50)`, [ORG, BEN, { category: "curiosity", text: REASON.text }])) === "CH009");
ok("a reason under ten characters is refused", (await sqlstate(`select * from chat_compliance_conversations($1,$2,$3,null,null,null,null,null,50)`, [ORG, BEN, { category: "hr", text: "short" }])) === "CH009");
ok("...and a refusal leaves no ledger row", Number((await one(`select count(*)::int n from chat_ledger where org_id=$1`, [ORG])).n) === ledgerBefore);

// ── Conversations ───────────────────────────────────────────────────────────────────────────────
console.log("\n-- conversations --");
const convs = await all(`select * from chat_compliance_conversations($1,$2,$3,null,null,null,null,null,50)`, [ORG, BEN, REASON]);
ok("every conversation of the org is listed — direct, group and the driver thread", convs.length === 3 && convs.some((c) => c.thread_id === DRV), String(convs.length));
ok("...and none of another organisation's", !convs.some((c) => c.thread_id === OTHER_DM));
const g = convs.find((c) => c.thread_id === GROUP);
ok("a conversation names everyone who was ever in it, with when they left", g.members.length === 3 && g.members.find((m) => m.user_id === CLEO).left_at !== null && g.members.find((m) => m.user_id === ANA).left_at === null);
ok("...and counts its messages", Number(g.message_count) === 1);
const byPerson = await all(`select * from chat_compliance_conversations($1,$2,$3,$4,null,null,null,null,50)`, [ORG, BEN, REASON, CLEO]);
ok("narrowed to a person who LEFT still finds the conversation they were in", byPerson.length === 1 && byPerson[0].thread_id === GROUP);
let rows = await all(`select action, actor_user_id, subject_user_id, detail from chat_ledger where org_id=$1 and action like 'compliance_%' order by seq`, [ORG]);
ok("each listing is a compliance_search row with the actor, the reason and the filters", rows.length === 2
  && rows.every((r) => r.action === "compliance_search" && r.actor_user_id === BEN && r.detail.reason.category === "hr" && r.detail.reason.text === REASON.text)
  && rows[1].subject_user_id === CLEO && rows[1].detail.filters.person === CLEO && rows[0].detail.scope === "conversations", JSON.stringify(rows));

// ── Messages ────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- messages --");
const found = await all(`select * from chat_compliance_messages($1,$2,$3,null,null,null,null,'yard',null,null,50)`, [ORG, BEN, REASON]);
ok("a word is found in the current text", found.length === 1 && found[0].id === M1);
ok("...and the earlier version an edit replaced comes with it", found[0].versions.length === 1 && found[0].versions[0].body === "Truck 654 is at the yard." && found[0].versions[0].replaced_by === ANA);
const old = await all(`select * from chat_compliance_messages($1,$2,$3,null,null,null,null,'is at the yard.',null,null,50)`, [ORG, BEN, REASON]);
ok("a phrase that survives only in an earlier version is still found", old.length === 1 && old[0].id === M1);
const pct = await all(`select * from chat_compliance_messages($1,$2,$3,null,null,null,null,'100%',null,null,50)`, [ORG, BEN, REASON]);
ok("a percent sign is a letter, not a wildcard", pct.length === 1 && pct[0].id === M2, String(pct.length));
ok("...and a retracted message comes back WITH its words and when it was removed", pct[0].body === "Approved, 100% sure." && pct[0].deleted_at !== null);
const night = await all(`select * from chat_compliance_messages($1,$2,$3,null,null,null,null,'night',null,null,50)`, [ORG, BEN, REASON]);
ok("the search reaches the driver thread and names each message's conversation", night.length === 2 && night.some((m) => m.thread_id === DRV && m.thread_kind === "driver") && night.some((m) => m.thread_id === GROUP && m.thread_subject === "Night dispatch"), String(night.length));
ok("...and never the other organisation's, though its words match", !night.some((m) => m.body.includes("other carrier")));
const byDan = await all(`select * from chat_compliance_messages($1,$2,$3,null,$4,null,null,null,null,null,50)`, [ORG, BEN, REASON, DAN]);
ok("narrowed to a sender", byDan.length === 1 && byDan[0].sender_user_id === DAN && byDan[0].sender_name === "Dan Driver");
const inDm = await all(`select * from chat_compliance_messages($1,$2,$3,$4,null,null,null,null,null,null,50)`, [ORG, BEN, REASON, DM]);
ok("narrowed to one conversation", inDm.length === 2 && inDm.every((m) => m.thread_id === DM), String(inDm.length));
ok("a conversation of another organisation named as the filter is refused, not emptied",
  (await sqlstate(`select * from chat_compliance_messages($1,$2,$3,$4,null,null,null,null,null,null,50)`, [ORG, BEN, REASON, OTHER_DM])) === "CH001");
rows = await all(`select detail from chat_ledger where org_id=$1 and action='compliance_search' and detail->>'scope'='messages' order by seq`, [ORG]);
// Six, not seven: the refused search (another org's conversation, CH001) raised before its row.
ok("each search is a compliance_search row carrying its words, and a refused one left none", rows.length === 6 && rows[0].detail.filters.q === "yard" && rows[4].detail.filters.person === DAN && rows[5].detail.filters.thread === DM, JSON.stringify(rows.map((r) => r.detail.filters)));

// ── One conversation ────────────────────────────────────────────────────────────────────────────
console.log("\n-- one conversation --");
const view = await one(`select * from chat_compliance_thread($1,$2,$3,$4,null,50)`, [ORG, BEN, REASON, DM]);
ok("the header names the conversation and its members", view.conversation.thread_id === DM && view.conversation.members.length === 2);
ok("the lines come newest first with words, versions and retractions", view.messages.length === 2 && view.messages[0].id === M2 && view.messages[0].deleted_at !== null && view.messages[1].versions.length === 1);
const page1 = await one(`select * from chat_compliance_thread($1,$2,$3,$4,2,50)`, [ORG, BEN, REASON, DM]);
ok("an older page is the lines before a position", page1.messages.length === 1 && Number(page1.messages[0].seq) === 1);
ok("another organisation's conversation is CH001, even by its real id", (await sqlstate(`select * from chat_compliance_thread($1,$2,$3,$4,null,50)`, [ORG, BEN, REASON, OTHER_DM])) === "CH001");
rows = await all(`select thread_id, detail from chat_ledger where org_id=$1 and action='compliance_view' order by seq`, [ORG]);
ok("each opening, each page, is a compliance_view row naming the conversation and the page", rows.length === 2 && rows.every((r) => r.thread_id === DM) && rows[1].detail.before_seq === 2);

// ── The Access log ──────────────────────────────────────────────────────────────────────────────
console.log("\n-- the access log --");
const log = await all(`select * from chat_compliance_access_log($1,null,50)`, [ORG]);
ok("the access log is every compliance act, newest first, with names", log.length === 10 && log[0].action === "compliance_view" && log[0].actor_name === "Ben Admin" && Number(log[0].seq) > Number(log[1].seq), String(log.length));
ok("...the filtered search names its subject", log.some((r) => r.subject_name === "Cleo Safety"));
ok("...and nothing that is not a compliance act", log.every((r) => r.action.startsWith("compliance_")));
const older = await all(`select * from chat_compliance_access_log($1,$2,50)`, [ORG, log[2].seq]);
ok("it pages by seq", older.length === 7 && older.every((r) => Number(r.seq) < Number(log[2].seq)));
ok("reading the access log leaves no row of its own", Number((await one(`select count(*)::int n from chat_ledger where org_id=$1 and action like 'compliance_%'`, [ORG])).n) === 10);
ok("the other organisation's access log is empty", (await all(`select * from chat_compliance_access_log($1,null,50)`, [ORG_B])).length === 0);

// ── The chain, afterwards ───────────────────────────────────────────────────────────────────────
console.log("\n-- the chain --");
const verdict = await one(`select * from chat_ledger_verify($1, 0)`, [ORG]);
ok("the ledger verifies intact with the compliance rows in it", verdict.problem === null && Number(verdict.checked) === ledgerBefore + 10, JSON.stringify(verdict));

// ── The browser ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the browser --");
const benJwt = { org_id: ORG, user_role: "admin", sub: BEN };
ok("an admin's browser cannot call the console's functions",
  /permission denied/.test((await asUser(benJwt, `select * from chat_compliance_messages($1,$2,$3,null,null,null,null,null,null,null,50)`, [ORG, BEN, REASON])).error ?? "")
  && /permission denied/.test((await asUser(benJwt, `select * from chat_compliance_access_log($1,null,50)`, [ORG])).error ?? ""));
ok("...and cannot check a reason for itself", /permission denied/.test((await asUser(benJwt, `select chat_compliance_reason($1)`, [REASON])).error ?? ""));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
