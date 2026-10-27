// Silvicom 360 — office chat's instant-delivery signals (migration 0513, OFFICE-CHAT-PLAN CH3a, D-CHAT2).
//
// Supabase's `realtime` schema does not exist on bare PGlite, so 0513 would install nothing here. This
// matrix installs a SHIM of the three pieces 0513 touches, before the migrations run:
//   · realtime.send(payload, event, topic, private) — records each call in realtime.sent, and fails on
//     demand (silvicom.test_send_fails), the way Supabase documents it failing when a day's partition
//     is missing;
//   · realtime.topic() — the topic a joining client asked for, from the `realtime.topic` GUC, which is
//     what Realtime sets before it runs the join check;
//   · realtime.messages — RLS on, one broadcast row, so "may this user join" is "does the SELECT see it",
//     the query Realtime itself runs and rolls back at join time (Realtime Authorization docs).
//
// What must hold: a signal per change carrying NO message text; a member's own topic signalled only in
// conversations of ≤ 50; driver threads never signalled; a failed send never losing the message; and a
// topic joinable only by its member — never by somebody who left, another organisation, or anonymously.
// Since 0515: a failed send is recorded in `platform_realtime_health`, the probe announces on its own
// topic that no signed-in person may join, and neither the probe nor the record is reachable from a browser.
//
// Run: node supabase/tests/office-chat-realtime.test.mjs
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

  -- ── the realtime shim ──────────────────────────────────────────────────────────────────────────
  create schema realtime;
  grant usage on schema realtime to anon, authenticated;
  create table realtime.messages (
    id uuid primary key default gen_random_uuid(), topic text, extension text, payload jsonb,
    event text, private boolean default true, inserted_at timestamptz default now());
  alter table realtime.messages enable row level security;
  grant select on realtime.messages to anon, authenticated;
  insert into realtime.messages (topic, extension, payload, event) values ('probe', 'broadcast', '{}', 'probe');
  create table realtime.sent (n bigserial primary key, payload jsonb, event text, topic text, private boolean);
  create function realtime.topic() returns text language sql stable
    as $fn$ select nullif(current_setting('realtime.topic', true), '') $fn$;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
  returns void language plpgsql as $fn$
  begin
    if coalesce(current_setting('silvicom.test_send_fails', true), '') = 'on' then
      raise exception 'relation "realtime.messages_2026_10_23" does not exist';
    end if;
    insert into realtime.sent (payload, event, topic, private) values (payload, event, topic, private);
  end $fn$;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── People and conversations ────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const person = async (org, role) => {
  const id = (await one(`insert into auth.users (email) values (gen_random_uuid()::text || '@x.test') returning id`)).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, id, role]);
  return id;
};
const ANA = await person(ORG, "dispatcher");
const BEN = await person(ORG, "admin");
const CLEO = await person(ORG, "safety_manager");
const DAN = await person(ORG, "driver");
const OUT = await person(ORG_B, "admin");

const DM = (await one(`select chat_open_direct($1,$2,$3,gen_random_uuid()) id`, [ORG, ANA, BEN])).id;
const sent = async () => all(`select * from realtime.sent order by n`);
const reset = () => db.query(`delete from realtime.sent`);

console.log("\n-- signals --");
await reset();
const M1 = (await one(`select * from chat_send($1,$2,$3,gen_random_uuid(),'Truck 654 is at the gate.')`, [ORG, ANA, DM]));
let s = await sent();
ok("a new message announces itself to the conversation's topic", s.some((r) => r.topic === `chat:conv:${DM}`));
ok("...and to each member's own topic", [ANA, BEN].every((u) => s.some((r) => r.topic === `chat:user:${u}`)));
ok("...three signals, nothing more", s.length === 3, String(s.length));
ok("every signal is private", s.every((r) => r.private === true));
ok("the signal carries position, not words",
  s.every((r) => JSON.stringify(r.payload) === JSON.stringify({ op: "message", rev: Number(M1.rev), seq: Number(M1.seq), kind: "direct", thread_id: DM })),
  JSON.stringify(s[0]?.payload));
ok("...no body, no sender, anywhere in it", s.every((r) => !JSON.stringify(r.payload).includes("Truck") && !JSON.stringify(r.payload).includes(ANA)));

await reset();
await db.query(`select chat_edit($1,$2,$3,'Truck 654 is at the YARD gate.')`, [ORG, ANA, M1.message_id]);
s = await sent();
ok("an edit announces a change at its new revision", s.length === 3 && s.every((r) => r.payload.op === "change" && r.payload.rev > Number(M1.rev)));
// 0523: a reaction or a pin moves only the line's `rev`, and is announced like an edit.
await reset();
const reacted = Number((await one(`select chat_react($1,$2,$3,'thumbs_up',true) rev`, [ORG, BEN, M1.message_id])).rev);
s = await sent();
ok("a reaction announces a change at the line's new revision", s.length === 3 && s.every((r) => r.payload.op === "change" && r.payload.rev === reacted));
await reset();
await db.query(`select chat_pin($1,$2,$3,true)`, [ORG, BEN, M1.message_id]);
ok("...as does a pin", (await sent()).length === 3);
await reset();
await db.query(`select chat_save($1,$2,$3,true)`, [ORG, BEN, M1.message_id]);
ok("saving announces nothing (nobody else sees it)", (await sent()).length === 0);
await reset();
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, M1.message_id]);
ok("a retraction announces a change", (await sent()).length === 3);
await reset();
await db.query(`select chat_mark_read($1,$2,$3,null)`, [ORG, BEN, DM]);
ok("reading announces nothing (no message changed)", (await sent()).length === 0);

console.log("\n-- large and driver conversations --");
const many = [];
for (let i = 0; i < 51; i++) many.push(await person(ORG, "dispatcher"));
const BIG = (await one(`select chat_create_group($1,$2,gen_random_uuid(),'Everyone',$3) id`, [ORG, ANA, many])).id;
await reset();
await db.query(`select chat_send($1,$2,$3,gen_random_uuid(),'All hands at 9')`, [ORG, ANA, BIG]);
s = await sent();
ok("a conversation of more than 50 is announced once, to its topic only — the poll carries the badges",
  s.length === 1 && s[0].topic === `chat:conv:${BIG}`, String(s.length));
const DRV = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office'),($1,$2,$4,'driver')`, [DRV, ORG, ANA, DAN]);
await reset();
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values (gen_random_uuid(),$1,$2,$3,'Load 1 ready')`, [DRV, ORG, ANA]);
ok("a driver conversation (0096) is never announced here — the driver app has its own channel", (await sent()).length === 0);

console.log("\n-- a failed announcement --");
await reset();
await db.exec(`set silvicom.test_send_fails = 'on'`);
const kept = await one(`select * from chat_send($1,$2,$3,gen_random_uuid(),'Still delivered')`, [ORG, BEN, DM]).catch((e) => ({ error: e.message }));
await db.exec(`reset silvicom.test_send_fails`);
ok("a failed signal does not fail the send", !kept.error && kept.message_id, JSON.stringify(kept));
ok("...the message is stored, for the poll to deliver", (await one(`select count(*)::int n from messages where id=$1`, [kept.message_id])).n === 1);
ok("...and it is in the ledger", (await one(`select count(*)::int n from chat_ledger where message_id=$1 and action='message_sent'`, [kept.message_id])).n === 1);
// 0515 (CHA4): a swallowed failure is still a FACT, and the health record holds it.
const failed = await all(`select kind, ok, latency_ms, detail from platform_realtime_health where kind='chat_send_failed' order by id`);
ok("...and the failure is recorded in the health record, once, as not ok", failed.length === 1 && failed[0].ok === false && failed[0].latency_ms === null, JSON.stringify(failed));
ok("...with Postgres's own sentence and never the message", failed[0]?.detail?.includes("does not exist") && !failed[0]?.detail?.includes("Still delivered"));
await db.query(`delete from platform_realtime_health`);
await reset();
await db.query(`select chat_send($1,$2,$3,gen_random_uuid(),'Signals are back')`, [ORG, BEN, DM]);
ok("a send that announces fine records no failure", (await one(`select count(*)::int n from platform_realtime_health`)).n === 0);

console.log("\n-- the probe (0515) --");
await reset();
await db.query(`select realtime_probe_send('7f3c2a10-aaaa-4bbb-8ccc-1234567890ab')`);
s = await sent();
ok("the probe announces its nonce on its own private platform topic", s.length === 1 && s[0].topic === "platform:realtime-probe" && s[0].private === true && s[0].event === "probe", JSON.stringify(s));
ok("...carrying the nonce and nothing of anybody's", JSON.stringify(s[0]?.payload).includes("7f3c2a10") && !JSON.stringify(s[0]?.payload).includes(ORG));
ok("a nonce that is not a short hex id is refused", await (async () => { try { await db.query(`select realtime_probe_send('x; drop table y')`); return false; } catch (e) { return e.code === "22023"; } })());
ok("the browser cannot call the probe", (await (async () => {
  await db.exec("begin");
  try { await db.exec("set local role authenticated"); await db.query(`select realtime_probe_send('7f3c2a10-aaaa-4bbb-8ccc-1234567890ab')`); return "allowed"; }
  catch (e) { return e.code; } finally { await db.exec("rollback"); }
})()) === "42501");
ok("...nor read the health record", (await (async () => {
  await db.exec("begin");
  try { await db.exec("set local role authenticated"); return (await db.query(`select count(*)::int n from platform_realtime_health`)).rows[0].n; }
  catch (e) { return e.code; } finally { await db.exec("rollback"); }
})()) === 0);

console.log("\n-- who may join a topic --");
// Realtime's join check: the joining user's claims and the requested topic, then a SELECT on
// realtime.messages under RLS. One visible row = may join.
const mayJoin = async (claims, topic) => {
  await db.exec("begin");
  try {
    await db.exec(claims ? "set local role authenticated" : "set local role anon");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    await db.query("select set_config('realtime.topic', $1, true)", [topic]);
    const r = await db.query("select count(*)::int n from realtime.messages");
    return r.rows[0].n > 0;
  } catch (e) {
    return `error: ${e.message}`;
  } finally {
    await db.exec("rollback");
  }
};
const jwt = (sub, org, role = "dispatcher") => ({ sub, org_id: org, user_role: role });
ok("a member joins their conversation's topic", (await mayJoin(jwt(ANA, ORG), `chat:conv:${DM}`)) === true);
ok("a person not in it cannot", (await mayJoin(jwt(CLEO, ORG), `chat:conv:${DM}`)) === false);
ok("a person joins their own topic", (await mayJoin(jwt(BEN, ORG, "admin"), `chat:user:${BEN}`)) === true);
ok("...and nobody else's", (await mayJoin(jwt(ANA, ORG), `chat:user:${BEN}`)) === false);
ok("another organisation's admin cannot join it, even naming the id", (await mayJoin(jwt(OUT, ORG_B, "admin"), `chat:conv:${DM}`)) === false);
ok("...even with this organisation's id forged into the claims, not being a member",
  (await mayJoin(jwt(OUT, ORG, "admin"), `chat:conv:${DM}`)) === false);
ok("an anonymous caller joins nothing", (await mayJoin(null, `chat:conv:${DM}`)) === false);
ok("a topic that is not an id is refused, not an error", (await mayJoin(jwt(ANA, ORG), "chat:conv:not-a-uuid")) === false);
ok("an unknown topic is refused", (await mayJoin(jwt(ANA, ORG), "fleet:all")) === false);
ok("a driver conversation's id is not a chat topic", (await mayJoin(jwt(ANA, ORG), `chat:conv:${DRV}`)) === false);
const GROUP = (await one(`select chat_create_group($1,$2,gen_random_uuid(),'Night',$3) id`, [ORG, ANA, [BEN, CLEO]])).id;
ok("a group member joins the group's topic", (await mayJoin(jwt(CLEO, ORG, "safety_manager"), `chat:conv:${GROUP}`)) === true);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
ok("...and after leaving, cannot join it again", (await mayJoin(jwt(CLEO, ORG, "safety_manager"), `chat:conv:${GROUP}`)) === false);
ok("the browser can never broadcast (no INSERT policy)", await (async () => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt(ANA, ORG))]);
    await db.query("select set_config('realtime.topic', $1, true)", [`chat:conv:${DM}`]);
    await db.query(`insert into realtime.messages (topic, extension, payload, event) values ($1,'broadcast','{}','chat')`, [`chat:conv:${DM}`]);
    return false;
  } catch {
    return true;
  } finally {
    await db.exec("rollback");
  }
})());
ok("presence on a chat topic is not granted by this policy (CH9 decides it)",
  await (async () => {
    await db.query(`update realtime.messages set extension='presence' where topic='probe'`);
    const r = await mayJoin(jwt(ANA, ORG), `chat:conv:${DM}`);
    await db.query(`update realtime.messages set extension='broadcast' where topic='probe'`);
    return r === false;
  })());

// ── 0514: the driver app's private topics ─────────────────────────────────────────────────────
// Each topic is somebody's own: the inbox only its person, a conversation only its participants in
// their own org. The policy names no extension (0514 says why), so presence and broadcast probes
// are checked as well as the broadcast default.
console.log("\n-- driver topics (0514) --");
const asDriver = jwt(DAN, ORG, "driver");
ok("a driver joins their own inbox topic", (await mayJoin(asDriver, `driver:inbox:${DAN}`)) === true);
ok("...and nobody else's", (await mayJoin(asDriver, `driver:inbox:${ANA}`)) === false);
ok("a driver joins their own conversation's topic", (await mayJoin(asDriver, `driver:thread:${DRV}`)) === true);
ok("...the office participant too", (await mayJoin(jwt(ANA, ORG), `driver:thread:${DRV}`)) === true);
ok("someone not in the conversation cannot", (await mayJoin(jwt(CLEO, ORG, "safety_manager"), `driver:thread:${DRV}`)) === false);
ok("another org's person cannot, even claiming the right org", (await mayJoin(jwt(OUT, ORG, "admin"), `driver:thread:${DRV}`)) === false);
ok("a participant whose token names another org cannot", (await mayJoin(jwt(DAN, ORG_B, "driver"), `driver:thread:${DRV}`)) === false);
ok("an office chat is not a driver topic", (await mayJoin(jwt(ANA, ORG), `driver:thread:${DM}`)) === false);
ok("a malformed id is refused, not an error", (await mayJoin(asDriver, "driver:thread:nope")) === false);
ok("the old shared public name grants nothing", (await mayJoin(asDriver, "messages-inbox")) === false);
ok("an anonymous caller joins no driver topic", (await mayJoin(null, `driver:inbox:${DAN}`)) === false);
ok("no signed-in person may join the platform probe topic — it is the service role's alone (0515)",
  (await mayJoin(jwt(BEN, ORG, "admin"), "platform:realtime-probe")) === false && (await mayJoin(asDriver, "platform:realtime-probe")) === false);
ok("whatever extension Realtime probes, the owner is admitted", await (async () => {
  const results = [];
  for (const ext of ["presence", "postgres_changes"]) {
    await db.query(`update realtime.messages set extension=$1 where topic='probe'`, [ext]);
    results.push(await mayJoin(asDriver, `driver:inbox:${DAN}`));
  }
  await db.query(`update realtime.messages set extension='broadcast' where topic='probe'`);
  return results.every((r) => r === true);
})());

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
