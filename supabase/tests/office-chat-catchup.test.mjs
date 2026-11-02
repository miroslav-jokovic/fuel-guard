// Silvicom 360 — office chat AI catch-up (migration 0549, OFFICE-CHAT-PLAN CH12; D-CHAT16, D-CHAT37, D-CHAT38).
//
// What the database itself must guarantee, whoever calls the functions:
//   · the lines a catch-up reads are the caller's UNREAD lines of a conversation they are in now — after
//     their read boundary, oldest first, never a retracted one, at most the newest 200 — and reading them
//     marks nothing read; anybody else is refused (CH001);
//   · a person has 20 catch-ups in any 24 hours: `chat_catchup_left` counts down, and the 21st record is
//     refused (CH017) and writes nothing;
//   · a record is a ledger row naming the conversation, the seq range, the line count, the model, the
//     tokens and the summary's hash — and the tokens count in the carrier's month;
//   · a malformed record is refused (CH006); the switch `chat_ai` is a module key the table takes;
//   · the ledger still verifies; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-catchup.test.mjs
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
const send = async (actor, thread, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const lines = (user, thread) => all(`select * from chat_catchup_lines($1,$2,$3)`, [ORG, user, thread]);
const left = async (user) => Number((await one(`select chat_catchup_left($1,$2) n`, [ORG, user])).n);
const SHA = "a".repeat(64);
const record = (user, thread, over = {}) => {
  const a = { from: 1, to: 3, lines: 3, model: "claude-haiku-5-5", input: 1200, output: 150, sha: SHA, ...over };
  return db.query(`select chat_catchup_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) n`, [ORG, user, thread, a.from, a.to, a.lines, a.model, a.input, a.output, a.sha]);
};

const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN]]);
const OTHER = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Elsewhere',$4)`, [ORG, ANA, OTHER, [CLEO]]);

// ── What it reads ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- what a catch-up reads --");
await send(ANA, GROUP, "Truck 506 loaded");
await db.query(`select chat_mark_read($1,$2,$3,$4)`, [ORG, BEN, GROUP, 1]);
await send(ANA, GROUP, "Detention at the shipper");
const GONE = await send(ANA, GROUP, "wrong conversation");
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, GONE]);
await send(ANA, GROUP, "Fuel stop at Effingham");
const ben = await lines(BEN, GROUP);
ok("Ben's catch-up reads his unread lines only, oldest first, the retracted one left out",
  JSON.stringify(ben.map((l) => l.body)) === JSON.stringify(["Detention at the shipper", "Fuel stop at Effingham"]), JSON.stringify(ben.map((l) => [l.seq, l.body])));
ok("...each with its sender's name and seq", ben[0].sender_name === "Ana Petrović" && Number(ben[0].seq) === 2);
const readBefore = (await one(`select read_seq from thread_participants where thread_id=$1 and user_id=$2`, [GROUP, BEN])).read_seq;
await lines(BEN, GROUP);
ok("reading them marks nothing read", Number((await one(`select read_seq from thread_participants where thread_id=$1 and user_id=$2`, [GROUP, BEN])).read_seq) === Number(readBefore));
ok("somebody not in the conversation is refused CH001", (await sqlstate(`select * from chat_catchup_lines($1,$2,$3)`, [ORG, CLEO, GROUP])) === "CH001");
ok("...as is a call under another organisation's id", (await sqlstate(`select * from chat_catchup_lines($1,$2,$3)`, [ORG_B, BEN, GROUP])) === "CH001");
await db.exec("begin");
for (let i = 0; i < 205; i++) await send(ANA, OTHER, `line ${i}`);
await db.exec("commit");
const many = await lines(CLEO, OTHER);
ok("at most 200 lines — the newest 200, still oldest first",
  many.length === 200 && many[0].body === "line 5" && many[199].body === "line 204", `${many.length} ${many[0]?.body} ${many.at(-1)?.body}`);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, OTHER]);
ok("once Cleo has left, she is refused", (await sqlstate(`select * from chat_catchup_lines($1,$2,$3)`, [ORG, CLEO, OTHER])) === "CH001");

// ── Recording, and the cap ────────────────────────────────────────────────────────────────────────
console.log("\n-- recording and the cap --");
ok("a person starts with 20", (await left(BEN)) === 20);
const usageBefore = await one(`select coalesce(sum(input_tokens),0)::int i, coalesce(sum(output_tokens),0)::int o from org_usage_month where org_id=$1`, [ORG]);
const r1 = Number((await record(BEN, GROUP, { from: 2, to: 4, lines: 2 })).rows[0].n);
ok("recording answers what remains: 19", r1 === 19 && (await left(BEN)) === 19);
const row = await one(`select * from chat_ledger where org_id=$1 and action='ai_catchup' order by seq desc limit 1`, [ORG]);
ok("...as one ai_catchup ledger row: who, which conversation, the summary's hash, and what it read",
  row.actor_user_id === BEN && row.thread_id === GROUP && row.body_sha256 === SHA
  && JSON.stringify(row.detail) === JSON.stringify({ lines: 2, model: "claude-haiku-5-5", to_seq: 4, from_seq: 2, input_tokens: 1200, output_tokens: 150 }), JSON.stringify(row));
const usage = await one(`select coalesce(sum(input_tokens),0)::int i, coalesce(sum(output_tokens),0)::int o from org_usage_month where org_id=$1`, [ORG]);
ok("...and its tokens count in the carrier's month", usage.i === usageBefore.i + 1200 && usage.o === usageBefore.o + 150, JSON.stringify(usage));
ok("Ana's count is her own", (await left(ANA)) === 20);
for (let i = 0; i < 19; i++) await record(BEN, GROUP);
ok("after 20 in 24 hours none is left", (await left(BEN)) === 0);
const usage20 = await one(`select coalesce(sum(input_tokens),0)::int i, coalesce(sum(output_tokens),0)::int o, count(*)::int rows from org_usage_month where org_id=$1`, [ORG]);
ok("...and the month holds all twenty, added to one row, not just the first",
  usage20.i === usageBefore.i + 20 * 1200 && usage20.o === usageBefore.o + 20 * 150 && usage20.rows === 1, JSON.stringify(usage20));
const n = Number((await one(`select count(*) n from chat_ledger where org_id=$1 and action='ai_catchup'`, [ORG])).n);
ok("the 21st is refused CH017 and writes nothing", (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,3,'m',1,1,$4)`, [ORG, BEN, GROUP, SHA])) === "CH017"
  && Number((await one(`select count(*) n from chat_ledger where org_id=$1 and action='ai_catchup'`, [ORG])).n) === n);
// The 24-hour window cannot be exercised here: the ledger's chain trigger stamps every row with the time
// it is written (0511), so no row can be made 25 hours old — the property that makes the ledger evidence.
// What can be held is that the count reads that window and that cap, in the function's own words.
const src = (await one(`select prosrc from pg_proc where proname='chat_catchup_left'`)).prosrc;
ok("the count is of ai_catchup rows in the last 24 hours, against 20 — read from the function (the window cannot be aged)",
  /occurred_at > now\(\) - interval '24 hours'/.test(src) && /greatest\(20 - count\(\*\)::integer, 0\)/.test(src) && /action = 'ai_catchup'/.test(src), src);

// ── Refusals; the switch; the ledger; the browser ─────────────────────────────────────────────────
console.log("\n-- refusals, the switch, the ledger, the browser --");
ok("a record without a hash, without lines, with negative tokens or no model is refused CH006",
  (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,3,'m',1,1,'nothex')`, [ORG, ANA, GROUP])) === "CH006"
  && (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,0,'m',1,1,$4)`, [ORG, ANA, GROUP, SHA])) === "CH006"
  && (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,3,'m',-1,1,$4)`, [ORG, ANA, GROUP, SHA])) === "CH006"
  && (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,3,' ',1,1,$4)`, [ORG, ANA, GROUP, SHA])) === "CH006");
ok("recording for a conversation the person is not in is refused CH001", (await sqlstate(`select chat_catchup_record($1,$2,$3,1,3,3,'m',1,1,$4)`, [ORG, CLEO, GROUP, SHA])) === "CH001");
ok("the switch: org_modules takes chat_ai, and it is off until a row says on",
  (await sqlstate(`insert into org_modules (org_id, module_key, enabled) values ($1,'chat_ai',true)`, [ORG_B])) === null
  && (await one(`select org_module_enabled($1,'chat_ai') enabled`, [ORG])).enabled === false
  && (await one(`select org_module_enabled($1,'chat_ai') enabled`, [ORG_B])).enabled === true);
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);
const claims = { sub: BEN, role: "authenticated" };
for (const [fn, sql] of [
  ["chat_catchup_lines", `select * from chat_catchup_lines('${ORG}','${BEN}','${GROUP}')`],
  ["chat_catchup_left", `select chat_catchup_left('${ORG}','${BEN}')`],
  ["chat_catchup_record", `select chat_catchup_record('${ORG}','${BEN}','${GROUP}',1,3,3,'m',1,1,'${SHA}')`],
]) {
  ok(`a browser cannot call ${fn}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
